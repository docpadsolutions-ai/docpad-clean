#!/usr/bin/env node
/**
 * Rebuild supabase/migrations/ from what the database says actually ran.
 *
 *   node scripts/restore-migration-files.mjs "postgresql://...pooler...:5432/postgres"
 *   node scripts/restore-migration-files.mjs            # reads $SUPABASE_DB_URL
 *   node scripts/restore-migration-files.mjs --dry ...  # report, write nothing
 *
 * Background. The migrations folder held 173 files, of which 90 had never been
 * applied to any database, while 296 applied migrations had no file at all. It looked
 * like six months of history had been lost to dashboard and MCP edits.
 *
 * It had not been. Supabase stores each migration's SQL in
 * supabase_migrations.schema_migrations.statements, so the database is the complete
 * and authoritative record. This script writes that record back out as files, in
 * order, so the repo can replay the real history onto an empty project instead of a
 * squashed snapshot.
 *
 * Existing files are moved to supabase/migrations/_archive_pre_restore/ rather than
 * overwritten, so anything hand-written that never ran is still there to read.
 *
 * Uses psql (from libpq) rather than a Node driver, so there is nothing to install
 * beyond what the dump already needed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const ARCHIVE = join(MIGRATIONS, "_archive_pre_restore");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry");
const dbUrl = argv.find((a) => a.startsWith("postgres")) ?? process.env.SUPABASE_DB_URL ?? "";

if (!dbUrl) {
  console.error(
    "Need a connection string. Either pass it:\n" +
      '  node scripts/restore-migration-files.mjs "postgresql://user:pass@host:5432/postgres"\n' +
      "or set SUPABASE_DB_URL. Take it from the dashboard: Settings, Database,\n" +
      "Connection string, URI, session pooler.",
  );
  process.exit(1);
}

if (!existsSync(MIGRATIONS)) {
  console.error(`No ${MIGRATIONS} directory here. Run this from the repo root.`);
  process.exit(1);
}

/** One round trip; the whole record is about a megabyte of JSON. */
const query = `
  select coalesce(json_agg(json_build_object(
           'version', version,
           'name', coalesce(name, 'migration'),
           'sql', array_to_string(statements, E';\\n')
         ) order by version), '[]')
    from supabase_migrations.schema_migrations
`;

let rows;
try {
  const out = execFileSync("psql", [dbUrl, "-At", "-c", query], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["inherit", "pipe", "inherit"],
  });
  rows = JSON.parse(out.trim());
} catch (e) {
  console.error(`\nCould not read the migration record: ${e.message}`);
  console.error("If psql is not found, run: brew install libpq && brew link --force libpq");
  process.exit(1);
}

if (!Array.isArray(rows) || rows.length === 0) {
  console.error("The database reports no migrations. Nothing to restore.");
  process.exit(1);
}

/** Filenames must survive whatever went into the name column. */
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "migration";

const existing = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
const appliedVersions = new Set(rows.map((r) => r.version));
const neverApplied = existing.filter((f) => !appliedVersions.has(f.split("_")[0]));

console.log(`database holds ${rows.length} migrations, with SQL for all of them`);
console.log(`folder holds   ${existing.length} files, of which ${neverApplied.length} were never applied\n`);

if (dryRun) {
  console.log("Dry run. Would archive every current file and write the record back out.");
  console.log("\nNever applied, would be archived:");
  for (const f of neverApplied.slice(0, 15)) console.log(`  ${f}`);
  if (neverApplied.length > 15) console.log(`  ... and ${neverApplied.length - 15} more`);
  process.exit(0);
}

mkdirSync(ARCHIVE, { recursive: true });
for (const f of existing) renameSync(join(MIGRATIONS, f), join(ARCHIVE, f));
console.log(`archived ${existing.length} existing files to ${ARCHIVE}`);

let written = 0;
let empty = 0;
for (const r of rows) {
  const body = String(r.sql ?? "").trim();
  if (!body) {
    empty += 1;
    continue;
  }
  const file = join(MIGRATIONS, `${r.version}_${slug(r.name)}.sql`);
  writeFileSync(
    file,
    `-- Restored from supabase_migrations.schema_migrations.\n` +
      `-- This is the SQL the database records as having actually run, on ${r.version}.\n\n` +
      `${body}${body.endsWith(";") ? "" : ";"}\n`,
  );
  written += 1;
}

console.log(`wrote    ${written} migration files${empty ? `, skipped ${empty} with no SQL` : ""}`);
console.log(`\nThe folder is now exactly what the database says ran, in order.`);
console.log(`Check the archive for anything hand-written that never ran and still matters.`);
