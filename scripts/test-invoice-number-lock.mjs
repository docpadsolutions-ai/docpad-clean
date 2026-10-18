#!/usr/bin/env node
/**
 * Concurrency test for invoice numbering (20261018090000_invoice_number_advisory_lock.sql).
 *
 *   node scripts/test-invoice-number-lock.mjs        # needs psql and $SUPABASE_DB_URL
 *
 * trg_set_invoice_number() must take the advisory lock 'invoice_number:<hospital>:<year>'
 * before it reads max(sequence), so that two invoices saved at once in one hospital
 * queue instead of both getting the same number. A pgTAP file cannot show that, because
 * it needs two sessions, so this script runs two psql processes:
 *
 *   A  begins, takes that lock directly, and holds it for a few seconds.
 *   B  sets lock_timeout and inserts an invoice for the same hospital.
 *
 * With the lock in the trigger, B has to wait for A and is cancelled by lock_timeout
 * (55P03). Without it, B's insert goes straight through. A third insert after A has
 * finished must succeed, which shows numbering still works. Every session rolls back,
 * so nothing is written.
 *
 * Uses psql rather than a Node driver, like scripts/check-migration-drift.mjs. Set PSQL
 * to a full path if psql is not on PATH.
 */

import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

function readEnvLocal() {
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith("SUPABASE_DB_URL="));
    return line ? line.slice("SUPABASE_DB_URL=".length).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

const DB = process.env.SUPABASE_DB_URL || readEnvLocal();
const PSQL = process.env.PSQL || "psql";
if (!DB) {
  console.error("Need SUPABASE_DB_URL (environment or .env.local).");
  process.exit(1);
}

const psqlArgs = (sql) => [DB, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql];
const query = (sql) => execFileSync(PSQL, psqlArgs(sql), { encoding: "utf8" }).trim();

/** Run psql to completion and report its exit code and stderr instead of throwing. */
function run(sql) {
  return new Promise((resolve) => {
    const p = spawn(PSQL, psqlArgs(sql));
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [hospitalId, patientId] = query("select hospital_id || '|' || id from patients limit 1").split("|");
if (!hospitalId || !patientId) {
  console.error("Need at least one patient in the database.");
  process.exit(1);
}

// Same expression the trigger uses for the year when invoice_date is now().
const lockKey = `hashtext('invoice_number:' || '${hospitalId}' || ':' || to_char(now() at time zone 'utc', 'YYYY'))`;
const insert =
  `insert into invoices (hospital_id, patient_id, status, invoice_date) ` +
  `values ('${hospitalId}', '${patientId}', 'draft', now())`;

let failures = 0;
const report = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok" : "not ok"} - ${name}${detail ? `\n  # ${detail}` : ""}`);
};

console.log("1..2");

const holder = run(`begin; select pg_advisory_xact_lock(${lockKey}); select pg_sleep(6); rollback;`);
await sleep(2000);

const contender = await run(`set lock_timeout = '2s'; begin; ${insert}; rollback;`);
report(
  contender.code !== 0 && /lock timeout/i.test(contender.stderr),
  "a concurrent invoice in the same hospital waits on the numbering lock",
  contender.code === 0
    ? "the insert did not wait: trg_set_invoice_number() does not take the lock"
    : contender.stderr.split("\n")[0],
);

await holder;

const after = await run(`set lock_timeout = '5s'; begin; ${insert}; rollback;`);
report(after.code === 0, "an invoice saves normally once the lock is free", after.stderr.split("\n")[0]);

process.exit(failures ? 1 : 0);
