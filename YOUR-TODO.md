# What's left for you — as of 17 Sep 2026, end of session

Everything I could do without credentials or a dashboard is applied to the code and
to the Supabase project `Docpad` (hvjbzlwlqnntwxgufjkm), and committed. There are
**23 commits on `main` that have never been pushed.** The items below need you.

Rough order: 1 and 2 are security and should happen first, 3 is thirty minutes that
de-risks everything else, 4 to 7 are five-minute settings, 8 and 9 are decisions I
need from you before I can build them, 10 is optional.

---

## 1. Rotate two exposed keys

| Key | Why | Where |
| --- | --- | --- |
| Gemini API key | It shipped in the browser bundle via `NEXT_PUBLIC_GEMINI_API_KEY`, so anyone who opened DocPad could read it | Google AI Studio, create a new key and delete the old one |
| Supabase service-role key | It was hardcoded in `scripts/ingest-icd10.ts` on disk (never committed) | Supabase, Project Settings, API, rotate |

Then update **both** `.env.local` and the Vercel project env vars.

While you are there, rename the Gemini variable: add `GEMINI_API_KEY` with the new
key in `.env.local` and in Vercel, and delete `NEXT_PUBLIC_GEMINI_API_KEY` from both
once the app works. The code still falls back to the old name, so nothing breaks in
between. The Supabase Edge Functions have their own `GEMINI_API_KEY` secret under
Edge Functions, Secrets, and that one needs the new key too.

## 2. Push the commits

```bash
cd ~/docpad-clean
git log --oneline -10
git push origin main
```

This has to run on your Mac; the sandbox has no GitHub credentials. The oldest of
the ten is the months of uncommitted work. Push it even if you want to review the
security ones separately.

## 3. Smoke-test while signed in (about 30 minutes)

I verified these by SQL and by unit-level checks, never by clicking through the app.

- [ ] Doctor: OPD queue, open an encounter, save a prescription.
- [ ] Prescribing safety: add a drug the patient is already on and confirm the
      duplicate-therapy banner appears, and that a contraindicated pair blocks the save.
- [ ] Send a prescription on WhatsApp, then open `/rx/<id>` in a private window. This
      should now work signed-out; it did not before.
- [ ] Follow-up: set a follow-up date on an encounter, save, and confirm the patient
      appears under "Expected today" on that date and checks in with a token.
- [ ] Reception: register a patient who already has a booking today and confirm it
      checks them in against the booking instead of creating a second entry.
- [ ] Privacy: register a new patient, tick a couple of consent purposes, then open
      `/dashboard/patients/<id>/privacy` and confirm they are listed.
- [ ] Nursing: ward list, vitals, MAR, a nursing task.
- [ ] IPD: open an admission (a daily note should be created), discharge summary draft, consents.
- [ ] Pharmacy: dispense. Reception: collect a lab payment.
- [ ] Admin: staff directory, invite a staff member, open the invite link in a private
      window and complete signup.
- [ ] Uploads: a lab report (OCR), an ECG, an insurance card.
- [ ] AI: patient summary, similar past prescriptions, ICD-10 suggestion.

If anything says "Not permitted: record belongs to another hospital" for a record that
**is** yours, send me the RPC name. That means one parameter of that function needs a
different scope rule and it is a one-line fix.
`supabase/rollbacks/20260917_security_hardening_rollback.sql` can reverse any single
piece if something blocks you at the hospital.

## 4. Turn on leaked-password protection

Supabase, Authentication, Policies, enable "Leaked password protection". It checks new
passwords against HaveIBeenPwned. One toggle, no API for it.

## 5. Set `CRON_SECRET` or no reminder will ever send

Vercel, Project, Settings, Environment Variables, Production. Any long random string;
`openssl rand -hex 32` gives you one. Vercel Cron sends it as `Authorization: Bearer
<value>`, and without it the reminder route answers 503 and sends nothing.

`TWILIO_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_NUMBER` are the same three the
prescription-link feature already uses, so if WhatsApp works today they are already set.

`vercel.json` schedules two runs, in UTC: 12:30 UTC (18:00 IST) for tomorrow's bookings
and 02:30 UTC (08:00 IST) for today's. Change the `schedule` fields if the clinic wants
different hours.

To test it end to end without messaging a real patient:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-domain>/api/reminders/appointments?kind=day_before&dry=1"
```

It answers with how many bookings it would have messaged.

## 6. Publish a grievance officer

The DPDP Act requires one to be published to patients. Until you fill it in, the
registration form tells staff none exists and the patient-facing contact line is blank.
An admin does it once at `/data-rights`: name, phone, email, and how many years records
are kept.

Two things worth knowing while you are there. Patients registered before today have no
consent row, because nothing was stored at the time and back-filling one would be
inventing evidence; take consent at their next visit, which is a few clicks on their
privacy page. And a correction request can only change demographic fields (name, phone,
date of birth, sex, blood group, address, ABHA address) — clinical content is
deliberately not correctable this way, since an amendment to a clinical record should be
a new entry rather than an overwrite.

## 7. Add one GitHub secret (optional, 2 minutes)

`SUPABASE_DB_URL` in the repo's Actions secrets (Supabase, Project Settings, Database,
Connection string, URI, session pooler). That switches on the nightly "Database isolation
tests" workflow, which asserts no hospital can see another's data. Without it that
workflow skips itself; typecheck, lint and build run either way.

Once it is set you can also run the 40 database assertions yourself any time:

```bash
cd ~/docpad-clean
SUPABASE_DB_URL="<uri>" npm run test:db
```

---

## 8. Decide: backups

I need you to pick before I can build it. The code in `app/api/admin/backups/*` assumes
`pg_dump`, which cannot run on Vercel, and the tables it writes to (`backup_logs`,
`backup_worker_settings`, `hospital_backup_schedule`) plus the `hospital-backups` bucket
exist only in a local migration file that was never applied. So right now there is no
working backup at all.

Supabase Pro scheduled backups cost around $25/mo, restore the whole project including
schema, and need no code from me. A per-hospital encrypted logical export (SQL, AES-GCM,
into Storage, on a schedule) works on your current plan and gives each hospital its own
file, but it covers data only, not schema, and I have to build and maintain it.

## 9. Migration drift — run two commands on your Mac

`supabase/migrations` and the live database no longer agree, so `supabase db push` is
unsafe. The fix starts on your machine, which has network access to the database:

```bash
cd ~/docpad-clean
supabase link --project-ref hvjbzlwlqnntwxgufjkm
supabase db pull        # writes a baseline migration from the live schema
```

Then I reconcile the older files against that baseline and you get a migrations folder
that can actually be replayed onto a fresh project. This is also what unblocks having a
staging environment, which the SOW asks for.

## 10. Tell me which SOW items to build next

Still open from the Phase 1 SOW, all of them things I can do without you:

- 2.7: brand and generic prescription search, the inline prescription writer that
  replaces the modal, and realtime queue status for patients.
- A seed-data framework so a fresh project comes up with a usable demo hospital.
- The clinical-safety CI suite (the drug interaction and allergy rules as tests that
  run on every push, not just the isolation tests).
- An OWASP-style review pass over the whole app.

## 11. Finish the ICD-10 embeddings (one command, a few minutes)

15,347 of the 73,790 codes were ingested without an embedding: all of chapters F
(mental health), H (eye and ear), O (pregnancy), P (perinatal), Q (congenital), U, and
V/W/X/Y (external causes). They are findable today only by wording, not by meaning, so
"senile cataract" will not reach "age-related cataract".

Run this in Terminal on your Mac, not in the Claude workspace, which has no internet:

```bash
cd ~/docpad-clean
node scripts/backfill-icd10-embeddings.mjs --dry     # counts, embeds nothing
node scripts/backfill-icd10-embeddings.mjs
```

It reads `.env.local` (all three values it needs are already there), has no
dependencies, and is resumable.

**Blocked on the Gemini free tier.** Measured, not guessed: the quota is
`EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier`, limit **1000 requests
per day**, and `batchEmbedContents` counts every embedding in the batch as a request.
850 are done; the remaining 14,397 would take about 15 days of running this once a
day. Enabling billing on the Google Cloud project behind that key lifts the cap and
the job finishes in minutes, for roughly 300k tokens of embedding - cents.

Worth deciding on its own merits, not just for this job: the same 1000/day applies to
the live app. Every prescription save, every similar-prescriptions lookup and every
ICD suggestion spends one embed request, and the text-generation calls have their own,
lower, daily cap. A clinic seeing fifty patients a day will hit these in ordinary use.

Not blocking anything meanwhile: the chapters without embeddings are still reachable
through the lexical and synonym layers. "Senile cataract of right eye" correctly
returns H25.11 today with zero embeddings in chapter H.

---

---

### Where each SOW item actually stands, 18 Sep 2026

Read this column carefully. "Mechanism built" and "clinically usable" are not the
same claim, and I was reporting the first as though it were the second.

**2.1 audit trail — done.** 83 tables carry `zz_audit_row`, the trigger is
append-only, PHI reads are logged. Here the mechanism *is* the deliverable.

**2.2 prescribing safety — NOT done.** `check_prescription_safety` works end to
end: aceclofenac plus warfarin comes back `severe`, with management advice in
English and Hindi. But `drug_interactions` holds 24 curated pairs. Warfarin plus
aspirin returns clean. To a prescriber, silence reads as clearance, which makes a
thin table worse than no checker at all. Nothing here should be called finished
until the content question is settled, and that is the RxNorm-versus-SNOMED
decision you have parked.

**2.3 DPDPA — mechanism built, not in force.** Consent register, grievance
register and the correction workflow all exist and are covered by the test suite.
Live: zero consent rows, no grievance officer published. That is item 6 below,
and it needs you rather than me.

**2.5 appointments — the booking desk now exists.** Before today,
`schedule_follow_up` was the only thing in the product that could create a future
appointment, so a patient who telephoned could not be booked at all. That is why
`booking_source` had never held anything but `walk_in` and why the reminder cron
had never had a row to act on. Added: `book_appointment`,
`reschedule_appointment`, `cancel_appointment`, `upcoming_appointments`, a
Bookings tab on the reception page and a booking modal. Ten pgTAP assertions
cover it, including that another hospital cannot book, move or cancel your
patients.

**4 FHIR — done.** An OP Consult document Bundle on every encounter.

**ICD-10 — working, incomplete.** 58,543 of 73,790 codes embedded, 850 staged,
14,397 waiting on the Gemini daily cap. The lexical and synonym layers carry the
unembedded chapters, so nothing is broken; it is a quality ceiling, not an outage.

**Tenancy — done.** No table in `public` is without RLS; the only
anon-executable definer functions are the seven intended ones.

### Fixed today

A bug of mine from yesterday: `schedule_follow_up` writes `visit_type = 'follow_up'`,
but the Expected-today panel tested for `'scheduled_follow_up'`, a value the table's
check constraint does not even permit. Every follow-up you booked from an encounter
was displaying to the doctor as "New visit".

Also closed a Supabase advisor finding: `icd10_lexeme_df` is a materialized view, so
RLS does not apply to it and PostgREST was serving the ICD-10 ranking internals to any
signed-in user. Revoked.

### Still open, and honestly labelled

- 2.2 content. Blocked on your decision, not on me.
- 2.7: brand and generic prescription search, the inline prescription writer, realtime
  queue status for patients.
- A seed-data framework so a fresh project comes up with a usable demo hospital.
- The clinical-safety CI suite.
- An OWASP-style review pass.
- 144 ESLint errors. Around 24 of them (`react-hooks/purity`, `refs`, `immutability`)
  look like real render-time bugs rather than style.
