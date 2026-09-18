#!/usr/bin/env node
/**
 * Build a realistic OPD day in a self-contained demo hospital.
 *
 *   node scripts/seed-demo-day.mjs --dry      # say what it would do, write nothing
 *   node scripts/seed-demo-day.mjs            # create or top up the demo hospital
 *   node scripts/seed-demo-day.mjs --reset    # delete it first, then recreate
 *   node scripts/seed-demo-day.mjs --destroy  # delete it and stop
 *
 * Proposal v1.0 §2.1 asks for "a seed-data framework producing a realistic OPD day",
 * and §11.2 asks whether it also serves as an audit or demonstration dataset. It does,
 * and that is most of why it is worth building: without it there is nothing to stage,
 * nothing to demonstrate, and nothing for the §5 scripted clinical scenarios to run
 * against. A staging project with an empty database is not a staging environment.
 *
 * Everything it writes lives under one hospital with a fixed id, DEMO_HOSPITAL_ID
 * below, named so that nobody mistakes it for a real site. It never touches a row
 * outside that hospital, so it is safe to run against a project that also holds real
 * data - though you should not want to.
 *
 * It needs the service-role key, because creating the two sign-in accounts goes
 * through the Auth admin API. Run it from your own machine, not from a sandbox: the
 * key should not travel further than it has to.
 *
 * No dependencies. Reads .env.local for NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY.
 */

import { readFileSync } from "node:fs";

const DEMO_HOSPITAL_ID = "d0c9ad00-0000-4000-8000-000000000001";
const DEMO_HOSPITAL_NAME = "DocPad Demo Clinic (seeded data - not a real site)";
const DEMO_PASSWORD = "DocPadDemo!2026";

const DOCTOR_EMAIL = "demo.doctor@docpad.invalid";
const RECEPTION_EMAIL = "demo.reception@docpad.invalid";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const RESET = argv.includes("--reset");
const DESTROY = argv.includes("--destroy");

// ---------------------------------------------------------------- environment

function readEnvLocal() {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const env = { ...readEnvLocal(), ...process.env };
const SUPABASE_URL = (env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Both are in .env.local on the machine that runs the app. This script has to run\n" +
      "there rather than in a sandbox, because the service-role key should not travel.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------- tiny client

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function rest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

/** Upsert on the primary key, so a second run tops up rather than duplicating. */
const upsert = (table, rows) =>
  rest("POST", `/rest/v1/${table}`, rows, {
    Prefer: "resolution=merge-duplicates,return=representation",
  });

const del = (table, filter) => rest("DELETE", `/rest/v1/${table}?${filter}`, undefined, { Prefer: "return=minimal" });

// ---------------------------------------------------------------- fixtures

/** Stable ids so every run addresses the same rows. */
const id = (n) => `d0c9ad00-0000-4000-8000-0000000${String(n).padStart(5, "0")}`;

const ymd = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PRACTITIONERS = [
  {
    id: id(101),
    full_name: "Dr Anjali Mehra",
    role: "doctor",
    specialty: "Orthopaedics",
    primary_specialty: "Orthopaedics",
    qualification: "MS Orthopaedics",
    registration_no: "PMC/2014/11927",
    email: DOCTOR_EMAIL,
  },
  {
    id: id(102),
    full_name: "Sunita Rao",
    role: "receptionist",
    specialty: null,
    primary_specialty: null,
    qualification: null,
    registration_no: null,
    email: RECEPTION_EMAIL,
  },
];

/**
 * Twelve patients, weighted the way an orthopaedic OPD actually is: knees and backs,
 * a couple of post-op reviews, one paediatric, one with a drug allergy and one with a
 * food allergy, because those two exercise opposite sides of the hard-stop rule.
 */
const PATIENTS = [
  { n: 1, name: "Ramesh Kumar", age: 62, sex: "male", phone: "+919800000001", allergies: ["penicillin"], complaint: "Right knee pain on stairs for 8 months" },
  { n: 2, name: "Sunita Devi", age: 54, sex: "female", phone: "+919800000002", allergies: [], complaint: "Low back pain radiating to left leg" },
  { n: 3, name: "Arjun Nair", age: 28, sex: "male", phone: "+919800000003", allergies: ["Peanuts"], complaint: "Ankle sprain playing football, 3 days" },
  { n: 4, name: "Fatima Sheikh", age: 71, sex: "female", phone: "+919800000004", allergies: [], complaint: "Both knees, difficulty rising from chair" },
  { n: 5, name: "Vikram Desai", age: 45, sex: "male", phone: "+919800000005", allergies: [], complaint: "Right shoulder stiffness, 6 weeks" },
  { n: 6, name: "Priya Sharma", age: 34, sex: "female", phone: "+919800000006", allergies: [], complaint: "Wrist pain after fall" },
  { n: 7, name: "Mohammed Iqbal", age: 58, sex: "male", phone: "+919800000007", allergies: ["sulpha"], complaint: "Follow-up, left total knee replacement" },
  { n: 8, name: "Lakshmi Iyer", age: 66, sex: "female", phone: "+919800000008", allergies: [], complaint: "Neck pain with tingling in right hand" },
  { n: 9, name: "Aarav Gupta", age: 11, sex: "male", phone: "+919800000009", allergies: [], complaint: "Forearm pain after fall from bicycle" },
  { n: 10, name: "Kavita Joshi", age: 39, sex: "female", phone: "+919800000010", allergies: [], complaint: "Heel pain worst on first steps in the morning" },
  { n: 11, name: "Harpreet Singh", age: 49, sex: "male", phone: "+919800000011", allergies: [], complaint: "Review of lumbar MRI" },
  { n: 12, name: "Meera Pillai", age: 25, sex: "female", phone: "+919800000012", allergies: [], complaint: "Recurrent right shoulder dislocation" },
];

// ---------------------------------------------------------------- teardown

async function destroy() {
  // Explicit order rather than trusting cascade, because not every foreign key in
  // this schema declares one and a half-deleted demo is worse than none.
  const tables = [
    "prescriptions",
    "appointment_reminders",
    "appointments",
    "reception_queue",
    "patient_allergies",
    "patient_consents",
    "opd_encounters",
    "patients",
    "practitioners",
  ];
  for (const t of tables) {
    try {
      await del(t, `hospital_id=eq.${DEMO_HOSPITAL_ID}`);
      process.stdout.write(`  cleared ${t}\n`);
    } catch (e) {
      // prescriptions has no hospital_id; reach it through the encounter instead.
      if (t === "prescriptions") {
        try {
          const encs = await rest("GET", `/rest/v1/opd_encounters?hospital_id=eq.${DEMO_HOSPITAL_ID}&select=id`);
          for (const e of encs ?? []) await del("prescriptions", `encounter_id=eq.${e.id}`);
          process.stdout.write(`  cleared prescriptions (via encounters)\n`);
          continue;
        } catch (inner) {
          process.stdout.write(`  skipped prescriptions: ${inner.message}\n`);
          continue;
        }
      }
      process.stdout.write(`  skipped ${t}: ${e.message}\n`);
    }
  }
  await del("hospitals", `id=eq.${DEMO_HOSPITAL_ID}`);
  process.stdout.write("  cleared hospitals\n");
}

// ---------------------------------------------------------------- auth users

async function ensureAuthUser(email) {
  const existing = await rest(
    "GET",
    `/auth/v1/admin/users?page=1&per_page=200`,
  ).catch(() => null);
  const found = existing?.users?.find?.((u) => u.email === email);
  if (found) return found.id;

  const created = await rest("POST", "/auth/v1/admin/users", {
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  return created.id;
}

// ---------------------------------------------------------------- the day

async function seed() {
  await upsert("hospitals", [
    {
      id: DEMO_HOSPITAL_ID,
      name: DEMO_HOSPITAL_NAME,
      privacy_notice_version: "v1",
    },
  ]);
  process.stdout.write("  hospital\n");

  const userIds = {};
  for (const p of PRACTITIONERS) {
    userIds[p.email] = await ensureAuthUser(p.email);
  }
  process.stdout.write(`  auth users (${Object.keys(userIds).length})\n`);

  await upsert(
    "practitioners",
    PRACTITIONERS.map((p) => ({
      id: p.id,
      hospital_id: DEMO_HOSPITAL_ID,
      user_id: userIds[p.email],
      full_name: p.full_name,
      role: p.role,
      specialty: p.specialty,
      primary_specialty: p.primary_specialty,
      qualification: p.qualification,
      registration_no: p.registration_no,
      is_active: true,
    })),
  );
  process.stdout.write(`  practitioners (${PRACTITIONERS.length})\n`);

  const doctorId = PRACTITIONERS[0].id;

  await upsert(
    "patients",
    PATIENTS.map((p) => ({
      id: id(200 + p.n),
      hospital_id: DEMO_HOSPITAL_ID,
      docpad_id: `DEMO-${String(p.n).padStart(4, "0")}`,
      full_name: p.name,
      age_years: p.age,
      sex: p.sex,
      phone: p.phone,
      known_allergies: p.allergies,
    })),
  );
  process.stdout.write(`  patients (${PATIENTS.length})\n`);

  // Structured allergies, so the graded hard stop has something to grade. Ramesh is
  // deliberately left ungraded: an ungraded DRUG allergy is the case that blocks, and
  // it is the one worth seeing in a demonstration.
  const allergyRows = [];
  for (const p of PATIENTS) {
    for (const a of p.allergies) {
      const isDrug = /penicillin|sulpha|sulfa/i.test(a);
      allergyRows.push({
        id: id(300 + p.n),
        hospital_id: DEMO_HOSPITAL_ID,
        patient_id: id(200 + p.n),
        substance: a,
        category: isDrug ? "drug" : "food",
        severity: p.n === 7 ? "severe" : "unknown",
        reaction: isDrug ? "Rash reported by patient" : null,
      });
    }
  }
  if (allergyRows.length) await upsert("patient_allergies", allergyRows);
  process.stdout.write(`  allergies (${allergyRows.length})\n`);

  // Three encounters from previous weeks, so history, follow-ups and the finalise
  // lock all have something behind them. The first is left finalised on purpose:
  // it is what demonstrates that a completed encounter refuses edits.
  const pastEncounters = [
    { n: 1, patient: 7, days: -42, dx: "Primary osteoarthritis, left knee", icd: "M17.12", status: "completed" },
    { n: 2, patient: 1, days: -28, dx: "Primary osteoarthritis, right knee", icd: "M17.11", status: "completed" },
    { n: 3, patient: 11, days: -14, dx: "Lumbar disc degeneration", icd: "M51.36", status: "completed" },
  ];
  await upsert(
    "opd_encounters",
    pastEncounters.map((e) => ({
      id: id(400 + e.n),
      hospital_id: DEMO_HOSPITAL_ID,
      patient_id: id(200 + e.patient),
      doctor_id: doctorId,
      encounter_date: ymd(e.days),
      status: e.status,
      visit_type: "new",
      chief_complaint: PATIENTS[e.patient - 1].complaint,
      working_diagnosis: e.dx,
      diagnosis_icd10: e.icd,
    })),
  );
  process.stdout.write(`  past encounters (${pastEncounters.length})\n`);

  // A prescription on the oldest encounter, so "active medications" and duplicate
  // therapy have something to find at today's visit.
  await upsert("prescriptions", [
    {
      id: id(500),
      encounter_id: id(401),
      patient_id: id(207),
      medicine_name: "Aceclofenac 100mg",
      active_ingredient_name: "aceclofenac",
      dosage: "100mg",
      frequency: "BD",
      duration: "10 days",
      status: "final",
      total_quantity: 20,
    },
    {
      id: id(501),
      encounter_id: id(401),
      patient_id: id(207),
      medicine_name: "Pantoprazole 40mg",
      active_ingredient_name: "pantoprazole",
      dosage: "40mg",
      frequency: "OD",
      duration: "10 days",
      status: "final",
      total_quantity: 10,
    },
  ]);
  process.stdout.write("  prescriptions (2)\n");

  // Today. Four booked ahead, one of them a follow-up the doctor set at the last
  // visit, plus three already checked in at different points in the queue.
  const booked = [
    { n: 1, patient: 4, time: "09:30", type: "new" },
    { n: 2, patient: 7, time: "10:00", type: "follow_up", parent: id(401) },
    { n: 3, patient: 8, time: "10:30", type: "new" },
    { n: 4, patient: 12, time: "11:15", type: "review" },
  ];
  await upsert(
    "appointments",
    booked.map((a) => ({
      id: id(600 + a.n),
      hospital_id: DEMO_HOSPITAL_ID,
      patient_id: id(200 + a.patient),
      doctor_id: doctorId,
      assigned_doctor_id: doctorId,
      appointment_date: ymd(0),
      scheduled_time: a.time,
      start_time: a.time,
      status: "scheduled",
      visit_type: a.type,
      booking_source: a.parent ? "follow_up_auto" : "booked",
      parent_encounter_id: a.parent ?? null,
      booked_at: new Date().toISOString(),
      chief_complaint: PATIENTS[a.patient - 1].complaint,
    })),
  );
  process.stdout.write(`  bookings for today (${booked.length})\n`);

  // Tomorrow, so the day-before WhatsApp reminder job has something to pick up.
  await upsert("appointments", [
    {
      id: id(610),
      hospital_id: DEMO_HOSPITAL_ID,
      patient_id: id(202),
      doctor_id: doctorId,
      assigned_doctor_id: doctorId,
      appointment_date: ymd(1),
      scheduled_time: "09:45",
      start_time: "09:45",
      status: "scheduled",
      visit_type: "new",
      booking_source: "booked",
      booked_at: new Date().toISOString(),
      chief_complaint: PATIENTS[1].complaint,
    },
  ]);
  process.stdout.write("  booking for tomorrow (1) - gives the reminder cron a row\n");

  const walkIns = [
    { n: 1, patient: 3, token: 1, status: "with_doctor" },
    { n: 2, patient: 6, token: 2, status: "registered" },
    { n: 3, patient: 10, token: 3, status: "registered" },
  ];
  await upsert(
    "reception_queue",
    walkIns.map((w) => ({
      id: id(700 + w.n),
      hospital_id: DEMO_HOSPITAL_ID,
      patient_id: id(200 + w.patient),
      token_number: w.token,
      token_prefix: "OPD",
      queue_date: ymd(0),
      queue_status: w.status,
      assigned_doctor_id: doctorId,
      doctor_id: doctorId,
      registered_at: new Date().toISOString(),
    })),
  );
  process.stdout.write(`  walk-ins in the queue (${walkIns.length})\n`);
}

// ---------------------------------------------------------------- main

async function main() {
  console.log(`Demo hospital: ${DEMO_HOSPITAL_NAME}`);
  console.log(`Project:       ${SUPABASE_URL}\n`);

  if (DRY) {
    console.log("Dry run. Would write, all under the demo hospital and nowhere else:");
    console.log(`  1 hospital, 2 practitioners with sign-in accounts`);
    const drugAllergies = PATIENTS.filter((p) => p.allergies.some((a) => /penicillin|sulpha|sulfa/i.test(a))).length;
    const otherAllergies = PATIENTS.filter((p) => p.allergies.length).length - drugAllergies;
    console.log(
      `  ${PATIENTS.length} patients, ${drugAllergies + otherAllergies} with allergies ` +
        `(${drugAllergies} drug, ${otherAllergies} food)`,
    );
    console.log(`  3 past encounters, 1 of them finalised, with 2 active medications`);
    console.log(`  5 bookings (4 today including a follow-up, 1 tomorrow for the reminder job)`);
    console.log(`  3 walk-ins already in today's queue`);
    console.log(`\nNothing outside hospital ${DEMO_HOSPITAL_ID} is read or written.`);
    return;
  }

  if (DESTROY || RESET) {
    console.log("Removing the demo hospital:");
    await destroy();
    if (DESTROY) {
      console.log("\nDone. Nothing seeded.");
      return;
    }
    console.log("");
  }

  console.log("Seeding:");
  await seed();

  console.log(`
Done. Sign in at /auth with either account:

  doctor      ${DOCTOR_EMAIL}
  reception   ${RECEPTION_EMAIL}
  password    ${DEMO_PASSWORD}

Worth trying, because each one exercises a rule that used to exist only in the UI:

  * open Ramesh Kumar and prescribe Amoxicillin. His record says penicillin, and
    the cross-reactivity map catches it even though the names do not match.
  * prescribe Cefuroxime for him instead. That is a caution, not a refusal.
  * open Mohammed Iqbal, who is on aceclofenac, and add Warfarin. Severe pair.
  * finalise any encounter, then try to change the diagnosis. The database refuses,
    not the interface.
  * reception, Bookings tab: four booked today, one a follow-up the doctor set at
    the last visit. Check one in and watch it become a token rather than a duplicate.

Re-run with --reset to start clean, or --destroy to remove it entirely.`);
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
});
