# DocPad breakage triage (Vercel)

*Started 18 Oct 2026. Working document: update the Status column as items are confirmed or fixed.*

The suspects in section 3 come from reading the code on 17–18 Oct 2026. Triage steps 1–6 ran on 18 Oct (see section 8): each suspect's Status column says whether it was confirmed, ruled out or fixed, and section 4 holds everything new found along the way. **Section 7 is the current work list.**

**Status values:** `Suspected` (from code reading) · `Confirmed` (seen in the app or logs) · `Not reproduced` · `In progress` · `Fixed` (link the PR) · `Deferred` (say until when)

**Priority:**

| Priority | Meaning |
|---|---|
| **P0** | Breaks the demo path (Fri 30 Oct) or exposes data |
| **P1** | Breaks a module needed for the MVP (Fri 18 Dec) |
| **P2** | Breaks something outside the MVP, or is cosmetic |

The **demo path** is the scripted journey in `docs/architecture/TARGET-ARCHITECTURE.md` §10.2:

1. Registration
2. OPD consult with voice
3. Prescribing with an allergy stop
4. WhatsApp and `/rx`
5. Pharmacy dispense
6. Lab OCR
7. Billing
8. Admin audit

---

## 1. One-time setup

None of these tools is installed on the dev machine yet. Run them from the Claude Code prompt with a `!` prefix so the output lands in the session.

```bash
brew install node@22 gh            # Node 22 matches CI
npm i -g vercel
vercel login                       # opens a browser
gh auth login                      # opens a browser
cd ~/docpad-clean
vercel link                        # pick the DocPad project
vercel env pull .env.local         # pulls Development env vars only
npm ci
```

`vercel env pull` fetches only the Development environment by default. To compare Production values, run `vercel env ls` (names only) or `vercel env pull --environment=production .env.prod.local`. Never commit either file.

---

## 2. Triage procedure

Work through these steps in order. Record every new finding in section 4 before fixing it.

1. **Build parity.** Run `npm run build && npm run typecheck && npm run lint`. A failure here is a failure on Vercel too. Fix these first.
2. **Deployment history.** `vercel ls` shows the deployments. For any that errored, run `vercel inspect <deployment-url> --logs`.
3. **CI.** `gh run list --limit 20`, then `gh run view <id> --log-failed`. Remember that `db-safety-tests.yml` passes green when the `SUPABASE_DB_URL` secret is missing, so a green run proves nothing until that secret exists.
4. **Environment variables.** Run `vercel env ls` and fill in the checklist in section 5. Several suspects below are just missing variables.
5. **Runtime logs.** Run `vercel logs <production-url>`, or use the dashboard → Logs, filtered to status ≥ 500. Note the route and the error message for each failing request.
6. **Route walk.** Sign in as each role and open every item in its sidebar with the browser console open. Fill in section 6.
7. **Sort and fix.** Order the fixes as follows:
   1. P0
   2. P1 on the demo path
   3. other P1
   4. P2

   For anything not on the demo path, prefer hiding it (`hospitals.enabled_modules`, `lib/navConfig.ts`) over fixing it this week.

---

## 3. Known suspects (from code reading)

### Configuration and environment

| ID | Symptom on Vercel | Cause | How to verify | Fix | Pri | Status |
|---|---|---|---|---|---|---|
| B-01 | Admin and server queries return empty results or permission errors, with no clear error | `lib/supabase/admin.ts:7` silently falls back to the **anon key** when `SUPABASE_SERVICE_ROLE_KEY` is missing | `vercel env ls` (Production and Preview); test a route that uses the admin client, e.g. `/api/whatsapp` | Set the key. Make `admin.ts` throw instead of falling back. | P0 | Not reproduced. The key is set in Production, Preview and Development (`vercel env ls`, 18 Oct). The silent fallback is still in the code, so keep the throw fix. |
| B-02 | AI features fail: voice extraction, lab OCR, insurance OCR, ECG, discharge compile | `lib/supabase/server.ts:95` needs `GEMINI_API_KEY` and falls back to `NEXT_PUBLIC_GEMINI_API_KEY` | `vercel env ls`; call `/api/ai/generate` while signed in | Set `GEMINI_API_KEY` (server only). Delete `NEXT_PUBLIC_GEMINI_API_KEY` from Vercel and the code. Rotate the key, which has already been exposed. | P0 | Confirmed (env, 18 Oct). `GEMINI_API_KEY` is absent from every environment and `NEXT_PUBLIC_GEMINI_API_KEY` is present in all three. AI routes probably work through the fallback, but the key ships to the browser. |
| B-03 | AI routes return errors under load | Gemini quota or rate limits (HTTP 429); the ICD-10 backfill already hit this | Logs: 429 from `generativelanguage.googleapis.com` | Raise the quota. Add retry with backoff and a readable error in the UI. | P1 | Suspected |
| B-04 | Appointment reminders never send | `app/api/reminders/appointments/route.ts:66-68` returns **503** when `CRON_SECRET` is unset | Vercel → Cron Jobs → run history; `vercel env ls` | Set `CRON_SECRET` in Production. Trigger once by hand and check that a WhatsApp message arrives. | P1 | Not reproduced at env level. `CRON_SECRET` is set in Production only, which is correct. Cron run history has not been checked yet. |

### Clinical and IPD

| ID | Symptom on Vercel | Cause | How to verify | Fix | Pri | Status |
|---|---|---|---|---|---|---|
| B-05 | Generating a discharge summary fails | `components/ipd/discharge-summary-modal.tsx:830` invokes edge function `generate-discharge-summary`, which **does not exist** in `supabase/functions/` | Open an IPD admission → discharge → generate; check the console | Call the existing `/api/ipd/compile-discharge-clinical` route instead | P1 | Suspected. Code re-checked 18 Oct: the call is still at line 830 and there is still no such function. |
| B-06 | Encounter workspace shows two DocPad headers and competing navigation | Nested app chrome in `app/dashboard/opd/encounter/[id]/page.tsx` (known gap 7 in `CLAUDE.md`) | Open any OPD encounter | Remove the inner header; rely on the sidebar shell | **P0** (demo step 2) | Confirmed (route walk, 18 Oct): second DocPad nav bar under the shell header. |

### Registration and ABHA

| ID | Symptom on Vercel | Cause | How to verify | Fix | Pri | Status |
|---|---|---|---|---|---|---|
| B-07 | Registering a patient with the ABHA option fails at OTP verify | `lib/abhaEnrollment.ts:63` calls RPC `abha_verify_otp`, which is **not defined** in any migration. OTP sending is mocked (`txnId "mock-123"`, line 29 commented out). | Register a patient and choose ABHA; look for PostgREST error `PGRST202` | **Demo:** hide the ABHA option on registration. **MVP:** real ABDM v3 enrolment (see architecture §17). | **P0** (demo step 1) | Suspected. Code re-checked 18 Oct: `abha_verify_otp` appears only in an exclusion list in `20260917170926_rpc_hospital_scope_guards.sql`; no migration creates it. Confirm in the live DB. |
| B-08 | ABHA linking and ABDM consent actions always fail with 401 | `hooks/useABHALinking.ts:114,168` and `components/abdm/ConsentApprovalModal.tsx:79` send the **anon key** as the bearer instead of the user's session token. `ABDM_GATEWAY_URL` is also unset, so calls would fail anyway. | Click "Link ABHA" on a patient summary; check the network tab | **Demo:** hide the ABHA link button and the consent bell. **MVP:** send the session token; rebuild on v3. | P1 | Suspected |
| B-09 | A patient's ABHA field holds an Aadhaar or mobile number | `components/abdm/ABHALinkModal.tsx:104` writes `chosen` into `patients.abha_id`, and `chosen` can be the raw identifier the user typed. This also breaks the rule in `CLAUDE.md` that Aadhaar is never written to Postgres. | Read the code path. Query `patients` for `abha_id` values that are 10 or 12 digits long. | Write only an ABHA returned by the gateway. Clean any bad rows. | **P0** (data protection) | Suspected |
| B-10 | ABDM consent bell stays empty; "processed" never sticks | Webhook rows in `abdm_webhook_inbox` have no `hospital_id`, so RLS hides them. There is no UPDATE policy. | Query `abdm_webhook_inbox` with the service role | Defer to the ABDM v3 rebuild | P2 | Suspected |
| B-11 | Any signed-in user can obtain the ABDM gateway token | Edge function `abdm-auth` returns the token to the browser | Read `supabase/functions/abdm-auth/index.ts:22-24` | Delete or disable the function | P1 (security) | Suspected |

### Admin, devices and platform

| ID | Symptom on Vercel | Cause | How to verify | Fix | Pri | Status |
|---|---|---|---|---|---|---|
| B-12 | "Run backup" fails | `lib/backup/runHospitalBackup.ts:33,50` spawns `pg_dump`, which is not available on Vercel. The encryption key is also discarded, so backups could never be restored. | Admin → system security → run backup; logs show `spawn pg_dump ENOENT` | Hide the backup UI. Enable Supabase PITR instead (MVP item). | P1 | Suspected |
| B-13 | ECG digitisation fails or is blocked as mixed content | `components/investigations/ECGViewer.tsx:14` defaults to `http://127.0.0.1:8000`, so a browser on Vercel calls its own localhost. The service is not deployed. | Open an ECG investigation; check the console | Hide the digitiser unless `NEXT_PUBLIC_ECG_DIGITIZER_URL` is set | P2 | Suspected |
| B-14 | `/admin/analytics/clinical` is broken | Known gap in `CLAUDE.md` | Open the page as admin | **Demo:** hide the nav item. Fix later. | P1 | Not reproduced as a broken page (route walk, 18 Oct): it renders, but counts 0 encounters although 2 completed ones fall in its default range. |
| B-15 | Many routes never get past a spinner, or show "Coming soon" | About a third of mapped routes are stubs (`CLAUDE.md` known gap 6). "Coming soon" appears in: `app/dashboard/page.tsx`, `app/dashboard/opd/encounter/[id]/page.tsx`, `app/admin/dashboard/investigation-panels/page.tsx`, `components/ipd/PreAdmissionAssessmentPage.tsx`, `components/investigations/OCRUploadModal.tsx`, `components/pharmacy/PharmacyInventory.tsx`, `components/pharmacy/DrugTableRow.tsx` | Route walk (section 6) | **Demo:** hide via `enabled_modules` / `navConfig.ts`. **MVP:** finish or remove. | **P0** (demo) | Confirmed (route walk, 18 Oct): nurse home is an onboarding screen with IPD "Coming Soon"; investigation panels "Coming soon"; `/nursing` as admin never leaves its skeleton. |
| B-16 | The same screen exists at several URLs; `/ipd/*` has no role gating | Duplicate route trees (`app/opd`, `app/dashboard/opd`, `app/ipd`, `app/dashboard/ipd`, `app/pharmacy`, `app/dashboard/pharmacy`). `proxy.ts` does not match `/ipd`, `/rx` or `/join`. | Open `/ipd` as a pharmacist | Pick one canonical tree; make `proxy.ts` deny by default | P1 | Suspected. Code re-checked 18 Oct: the `proxy.ts` matcher also omits `/patients`, `/data-rights` and `/register`. Confirmed (route walk, 18 Oct): pharmacist and lab both open `/ipd` and `/ipd/beds`. |
| B-17 | `/billing/insurance` shows dark text on a dark background in light mode | Hard-coded surface colours: 31 dark-colour classes in `app/billing/insurance/page.tsx` (`CLAUDE.md` conventions) | Open the page in light mode | Replace them with theme tokens | P2 | Not reproduced (route walk, 18 Oct): readable in light mode. Dark mode not checked. |

### Not breakages, but they hide breakages

| ID | Issue | Action |
|---|---|---|
| W-01 | `db-safety-tests.yml` passes green when `SUPABASE_DB_URL` is unset | **Corrected 18 Oct:** the secret has been set since 18 Sep 2026, and the job failed every day from 20 Sep (see N-01, N-02). The problem was that nobody noticed the red runs. **Green again from 18 Oct 06:35 UTC** after N-01, N-02, N-19 and N-20. Still to do: turn on failure notifications; repoint the secret at **staging** once W-03 exists. |
| W-04 | Vercel Hobby plan keeps runtime logs for **30 minutes** only. The Vercel MCP log tools return 403 for this team. | Read logs live during the route walk (`vercel logs --environment production`), or move to Pro for longer retention. Error tracking (W-02) matters more because of this. |
| W-02 | No error tracking; only `console.*` | Add error tracking in W2–W4 (GlitchTip, using the Sentry SDK). Until then, use Vercel runtime logs. |
| W-03 | No staging project; testing happens against production | Create the demo/staging project in W1 (architecture §10.2) |

---

## 4. Found in logs (fill in during triage)

| ID | Route / screen | Error (exact text, first line) | Seen in | First seen | Linked suspect | Pri | Status |
|---|---|---|---|---|---|---|---|
| N-01 | Database (any signed-out caller via `/rest/v1/rpc`) | `not ok 2 - only the public RPCs and RLS helpers are anon-executable`. 15 extra SECURITY DEFINER functions are anon-executable: `list_hospitals_for_platform_admin`, `set_hospital_live`, `provision_hospital`, `invite_first_admin`, `is_platform_admin`, `get_encounter_draft`, `save_encounter_draft`, `clear_encounter_draft`, `fn_fhir_opd_encounter`, `trg_set_mobile_hash`, `trg_recalc_invoice_from_child`, `trg_set_encounter_visit_type`, `trg_assign_cr_number`, `trg_block_unsafe_prescription`, `trg_lock_finalized_encounter` | CI (`db-safety-tests.yml`, `rls_isolation.sql`) | 2026-09-20 | — | **P0** (data protection) | Fixed: `20261018070000_revoke_anon_execute_security_definer.sql`, applied 18 Oct. Bodies reviewed first: each already refused anon internally, so no data was exposed; anon could only learn whether an encounter id exists (from `save_encounter_draft`'s error text). `rls_isolation.sql` now passes 50/50. Cause: EXECUTE granted to PUBLIC, which anon inherits. |
| N-02 | Migrations | `4 migration(s) applied to the database with no file in the repo.` (`20260919175302 hospital_onboarding_pipeline`, `20260919180005 provision_hospital_creates_organization`, `20260919180144 fix_set_hospital_live_blocker_array`, `20260920070955 encounter_server_drafts`) | CI (`check-migration-drift.mjs`) | 2026-09-20 | N-01 (these probably created most of the N-01 functions) | P1 | Fixed 18 Oct: the 4 files were written from `schema_migrations` in the restore script's format, without archiving anything else (the script itself archives the whole folder and needs `psql`). Committed; drift check reports `394 applied, 394 files`. The live-only `sync_practitioner_email` trigger (N-08) is in none of them; it predates migration tracking. |
| N-03 | Deployment `docpad-clean-po99vbc6f` | `Error: The \`CRON_SECRET\` environment variable contains leading or trailing whitespace, which is not allowed in HTTP header values.` | build | 2026-09-20 | B-04 | P2 | Fixed (the next deployment, also 20 Sep, built; all later ones are Ready) |
| N-04 | Dependencies | `27 vulnerabilities (1 low, 8 moderate, 16 high, 2 critical)` | `npm ci` | 2026-10-18 | — | P1 (until reviewed) | Confirmed. Run `npm audit` and check whether the critical ones are reachable. |
| N-05 | Vercel env | All secrets (`SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_AUTH_TOKEN`, API keys) are type `Config`, not Sensitive, and are also in Development, so `vercel env pull` writes them to every laptop | `vercel env ls` | 2026-10-18 | B-01, B-02 | P1 (security) | Confirmed. When rotating keys, re-add them as Sensitive, for Production and Preview only. |
| N-07 | Sign-in as a lab technician | Lab staff land on the doctor home (`/dashboard/opd`), not `/lab`. The admin invite screen stores `lab_technician` (`app/admin/page.tsx:17`), but `lib/dashboardRoleRouting.ts` matches `/\blab\b/`, and `_` counts as a word character, so `lab_technician` never matches. | code (`node -e` regex test) | 2026-10-18 | — | **P0** (demo step 6, Lab OCR) | Fixed in code on 18 Oct (`lib/dashboardRoleRouting.ts`: `/(^|[^a-z])lab([^a-z]|$)/i`); deployed in `de3a22c`; verified on production 18 Oct: lab lands on `/lab`. |
| N-08 | Any direct insert into `practitioners` (API, scripts) | `permission denied for table users` (42501). The live-only trigger `sync_email_on_insert` / `sync_practitioner_email()` read `auth.users` as the calling role. The repo's version (`practitioners_sync_email_from_auth`, `20260406060000`) does not exist in the DB. | seed script | 2026-10-18 | N-02 | P1 | Fixed: `20261018050000_sync_practitioner_email_security_definer.sql`, applied by hand in the SQL Editor on 18 Oct; post-check `prosecdef = true`, anon/authenticated cannot execute. |
| N-09 | Lab role, demo step 6 | `new row for relation "practitioners" violates check constraint "practitioners_role_check"`. `role` and `user_role` checks allow only admin, doctor, nurse, pharmacist, receptionist. The invite screen offers "Lab Tech" (`lab_technician`), which can never become a practitioner. | seed script | 2026-10-18 | N-07 | **P0** (demo step 6) | Fixed: `20261018060000_allow_lab_technician_role.sql`, applied 18 Oct. It turned out to be four constraints, not two: `invitations_role_check` and `role_permissions_role_check` also refused the role, so a Lab Tech invite failed at its first insert. Lab gets `patients:read` and `encounters:read`. |
| N-10 | Admin → invite staff (`app/admin/page.tsx`) | Every invitation is inserted with `hospital_id: ORG_ID`, a constant `e90e4607-dd60-4821-b736-02a2577432e0` (line 8), whatever hospital the admin belongs to | code | 2026-10-18 | — | **P0** (tenancy) if this page is live | Suspected. Confirm which page serves invites (`/admin` vs `/admin/dashboard/staff-directory`) and whether RLS on `invitations` would reject the cross-tenant insert. |
| N-11 | Every signed-in page (`components/CurrentUserBadge.tsx`) | `404 GET /rest/v1/profiles?select=full_name,display_name,role…` (no `profiles` table) and `400 GET /rest/v1/practitioners?select=…,sub_role…` (no `sub_role` column) | console (route walk) | 2026-10-18 | — | P1 | Fixed in code on 18 Oct: the badge reads `practitioners` only, without `sub_role`. Verified on a local production build: no failed REST calls on any role's landing page. Deployed in `de3a22c`; verified on production 18 Oct. |
| N-12 | Sign-in, all roles | Nurse, pharmacist, lab and admin land on `/dashboard/opd`, not their home. `app/page.tsx:140` always does `router.push("/opd")` ("Temporary: skip role fetch"); `/opd` redirects to `/dashboard/opd`, which their allowed prefixes accept. | route walk | 2026-10-18 | B-16 | **P0** (demo steps 5, 6, 8 start from the wrong screen) | Fixed in code on 18 Oct: sign-in pushes to `/dashboard`, which `proxy.ts` redirects to each role's home. Verified on a local production build: all 6 roles land on their home (lab needs N-07, verified together). Deployed in `de3a22c`; verified on production 18 Oct, all 6 pass. |
| N-19 | CI, `db-safety-tests.yml` run 39102806386 | `psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory` | CI | 2026-10-18 | W-01 | P1 | Confirmed. The `SUPABASE_DB_URL` secret was re-set at 05:22 UTC after the password reset, but its value is not a URL psql recognises (likely quotes, a `SUPABASE_DB_URL=` prefix or whitespace), so psql falls back to a local socket and no suite runs. Fixed by the owner on 18 Oct: run 39103829013 connects; clinical safety passes; billing then fails on N-20. |
| N-20 | Billing, any hospital except the first | `duplicate key value violates unique constraint "invoices_invoice_number_key"`. Numbers are allocated per hospital (`INV-2026-000001` up), but this index made them unique across all hospitals, so every other hospital's first invoice fails. All 18 existing invoices are in one hospital, which is why it never showed. | billing suite (it now picks a demo-clinic patient) | 2026-10-18 | — | **P0** (demo step 7: the demo clinic cannot invoice) | Fixed: `20261018080000_invoice_number_unique_per_hospital.sql` drops the global index, applied 18 Oct; billing suite 13/13. Same day, `20261018090000_invoice_number_advisory_lock.sql` (applied) makes concurrent saves in one hospital queue on an advisory lock instead of colliding on `max + 1`; `scripts/test-invoice-number-lock.mjs` failed before it and passes after, and now runs in CI. Open business question: numbering resets each calendar year, while GST Rule 46 wants a serial per financial year (April to March). Also: `trg_invoices_auto_number` never fires (its WHEN sees the number already set) and is dead code. |
| N-13 | `/billing/insurance` | `400 GET /rest/v1/tpas?select=id,name&hospital_id=eq.…` and the same for `insurance_companies`: neither table has a `hospital_id` column | console (route walk) | 2026-10-18 | — | P1 | Confirmed. Panels never load. |
| N-14 | `/nursing` (nurse) | `404 POST /rest/v1/rpc/get_nursing_shift_tasks`. The function exists, so the call's arguments do not match its signature. | console (route walk) | 2026-10-18 | — | P1 | Confirmed (404); cause suspected. |
| N-15 | Staff directory | `400 POST /rest/v1/rpc/get_clinical_specialties_for_filter` | console (route walk) | 2026-10-18 | — | P2 | Confirmed; cause not checked. |
| N-16 | Patient photos | `400 POST /storage/v1/object/sign/patient-photos/<id>.jpg`, including `unknown.jpg` | console (route walk) | 2026-10-18 | — | P2 | Confirmed. The app requests signed URLs for photos that do not exist instead of checking first. |
| N-17 | `/dashboard/opd` (doctor) | Counters disagree: "2 Scheduled today" vs "Expected today 4"; "Waiting room 0" while reception shows 3 in the queue | route walk screenshot | 2026-10-18 | — | P1 (demo step 2) | Explained 18 Oct, seed shape not an app bug: the waiting room lists only queue rows with `payment_collected` or `payment_override`, and Collect/Override appear only when a consultation price exists. The seed now creates a price list; a registered, queued and paid walk-in reaches the waiting room. "Scheduled today" vs "Expected today" mismatch still unexplained. |
| N-18 | Encounter view (doctor) | Finalised seeded encounter shows empty chief complaint and diagnosis; treating doctor shows "Pending" | route walk screenshot | 2026-10-18 | — | P2 | Suspected seed shape: the seed writes `chief_complaint` / `working_diagnosis`, which the encounter UI may not read. Check before treating as an app bug. |
| N-21 | Prescribing, any patient registered at reception | Amoxicillin for a patient whose registration lists "Penicillin" shows only the amber `Check before continuing … cross-reacts with a recorded allergy to Penicillin`; **Finalize stays enabled**, and a direct insert as the doctor is **not blocked** by the database. The same drug for a patient with a structured `patient_allergies` row is blocked by both. Registration writes allergies only to `patients.known_allergies` (free text), which the matcher never treats as a blocking drug allergy. | click-through + rolled-back insert | 2026-10-18 | — | **P0** (clinical safety, real patients, not only the demo) | Confirmed. Fix: registration writes structured `patient_allergies` rows (category from `allergen_groups`), and/or an unclassified free-text allergy that matches a drug or drug group blocks as "ungraded drug allergy". |
| N-22 | Every AI feature: lab OCR, insurance OCR, ECG, discharge compile, ICD suggestion, patient summary, dictation extraction | Gemini: `This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash` (`/api/ocr/process` → 502). `/api/ai/generate` allows only `gemini-2.5-*`, so dictation's `gemini-3.6-flash` gets `400 {"error":"Model not allowed."}` | click-through; direct API test | 2026-10-18 | B-02, B-03 | **P0** (demo steps 2 and 6) | Confirmed. With this key, `gemini-3.6-flash` and `gemini-3.8-flash` answer; `gemini-2.5-flash` is 404. `gemini-2.5-flash` is hard-coded in 9 files, 2 of them edge functions (`generate-patient-summary`, `suggest-icd10`), which need a redeploy. |
| N-23 | Pharmacy queue (pharmacist) | "0 orders" while `pharmacy_ordered_prescription_queue` holds the demo clinic's rows. RLS on `opd_encounters` requires `has_permission(uid, 'encounters', 'read')`; the pharmacist role has no such row, so the view's join to encounters returns nothing. | click-through; query as the pharmacist | 2026-10-18 | — | **P0** (demo step 5: nothing can be dispensed) | Confirmed. Fix: `role_permissions` row (pharmacist, encounters, read). **Correction to N-09:** `role_permissions` *is* read by RLS (via `has_permission`) on `opd_encounters`, `patients`, `prescriptions`, `vitals` and `hospital_inventory`. |
| N-24 | Invoice → Record payment | `409 record_payment: Key (collected_by)=(…) is not present in table "practitioners"` (`payments_collected_by_fkey`). `PaymentRecordModal` passes the auth user id; the column references `practitioners.id`. | click-through | 2026-10-18 | — | **P0** (demo step 7: no invoice can be marked paid) | Confirmed. Fix: pass the practitioner id, as the lab-payment path already does. |
| N-25 | Invoice detail and PDF | `400 patients?select=…gender…address` (`column patients.gender does not exist`) and `400 hospitals?select=name,address…` (`column hospitals.address does not exist`). Detail page shows `Patient: <uuid>`; the PDF is headed "Hospital", says "Patient details unavailable.", and renders the rupee sign as "¹" in the Unit column. | click-through; downloaded `invoice-INV-2026-000002.pdf` | 2026-10-18 | — | **P0** (demo step 7) | Confirmed. Live columns are `sex`, `address_line1`. |
| N-26 | Invoice line tax | A price-list item defined as `gst_12` / 12 % lands on the invoice with Tax % empty and total tax ₹0 | click-through | 2026-10-18 | N-20 | P1 (GST) | Confirmed. The charge definition's tax is not carried onto the line. |
| N-27 | Lab orders, every hospital | `auto_create_investigation_charge()` begins `if tg_op = 'insert'`; `TG_OP` is `'INSERT'`, so the trigger never prices an order. The only price path is the "Pricing required" box shown once right after ordering; leave the page and the order has no charge, so it never reaches "Pending lab payments" or the lab queue. Live hospital: 40 orders, 14 charges. | click-through; trigger source | 2026-10-18 | — | **P0** (demo step 6) | Confirmed. Fix: `'INSERT'`. The trigger then matches price-list items by `display_name ilike '%' || test_name || '%'`. |
| N-28 | Encounter workspace | Chief complaint and diagnosis added in the UI are lost on reload (no save until "Save as draft" / finalise). "Save & close" then finalised the encounter with an empty required chief complaint, and it is now locked. | click-through; DB row | 2026-10-18 | — | P1 (demo step 2) | Confirmed. Required-field check missing on finalise. |
| N-29 | Encounter workspace | Input typed in the first ~10 s is dropped; one load lost its data ("Unknown Patient", "Unassigned") after `Lock "lock:sb-…-auth-token" was released because another request stole it` | click-through | 2026-10-18 | B-06 | P1 (demo step 2) | Confirmed. Several Supabase clients on the page race for the auth lock. |
| N-30 | Vitals | `500 patient_latest_vitals: infinite recursion detected in rules for relation "patient_latest_vitals"`. Separately the doctor role has no `vitals` permissions in `role_permissions`. | click-through; `role_permissions` | 2026-10-18 | — | P1 | First confirmed; second suspected (vitals entry not exercised). |
| N-31 | Encounter workspace | `400 prescriptions?select=…drug_name…` (`column prescriptions.drug_name does not exist`) and `400 opd_prescriptions?select=…medicine_name…` | click-through | 2026-10-18 | — | P2 | Confirmed. |
| N-32 | Reception → Add to queue | `400 POST appointments: Could not find the 'updated_at' column of 'appointments'` (PGRST204). The queue row is created anyway, with no appointment behind it. | click-through | 2026-10-18 | — | P1 | Confirmed. |
| N-33 | Reception → Add to queue | "Assigned doctor" lists the lab technician and the admin | click-through | 2026-10-18 | N-09 | P2 | Confirmed. `lib/doctorAssignmentOptions.ts` excludes only nurse, pharmacist and receptionist. |
| N-34 | Prescription preview and confirm popover | Shows DocPad ID `DCP-2ADFFA` (derived from the patient UUID) while the chart says `DCP-307464`; C/O and O/E print "Nil" although set; signature line "Dr. Doctor" | click-through screenshot | 2026-10-18 | — | P1 (patient identity on a printed Rx) | Confirmed. The public `/rx` page shows the correct `DCP-307464`. |
| N-35 | Pharmacy stock | Finalising a 10-tablet line left stock at 200. Lines are saved as `Dolo 650 [Paracetamol]`; stock is matched by name (`brand_name ILIKE` / `generic_name ILIKE` in `dispense_prescription`), which never matches that form. | click-through; DB | 2026-10-18 | — | P1 | Finalise side confirmed; dispense side not yet testable (N-23). |
| N-36 | Admin audit view (staff directory → Performance) | Red `column ipn.doctor_id does not exist` from `rpc/get_staff_performance_summary`; the activity log never renders. The audit trail itself is complete: today's demo actions are all in `audit_logs`, including `patient:READ_PUBLIC_LINK`. | click-through; DB | 2026-10-18 | — | **P0** (demo step 8) | Confirmed. |
| N-37 | `/rx/[id]` | Date shows the previous day for viewers west of UTC: `new Date("2026-10-18")` is UTC midnight | click-through (EDT machine) | 2026-10-18 | — | P2 | Confirmed; correct in India. |
| N-38 | Missing database functions | `generate_encounter_prescription_receipt` (pharmacy per-visit receipt and dispense), `apply_advance_wallet_payment` and `set_invoice_line_item_unit_price` (reception billing page), `get_lab_queue_external` (lab External tab) do not exist live | DB check | 2026-10-18 | — | P1 | Confirmed. `dispense_prescription` itself exists live and, unlike the repo file, has no `status = 'ordered'` filter. |
| N-06 | Build | `[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///…/tailwind.config.ts … is not specified` | build | 2026-10-18 | — | P2 | Confirmed, harmless. Build, typecheck and lint all pass (lint: 0 errors, 193 warnings). |

---

## 5. Environment variable checklist

Tick each one after `vercel env ls`. **S** means the variable must be server-only and must never have a `NEXT_PUBLIC_` copy.

Checked 18 Oct 2026 with `vercel env ls`. ☑ = set, ☒ = missing (or present when it must be absent). Every variable below that is set is also set in Development.

| Variable | Needed by | Prod | Preview | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything | ☑ | ☑ | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything | ☑ | ☑ | |
| `SUPABASE_SERVICE_ROLE_KEY` **S** | admin client, API routes | ☑ | ☑ | B-01; rotate (exposed). Stored as `Config`, not Sensitive (N-05) |
| `GEMINI_API_KEY` **S** | AI routes, server actions | ☒ | ☒ | B-02; rotate (exposed) |
| `NEXT_PUBLIC_GEMINI_API_KEY` | — | ☒ **present** | ☒ **present** | B-02; must be removed |
| `GEMINI_OCR_MODEL`, `GEMINI_ECG_MODEL` | OCR, ECG routes | unset | unset | optional overrides; code defaults apply |
| `ASSEMBLYAI_API_KEY` **S** | voice routes | ☑ | ☑ | |
| `TWILIO_SID`, `TWILIO_AUTH_TOKEN` **S**, `TWILIO_WHATSAPP_NUMBER` | WhatsApp Rx, reminders | ☑ | ☑ | |
| `RESEND_API_KEY` **S** | email (edge function) | ☑ | ☑ | set in Vercel too; the edge function reads it from Supabase |
| `CRON_SECRET` **S** | reminder crons | ☑ | — | B-04; Production only is correct. Stored as `Secret` |
| `DATABASE_URL`, `SUPABASE_DB_URL` **S** | backups, scripts | ☒ | ☒ | B-12; not needed on Vercel if the backup UI is hidden |
| `DATABASE_BACKUP_INTERNAL_SECRET` **S** | internal backup route | ☒ | ☒ | B-12 |
| `NEXT_PUBLIC_APP_URL` | links in messages, `/rx` | ☒ | ☒ | must be the production domain; check what WhatsApp links fall back to (demo step 4) |
| `NEXT_PUBLIC_SNOMED_INDIA_REFSET` | SNOMED search | ☒ | ☒ | check the code default |
| `NEXT_PUBLIC_ECG_DIGITIZER_URL` | ECG viewer | unset ☑ | unset ☑ | B-13 |
| `NEXT_PUBLIC_DEV_BYPASS_CONSENTS` | dev only | absent ☑ | absent | must never be on in production |
| `GOOGLE_DOCUMENT_AI_API_KEY`, `GOOGLE_DOCUMENT_AI_ENDPOINT` | not in this list before | ☑ | ☑ | find which route uses them |

---

## 6. Route walk

Sign in as each role and open each page. **OK** means the page loads with real data and the console has no errors.

**Walked 18 Oct 2026** by a headless Chromium script (Playwright) against production, signed in as each seeded demo account. It navigates only; it does not click actions, so the interactive rows (prescribing, dictation, discharge, OCR upload, ABHA registration) are still open. Every page also shows the two global errors in N-11; "Console" below lists anything beyond those.

**Landing after sign-in:** reception → `/reception` ✓, doctor → `/dashboard/opd` ✓, nurse, pharmacist, lab and admin → `/dashboard/opd` ✗ (N-12). **Re-checked after `de3a22c` deployed:** all 6 land on their own home ✓, and the N-11 errors are gone.

| Role | Route | Loads | Data | Console errors | Notes / suspect ID |
|---|---|---|---|---|---|
| Reception | `/reception` | ✓ | ✓ 3 walk-ins, tokens OPD-001…003 | — | |
| Reception | `/reception/beds` | ✓ | | — | |
| Reception | `/reception/billing/[patientId]` | ✓ | | — | |
| Reception | registration form (new patient) | not tested (needs clicks) | | | B-07 |
| Doctor | `/dashboard/opd` | ✓ | ⚠ "2 Scheduled today" but "Expected today 4"; waiting room 0 although the queue has 3 | `TypeError: Failed to fetch` once | N-17 |
| Doctor | `/dashboard/opd/encounter/[id]` | ✓ | ⚠ finalised encounter shows empty complaint and diagnosis; treating doctor "Pending" | `patient-photos/unknown.jpg` sign 400 | B-06 **confirmed**: second DocPad nav bar (Dashboard · Patients · Encounters · Analytics · Settings) under the shell header. N-18 |
| Doctor | prescribe + allergy stop + finalise | not tested (needs clicks) | | | |
| Doctor | voice dictation | not tested | | | B-02, B-03 |
| Doctor | `/dashboard/ipd`, an admission, discharge | ✓ list loads; no admissions seeded | | — | B-05 not tested |
| Doctor | `/admin/analytics/clinical` | redirected to `/dashboard/opd` | | | correct gating |
| Nurse | `/dashboard` (nursing home) | ⚠ onboarding "Customize your DocPad experience", IPD card "Coming Soon"; greets "Dr. Rekha Thomas" | | — | B-15 **confirmed** |
| Nurse | `/nursing` | ✓ | ⚠ | `404 rpc/get_nursing_shift_tasks` | N-14 |
| Pharmacist | `/dashboard/pharmacy`, inventory, audit | ✓ all three | | — | |
| Lab | `/lab`, OCR upload | ✗ redirected to `/dashboard/opd` at walk time; ✓ lands on `/lab` since `de3a22c` | | | N-07, N-09 (both fixed). OCR upload not tested |
| Billing | `/billing`, invoices, an invoice PDF | ✓ page loads (as reception and admin) | no invoices seeded | — | PDF not tested |
| Billing | `/billing/insurance` | ✓ readable in light mode | ⚠ panels fail to load | `400 tpas`, `400 insurance_companies` | B-17 **not reproduced** in light mode. N-13 |
| Admin | `/dashboard/admin` | ✓ | | — | |
| Admin | `/admin/analytics/clinical` | ✓ page renders | ⚠ "Encounters counted: 0" although 2 completed encounters fall in the default range | — | B-14: not broken as a page; data empty |
| Admin | `/admin/dashboard/investigation-panels` | ⚠ "Coming soon" | | — | B-15 |
| Admin | `/nursing` | ✗ skeleton never resolves | | auth-token lock "stolen" errors | B-15 |
| Admin | staff directory | ✓ | | `400 rpc/get_clinical_specialties_for_filter` | N-15 |
| Public | `/rx/[id]` from a WhatsApp link | inconclusive | | — | tried the prescription row id; page says "Link Invalid or Expired". Needs a real link from a send. |
| Any | `/ipd` as a non-clinical role | ✗ opens for pharmacist and lab (`/ipd`, `/ipd/beds`) | | | B-16 **confirmed** |

### 6b. Click-through of the demo path (18 Oct 2026)

Driven with Playwright against production as the seeded demo accounts, clicking the real controls. Demo-clinic data only. The seed gained a price list and pharmacy stock first, without which steps 2, 3, 5 and 7 cannot start.

| Demo step | What was done | Result | Findings |
|---|---|---|---|
| 1 Registration | Reception: + New patient → mobile-only path → details, consent, allergy → Create patient → Add to queue → Collect ₹500 | ✓ patient created, queued as OPD-004, "Consultation fee collected · ₹500". Consent is enforced. | N-21 (allergy stored as free text only), N-32, N-33 |
| 2 OPD consult | Doctor: waiting room → start chart → SNOMED complaint and diagnosis | ✓ waiting room fills after payment; SNOMED search answers in 2.5–4 s. ✗ edits lost on reload; empty encounter could be finalised. | N-28, N-29, N-30, N-31, B-06 |
| 2 Voice | Dictation with a fake microphone | Token route 200; recording never started headless (needs a human with a mic). Extraction would fail regardless. | N-22 |
| 3 Prescribing | In-house search → Dolo 650 → BD, 5 days → Add → Finalise | ✓ line saved and finalised (`final`). ✗ stock not decremented. | N-34, N-35 |
| 3 Safety checks | 5 cases through the real modal | ✓ Ramesh + amoxicillin **blocked**; ✓ Ramesh + cefuroxime **advised**; ✓ Mohammed + warfarin **blocked** (Severe, with management text); ✓ Arjun + paracetamol clear; ✗ **reception-registered penicillin allergy + amoxicillin only advised** | N-21 |
| 4 WhatsApp and `/rx` | Public `/rx/<encounter id>` signed out | ✓ renders patient, drug, frequency, duration; correct DocPad ID. Send not tested (sandbox; finalised Rx disables Send). | N-37; `NEXT_PUBLIC_APP_URL` unset (§5) |
| 5 Dispense | Pharmacist queue | ✗ queue always empty | N-23, N-38 |
| 6 Lab OCR | Doctor orders CBC → reception Mark Paid → lab Collect Sample → Enter Result → upload report → Run OCR | ✓ order, payment and collection work once priced by hand. ✗ auto-pricing never fires; ✗ OCR 502 (retired Gemini model). | N-27, N-22 |
| 7 Billing | New invoice (consultation + knee brace) → Generate bill → Download PDF → Record payment | ✓ `INV-2026-000002` issued (N-20 fix holds). ✗ GST not applied; ✗ patient shown as UUID; ✗ PDF has no hospital or patient; ✗ payment fails | N-24, N-25, N-26 |
| 8 Admin audit | Staff directory → doctor → Performance | ✗ error banner, no activity log. ✓ `audit_logs` records every action. | N-36 |

---

## 7. Next steps (as of 18 Oct 2026)

In priority order. Demo is Fri 30 Oct.

1. **Click-through test of the demo path.** **Done 18 Oct**, results in §6b, findings N-21 to N-38. Still needs a human: live voice dictation with a real microphone, and a WhatsApp send to a sandbox-joined phone. Re-run after the fixes below.
1a. **Fixes the click-through found, for the demo path** (proposed, not applied):
   - *Database (needs approval before applying):* N-23 pharmacist `encounters:read`; N-27 `tg_op = 'INSERT'`; N-21 make reception-entered drug allergies block.
   - *Code (one PR):* N-22 replace `gemini-2.5-flash` and widen the `/api/ai/generate` allowlist (then redeploy the 2 edge functions); N-24 pass the practitioner id to `record_payment`; N-25 use `sex` / `address_line1` on the invoice and PDF and fix the rupee glyph; N-26 carry tax onto invoice lines; N-36 fix `get_staff_performance_summary` or show the activity log on its own; N-28 require chief complaint before finalising.
2. **P0 code fixes for the demo** (one PR): B-06 (second nav bar on the encounter screen), B-15 (hide nurse home onboarding, investigation panels, admin `/nursing`), B-07 (hide the ABHA option at registration), N-10 (invite page hard-codes one hospital id).
3. **P0 data protection, B-09.** Stop writing a typed Aadhaar or mobile number into `patients.abha_id`; query for 10- and 12-digit values and clean any found.
4. **Owner tasks.** B-02: add `GEMINI_API_KEY` in Vercel, delete `NEXT_PUBLIC_GEMINI_API_KEY`, rotate the key. N-05: re-add secrets as Sensitive, Production and Preview only. W-01: turn on failure notifications for the DB safety job.
5. **P1 before the MVP.** B-16 (`proxy.ts` deny by default), N-13 (insurance panels), N-14 (nursing tasks RPC), N-17 (OPD counters), B-05 (discharge summary), B-11 (`abdm-auth` token), B-12 (hide backup UI).
6. **Decisions from the 19 Oct stakeholder meeting.** W-03 staging environment; W-02 and W-04 error tracking and log retention; N-20 GST financial-year invoice numbering.

---

## 8. Log

| Date | What was done | By |
|---|---|---|
| 2026-10-18 | Tracker created from code reading; nothing confirmed yet | Hunar |
| 2026-10-18 | Steps 1–5 run. Step 1: build, typecheck and lint pass. Step 2: all recent deployments Ready; one old error (N-03, fixed). Step 3: DB safety job red daily since 20 Sep (N-01, N-02); clinical safety and billing suites pass. Step 4: section 5 filled in. Step 5: only 30 minutes of logs retained (W-04); no 5xx in that window. Code re-checked for B-05, B-07, B-16. Steps 6–7 not started: the route walk needs a browser and a login per role. | Hunar |
| 2026-10-18 | Demo seed extended and run: one account per role except lab (N-09). Seed needed an `organizations` row (audit FK) and the N-08 trigger fix. Found N-08, N-09, N-10. | Hunar |
| 2026-10-18 | N-09 migration applied; N-07 fixed in code (not deployed); lab account seeded. Headless route walk of section 6 (navigation only): B-06, B-15, B-16 confirmed; B-17 not reproduced; found N-11 to N-18. | Hunar |
| 2026-10-18 | N-07, N-11, N-12 deployed (`de3a22c`) and verified on production. N-01 fixed (no data exposed), N-02 files restored, N-19 secret fixed by owner, N-20 fixed plus advisory lock and its concurrency test. All DB suites pass; safety job green from 06:35 UTC. Section 7 added. | Hunar |
| 2026-10-18 | Click-through of the demo path (§6b). Seed extended with a price list and pharmacy stock, and its teardown fixed. 4 of 5 prescribing safety checks pass; found N-21 to N-38, including a clinical-safety gap (N-21) and a retired AI model behind every AI feature (N-22). | Hunar |
