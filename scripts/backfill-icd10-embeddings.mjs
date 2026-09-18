#!/usr/bin/env node
/**
 * Backfill the missing ICD-10 embeddings.
 *
 *   node scripts/backfill-icd10-embeddings.mjs
 *   node scripts/backfill-icd10-embeddings.mjs --limit 500     # try a small slice first
 *   node scripts/backfill-icd10-embeddings.mjs --dry           # count only, embed nothing
 *
 * 15,347 of the 73,790 codes were ingested without an embedding: all of chapters
 * F (mental health), H (eye and ear), O (pregnancy), P (perinatal), Q (congenital),
 * U, and V/W/X/Y (external causes). Those codes are reachable today only through
 * the lexical half of search_icd10(), which cannot bridge synonymy - "senile
 * cataract" will not find "age-related cataract" without a vector.
 *
 * Resumable: it only ever selects rows whose embedding is null, so if it stops
 * halfway, or a batch fails, just run it again. Nothing is overwritten.
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
/** Must stay 768: that is the dimension of icd10_library.embedding and of the 58,443 rows already in it. */
const DIMENSIONS = 768;
/** Gemini accepts up to 100 per batchEmbedContents call; 50 keeps request size and blast radius small. */
const BATCH = 50;
/** Rows fetched from Postgres per page. */
const PAGE = 500;
const MAX_ATTEMPTS = 5;

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
      // file not present; environment may already carry the values
    }
  }
}

loadEnvLocal();

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const GEMINI_KEY = (process.env.GEMINI_API_KEY ?? process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? "").trim();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry");
const limitArg = process.argv.indexOf("--limit");
const hardLimit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

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

// ---------------------------------------------------------------- supabase
async function countRemaining() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/icd10_library?select=id&embedding=is.null&limit=1`,
    { headers: { ...restHeaders, Prefer: "count=exact" } },
  );
  if (!res.ok) throw new Error(`count failed: ${res.status} ${await res.text()}`);
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? 0);
}

async function fetchPage(size) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/icd10_library` +
      `?select=id,code,long_description&embedding=is.null&order=code.asc&limit=${size}`,
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
async function embedBatch(texts) {
  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: text.slice(0, 2048) }] },
      outputDimensionality: DIMENSIONS,
    })),
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw e;
      await sleep(2000 * attempt);
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      const out = json?.embeddings;
      if (!Array.isArray(out) || out.length !== texts.length) {
        throw new Error(`unexpected embedding response shape (${out?.length} for ${texts.length})`);
      }
      return out.map((e) => e.values);
    }

    // 429 is the rate limit, 5xx is transient. Anything else is a real error.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`gemini ${res.status} after ${MAX_ATTEMPTS} attempts`);
    }
    const wait = 3000 * attempt;
    process.stdout.write(`  rate limited (${res.status}), waiting ${wait / 1000}s\n`);
    await sleep(wait);
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------- main
async function main() {
  const startedWith = await countRemaining();
  console.log(`${startedWith.toLocaleString()} ICD-10 codes have no embedding.`);
  if (startedWith === 0) return;
  if (dryRun) {
    console.log("Dry run: nothing embedded.");
    return;
  }

  const target = Math.min(startedWith, hardLimit);
  console.log(`Embedding ${target.toLocaleString()} of them at ${DIMENSIONS} dimensions, ${BATCH} per request.\n`);

  const startedAt = Date.now();
  let done = 0;
  let failedBatches = 0;

  while (done < target) {
    const rows = await fetchPage(Math.min(PAGE, target - done));
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      let vectors;
      try {
        vectors = await embedBatch(slice.map((r) => r.long_description ?? r.code));
      } catch (e) {
        // Leave this batch's rows null so a later run picks them up again.
        failedBatches += 1;
        console.error(`  batch at ${slice[0]?.code} failed: ${e.message}`);
        if (failedBatches >= 5) {
          console.error("Too many failed batches, stopping. Re-run to continue where this left off.");
          return;
        }
        continue;
      }

      const written = await writeEmbeddings(
        slice.map((r, n) => ({ id: r.id, embedding: vectors[n] })),
      );
      done += written;

      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = done / Math.max(elapsed, 1);
      const eta = rate > 0 ? Math.round((target - done) / rate) : 0;
      process.stdout.write(
        `\r  ${done.toLocaleString()} / ${target.toLocaleString()}` +
          `  (${Math.round((done / target) * 100)}%)  ${rate.toFixed(0)}/s  eta ${Math.floor(eta / 60)}m${eta % 60}s   `,
      );
    }
  }

  const remaining = await countRemaining();
  console.log(`\n\nDone. ${done.toLocaleString()} embedded, ${remaining.toLocaleString()} still without one.`);
  if (remaining === 0) {
    console.log("The whole ICD-10 library is now searchable by meaning, not just by wording.");
  } else {
    console.log("Re-run this script to pick up the rest.");
  }
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
