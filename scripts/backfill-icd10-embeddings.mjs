#!/usr/bin/env node
/**
 * Backfill the missing ICD-10 embeddings.
 *
 *   node scripts/backfill-icd10-embeddings.mjs --dry        # count only, embed nothing
 *   node scripts/backfill-icd10-embeddings.mjs --limit 200  # small slice first
 *   node scripts/backfill-icd10-embeddings.mjs              # the whole remainder
 *
 * 15,347 of the 73,790 codes were ingested without an embedding: all of chapters
 * F (mental health), H (eye and ear), O (pregnancy), P (perinatal), Q (congenital),
 * U, and V/W/X/Y (external causes). Those codes are reachable today only through
 * the lexical half of search_icd10(), which cannot bridge synonymy - "senile
 * cataract" will not find "age-related cataract" without a vector.
 *
 * Two things this script learned the hard way, both measured rather than assumed:
 *
 * - Embeddings are written to icd10_library.embedding_pending, an unindexed staging
 *   column, not to `embedding` directly. Writing 50 rows straight into `embedding`
 *   takes 13.7 seconds because each one is an insert into the HNSW index, and
 *   PostgREST kills anything over 8 seconds. Writing to the staging column takes
 *   155ms for the same 50 rows. A follow-up migration merges the column in and
 *   rebuilds the index once, which is both faster and produces a better graph.
 *
 * - Google rate-limits embeddings hard, and the free tier's exact quota is not
 *   published. Rather than guess, the script finds the limit: it backs off on 429,
 *   honours Retry-After, and keeps a self-adjusting gap between requests that grows
 *   when it is throttled and relaxes when it is not.
 *
 * Resumable: it only ever selects rows with neither an embedding nor a staged one,
 * so if it stops, or you interrupt it, run it again and it continues.
 *
 * Deliberately dependency-free (global fetch, .env.local parsed here) so it runs on
 * any Node 18+ without caring what the project has installed.
 *
 * Needs, in .env.local or the environment:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GEMINI_API_KEY            (falls back to NEXT_PUBLIC_GEMINI_API_KEY)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------- configuration
const EMBED_MODEL = "gemini-embedding-001";
/** Must stay 768: the dimension of icd10_library.embedding and of the rows already in it. */
const DIMENSIONS = 768;
/** Rows fetched from Postgres per page. */
const PAGE = 500;
/** Ceiling for one backoff sleep. */
const MAX_BACKOFF_MS = 300_000;
/** Give up on a batch after this many attempts; its rows stay unstaged for the next run. */
const MAX_ATTEMPTS = 8;
/** Successes in a row before the self-imposed gap is relaxed. */
const RELAX_AFTER = 8;

// ---------------------------------------------------------------- env
function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const [, key, rawValue] = m;
        if (process.env[key]) continue;
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    } catch {
      // file not present; the environment may already carry the values
    }
  }
}

loadEnvLocal();

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const GEMINI_KEY = (process.env.GEMINI_API_KEY ?? process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? "").trim();

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};

const dryRun = flag("--dry");
const hardLimit = value("--limit", Infinity);
/** Embeddings per Gemini call. Smaller means less lost to a throttled batch. */
const BATCH = Math.max(1, Math.min(value("--batch", 25), 100));

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!GEMINI_KEY && !dryRun) {
  console.error("Missing GEMINI_API_KEY. Add it to .env.local, or run with --dry to just count.");
  process.exit(1);
}

const restHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => n.toLocaleString();

// ---------------------------------------------------------------- supabase
async function countRemaining() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/icd10_awaiting_embedding?select=id&limit=1`, {
    headers: { ...restHeaders, Prefer: "count=exact" },
  });
  if (!res.ok) throw new Error(`count failed: ${res.status} ${await res.text()}`);
  return Number((res.headers.get("content-range") ?? "").split("/")[1] ?? 0);
}

async function fetchPage(size) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/icd10_awaiting_embedding?select=id,code,long_description&order=code.asc&limit=${size}`,
    { headers: restHeaders },
  );
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function writeEmbeddings(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/_icd10_set_embeddings`, {
    method: "POST",
    headers: restHeaders,
    body: JSON.stringify({ p_rows: rows }),
  });
  if (!res.ok) throw new Error(`write failed: ${res.status} ${await res.text()}`);
  return Number(await res.text());
}

// ---------------------------------------------------------------- gemini
/** Seconds Google asked us to wait, from the header or from error.details. */
function retryAfterMs(res, body) {
  const header = res.headers.get("retry-after");
  if (header && Number.isFinite(Number(header))) return Number(header) * 1000;

  const details = body?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const m = String(d?.retryDelay ?? "").match(/^(\d+(?:\.\d+)?)s$/);
      if (m) return Math.ceil(Number(m[1]) * 1000);
    }
  }
  return null;
}

/** Gap the script imposes on itself, discovered from how often Google throttles us. */
let gapMs = 0;
let streak = 0;

function throttled(waited) {
  streak = 0;
  gapMs = Math.min(Math.max(gapMs * 2, 1000, Math.round(waited / 4)), 20_000);
}

function eased() {
  streak += 1;
  if (streak >= RELAX_AFTER && gapMs > 0) {
    gapMs = Math.max(0, Math.round(gapMs * 0.8));
    streak = 0;
  }
}

async function embedBatch(texts) {
  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: text.slice(0, 2048) }] },
      outputDimensionality: DIMENSIONS,
    })),
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (gapMs > 0) await sleep(gapMs);

    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw e;
      await sleep(Math.min(2000 * 2 ** (attempt - 1), MAX_BACKOFF_MS));
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      const out = json?.embeddings;
      if (!Array.isArray(out) || out.length !== texts.length) {
        throw new Error(`unexpected embedding response shape (${out?.length} for ${texts.length})`);
      }
      eased();
      return out.map((e) => e.values);
    }

    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON error body; the status is enough
    }

    // Anything that is not a throttle or a transient server fault is a real error.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`gemini ${res.status}: ${text.slice(0, 400)}`);
    }
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`gemini ${res.status} after ${MAX_ATTEMPTS} attempts`);
    }

    const asked = retryAfterMs(res, parsed);
    const wait = Math.min(asked ?? 5000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    if (res.status === 429) throttled(wait);
    process.stdout.write(
      `\n  ${res.status === 429 ? "rate limited" : `server ${res.status}`}, waiting ${Math.round(wait / 1000)}s` +
        `${asked ? " (Google asked)" : ""}, pacing at ${(gapMs / 1000).toFixed(1)}s/request\n`,
    );
    await sleep(wait);
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------- main
async function main() {
  const startedWith = await countRemaining();
  console.log(`${fmt(startedWith)} ICD-10 codes still need an embedding.`);
  if (startedWith === 0) {
    console.log("Nothing to do. Run the merge migration to fold the staged vectors in.");
    return;
  }
  if (dryRun) {
    console.log("Dry run: nothing embedded.");
    return;
  }

  const target = Math.min(startedWith, hardLimit);
  console.log(
    `Embedding ${fmt(target)} at ${DIMENSIONS} dimensions, ${BATCH} per request.\n` +
      `Throttling is discovered as it goes; if the pacing settles above a second or two,\n` +
      `check your quota at https://aistudio.google.com/rate-limit - a daily cap would\n` +
      `mean finishing this over more than one day.\n`,
  );

  const startedAt = Date.now();
  let done = 0;
  let hardFailures = 0;

  while (done < target) {
    const rows = await fetchPage(Math.min(PAGE, target - done));
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length && done < target; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      let vectors;
      try {
        vectors = await embedBatch(slice.map((r) => r.long_description ?? r.code));
      } catch (e) {
        // Leave this batch unstaged so a later run picks it up again.
        hardFailures += 1;
        console.error(`\n  batch at ${slice[0]?.code} failed: ${e.message}`);
        if (hardFailures >= 3) {
          console.error(
            `\nStopping after ${hardFailures} failed batches. ${fmt(done)} embedded so far;\n` +
              `re-run and it continues from here.`,
          );
          return;
        }
        continue;
      }

      done += await writeEmbeddings(slice.map((r, n) => ({ id: r.id, embedding: vectors[n] })));

      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = done / Math.max(elapsed, 1);
      const eta = rate > 0 ? Math.round((target - done) / rate) : 0;
      process.stdout.write(
        `\r  ${fmt(done)} / ${fmt(target)}  (${Math.round((done / target) * 100)}%)` +
          `  ${rate.toFixed(1)}/s  eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, "0")}s   `,
      );
    }
  }

  const remaining = await countRemaining();
  console.log(`\n\n${fmt(done)} embedded. ${fmt(remaining)} still waiting.`);
  console.log(
    remaining === 0
      ? "All staged. Tell Claude, and the merge migration folds them in and rebuilds the index."
      : "Re-run this script to pick up the rest.",
  );
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
