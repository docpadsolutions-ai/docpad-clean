#!/usr/bin/env node
/**
 * Fail if supabase/migrations/ and the database disagree about what has been applied.
 *
 *   node scripts/check-migration-drift.mjs "postgresql://...:5432/postgres"
 *   node scripts/check-migration-drift.mjs            # reads $SUPABASE_DB_URL
 *
 * This exists because nobody was watching. Over six months the folder drifted to 173
 * files, 93 of which had never been applied anywhere, while 296 applied migrations
 * had no file at all. Nothing failed, nothing warned, and `supabase db push` would
 * have applied those 93 orphans to a schema that had evolved down a different path.
 *
 * Two directions, both bad, both silent until now:
 *
 *   applied but no file   the repo cannot rebuild the database. Losing the project
 *                         means losing the schema.
 *   file but not applied  `db push` will try to run it. On a database that moved on
 *                         without it, that is how you break production.
 *
 * Exits 1 on either. Exits 0 and says nothing much when they agree.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const MIGRATIONS = "supabase/migrations";

const dbUrl = process.argv.slice(2).find((a) => a.startsWith("postgres")) ?? process.env.SUPABASE_DB_URL ?? "";

if (!dbUrl) {
  console.log("No SUPABASE_DB_URL set; skipping the migration drift check.");
  process.exit(0);
}
if (!existsSync(MIGRATIONS)) {
  console.error(`No ${MIGRATIONS} directory. Run from the repo root.`);
  process.exit(1);
}

let applied;
try {
  const out = execFileSync(
    "psql",
    [
      dbUrl,
      "-At",
      "-c",
      "select coalesce(json_agg(json_build_object('version', version, 'name', coalesce(name,'')) order by version), '[]') from supabase_migrations.schema_migrations",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  applied = JSON.parse(out.trim());
} catch (e) {
  console.error(`Could not read the migration record: ${e.message}`);
  process.exit(1);
}

const fileVersions = new Map();
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
  const v = f.split("_")[0];
  if (!fileVersions.has(v)) fileVersions.set(v, []);
  fileVersions.get(v).push(f);
}

const appliedVersions = new Set(applied.map((r) => r.version));

const missingFiles = applied.filter((r) => !fileVersions.has(r.version));
const unapplied = [...fileVersions.entries()].filter(([v]) => !appliedVersions.has(v));
const duplicates = [...fileVersions.entries()].filter(([, files]) => files.length > 1);

let failed = false;

if (missingFiles.length) {
  failed = true;
  console.error(`\n${missingFiles.length} migration(s) applied to the database with no file in the repo.`);
  console.error("The repo cannot rebuild this database. Recover them with:");
  console.error("  node scripts/restore-migration-files.mjs \"$SUPABASE_DB_URL\"\n");
  for (const r of missingFiles.slice(0, 15)) console.error(`  ${r.version}  ${r.name}`);
  if (missingFiles.length > 15) console.error(`  ... and ${missingFiles.length - 15} more`);
}

if (unapplied.length) {
  failed = true;
  console.error(`\n${unapplied.length} migration file(s) that have never been applied.`);
  console.error("`supabase db push` would run these against a database that moved on without them.");
  console.error("Apply them deliberately, or move them out of the folder.\n");
  for (const [v, files] of unapplied.slice(0, 15)) console.error(`  ${v}  ${files.join(", ")}`);
  if (unapplied.length > 15) console.error(`  ... and ${unapplied.length - 15} more`);
}

if (duplicates.length) {
  failed = true;
  console.error(`\n${duplicates.length} version(s) claimed by more than one file.`);
  console.error("Only one of each can ever be applied, and which one is undefined.\n");
  for (const [v, files] of duplicates) console.error(`  ${v}  ${files.join(", ")}`);
}

if (failed) {
  console.error("");
  process.exit(1);
}

console.log(`migrations agree: ${applied.length} applied, ${fileVersions.size} files, no duplicates.`);
