#!/usr/bin/env node
/**
 * Turn a raw `pg_dump --schema-only` of the live database into a baseline migration
 * that can actually be replayed onto an empty Supabase project.
 *
 *   node scripts/build-baseline-migration.mjs \
 *     supabase/_baseline_schema.sql \
 *     supabase/migrations/00000000000000_baseline.sql
 *
 * Why a transform rather than using the dump directly. Four things in a raw dump
 * break on replay, and all four stay silent until a restore fails half way:
 *
 *   1. `\restrict` / `\unrestrict` are psql meta-commands. Supabase applies
 *      migrations over an ordinary connection, where they are a syntax error.
 *   2. `CREATE SCHEMA public` and `CREATE SCHEMA storage` both already exist on a
 *      fresh Supabase project.
 *   3. The dump references extensions.vector, extensions.similarity and
 *      extensions.gin_trgm_ops but never creates the extensions schema or the
 *      extensions themselves, because they live outside the dumped schemas. Column
 *      types like `extensions.vector(768)` fail immediately without them.
 *   4. The whole `storage` schema is Supabase's own machinery: 17 functions, 8
 *      tables, their constraints and indexes. Recreating it on a project that
 *      already has it conflicts. Our own storage RLS policies are ours and are kept.
 *
 * Everything dropped is listed on stdout, so the difference between the dump and the
 * baseline is auditable rather than trusted.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: build-baseline-migration.mjs <dump.sql> <baseline.sql>");
  process.exit(1);
}

const raw = readFileSync(inPath, "utf8");

/**
 * Split SQL into statements. Splitting naively on ";" corrupts every function body,
 * so this tracks dollar quoting ($$ ... $$ and $tag$ ... $tag$), single quotes with
 * their doubled-quote escape, and line comments.
 */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let dollarTag = null;

  while (i < sql.length) {
    const ch = sql[i];
    const rest = sql.slice(i);

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        buf += ch;
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      buf += ch;
      i += 1;
      if (ch === "'") {
        if (sql[i] === "'") {
          buf += sql[i];
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }

    const dq = rest.match(/^\$[A-Za-z_]*\$/);
    if (dq) {
      dollarTag = dq[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (ch === ";") {
      buf += ch;
      out.push(buf);
      buf = "";
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  if (buf.trim()) out.push(buf);
  return out;
}

const statements = splitStatements(raw);

const dropped = new Map();
const note = (why, what) => {
  if (!dropped.has(why)) dropped.set(why, []);
  dropped.get(why).push(what);
};

/** First meaningful line of a statement, for the drop report. */
const label = (s) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("--"))
    ?.slice(0, 90) ?? "(blank)";

const kept = [];

for (const stmt of statements) {
  const body = stmt
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim();

  if (!body) continue;

  // 1. psql meta-commands
  if (/^\\(restrict|unrestrict)\b/m.test(body)) {
    note("psql meta-commands (invalid over a plain connection)", label(stmt));
    continue;
  }

  // 2. schemas that already exist on a fresh Supabase project
  if (/^CREATE SCHEMA (public|storage)\s*;/i.test(body) || /^COMMENT ON SCHEMA public/i.test(body)) {
    note("schema already present on a fresh Supabase project", label(stmt));
    continue;
  }

  // 4. Supabase's own storage machinery, but not our policies on it
  const firstLine = (body.split("\n")[0] ?? "").trim();
  const isOurStoragePolicy = /^CREATE POLICY\b/i.test(body) && /\bON storage\.objects\b/i.test(body);
  const isStorageRls = /^ALTER TABLE storage\.[a-z_]+ ENABLE ROW LEVEL SECURITY/i.test(body);
  // Objects that name themselves before the schema (CREATE INDEX x ON storage.y,
  // CREATE TRIGGER t ... ON storage.y) need the "ON storage." form; the rest carry
  // the schema straight after the keyword. Everything Supabase owns in that schema
  // is dropped. What we added there is policies, handled above.
  const definesStorageObject =
    /^(CREATE (TABLE|FUNCTION|TYPE|VIEW|SEQUENCE)\s+(ONLY\s+)?storage\.|ALTER TABLE\s+(ONLY\s+)?storage\.|COMMENT ON (COLUMN|TABLE)\s+storage\.)/i.test(
      firstLine,
    ) ||
    /^CREATE (UNIQUE )?INDEX\b[^;]*\bON\s+storage\./i.test(firstLine) ||
    /^CREATE (CONSTRAINT )?TRIGGER\b[^;]*\bON\s+storage\./i.test(firstLine);

  if (definesStorageObject && !isOurStoragePolicy && !isStorageRls) {
    note("Supabase-managed storage schema (already present, not ours to recreate)", label(stmt));
    continue;
  }

  kept.push(stmt.trim());
}

// 3. the preamble the dump leaves out
const preamble = `--
-- DocPad baseline schema.
--
-- Generated from the live database by scripts/build-baseline-migration.mjs, which
-- prints exactly what it removed from the raw pg_dump and why. Regenerate with:
--
--   pg_dump --schema-only --no-owner --no-privileges --schema=public --schema=storage \\
--     -h <pooler host> -p 5432 -U postgres.<ref> -d postgres -W > supabase/_baseline_schema.sql
--   node scripts/build-baseline-migration.mjs supabase/_baseline_schema.sql \\
--     supabase/migrations/00000000000000_baseline.sql
--
-- Why this file exists: the migrations folder held 173 files, of which 90 had never
-- been applied to any database, while 296 applied migrations had no file at all. The
-- chain could not be replayed, and \`supabase db push\` would have tried to apply those
-- 90 orphans to a schema that had evolved down a different path. Those files are kept,
-- unreplayed, under supabase/migrations/_archive_pre_baseline/ for the reasoning in
-- them. This file is the new starting point; everything after it is a real migration.
--

create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- Referenced by column types and operators below, and not carried by the dump because
-- they live outside the dumped schemas.
create extension if not exists "uuid-ossp"  with schema extensions;
create extension if not exists pgcrypto     with schema extensions;
create extension if not exists pg_trgm      with schema extensions;
create extension if not exists vector       with schema extensions;

-- Used only by supabase/tests/rls_isolation.sql; harmless if the suite is never run.
create extension if not exists pgtap        with schema extensions;
`;

const output = `${preamble}\n${kept.join("\n\n")}\n`;
writeFileSync(outPath, output);

console.log(`read    ${statements.length} statements from ${inPath}`);
console.log(`kept    ${kept.length}`);
console.log(`wrote   ${outPath} (${(output.length / 1024 / 1024).toFixed(2)} MB)\n`);
console.log("dropped:");
for (const [why, items] of dropped) {
  console.log(`\n  ${items.length}x  ${why}`);
  for (const it of items.slice(0, 6)) console.log(`        ${it}`);
  if (items.length > 6) console.log(`        ... and ${items.length - 6} more`);
}
