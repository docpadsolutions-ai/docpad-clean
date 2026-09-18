# DocPad Phase 1 — scope audit against the live build

Against **DocPad Phase 1 SOW Final (v1.5)**, Client DocPad, Vendor Megsys Digital,
₹4,00,000 excluding GST, four landmarks L1 to L4.

Audited 18 September 2026 against the running Supabase project
`hvjbzlwlqnntwxgufjkm` and the `main` branch of `docpad-clean`. Every line below was
checked in code or in the database. Where something could not be verified it says so
rather than guessing.

Three labels are used, and the distinction is the whole point of this document:

- **Built** — the clause is satisfied and would survive a demonstration.
- **Partial** — something real exists, but a named part of the clause does not.
- **Not built** — no implementation found, with the search stated.

---

## Section 2 — items brought into Phase 1

### 2.1 Immutable append-only audit log — Built

83 tables carry the `zz_audit_row` trigger. The append-only guarantee is enforced at
the database, not in application code. Read access is restricted correctly: the only
SELECT policy on `audit_logs` requires both `hospital_id = auth_hospital_id()` and
`_caller_is_hospital_staff_admin(hospital_id)`. The acceptance test the SOW names —
a direct UPDATE or DELETE against the audit table fails at the database layer — is
covered in `supabase/tests/rls_isolation.sql`.

Not delivered, and not required: audit-viewer UI beyond a basic filterable table,
retention-policy automation, formatted export. All three are explicitly out of scope.

### 2.2 Active medication display and reconciliation at prescribing — Built (scope), with a content caveat that is not Megsys's

All four scope bullets exist. Active medications derived from prior finalised
encounters are shown inside the prescription writer. `check_prescription_safety`
runs the interaction check against that active list, not only within the current
prescription. Per-medication continue / stop / modify is recorded against the
encounter. Duplicate-therapy warning fires on a match.

The caveat is separate from the contract. `drug_interactions` holds **24 curated
pairs**; warfarin plus aspirin returns clean. The SOW says the work is to reuse "the
existing drug-drug interaction engine", so the Vendor is not on the hook for the
content of that table. It is still a clinical risk, because to a prescriber silence
reads as clearance. This is Client-side work, or a Phase 2 line item, and it should
be named as one rather than left implicit.

Two real defects found here, both Vendor-side:

- The hard stop is a `disabled` attribute on three buttons. It is not checked inside
  `handleFinalizePrescription` or `handleWhatsAppSend`, and there is no guard in the
  `finalize_prescription` RPC or on the `prescriptions` insert. Any client that
  POSTs directly writes the prescription regardless. §3.2 retains hard stops for
  severe allergy and severe interaction "unchanged", which a greyed-out button does
  not deliver.
- Allergy conflicts are a substring match against free-text allergy fields, and every
  match is treated as a hard stop. §3.2 says severity-graded. Severity grading exists
  for interactions only.

### 2.3 DPDPA data-principal rights — Built, awaiting data

Grievance officer contact surfaces at registration and on the patient-facing consent
record. The data-principal request register is logged, timestamped and status-tracked.
The correction workflow runs request to admin review to amendment, with the amendment
captured in the audit log per §2.1. The consent register is exportable per patient and
carries `notice_version`, purpose, timestamp and current status, stamped server-side
from `hospitals.privacy_notice_version`.

Live state: zero consent rows, and no grievance officer published. The obligation
attaches from the first live patient record, so this is a go-live blocker that needs
the Client to fill in a form, not more build.

### 2.4 ABDM — sandbox validation through to production certification — **Not built. Largest gap in the engagement.**

This is L3 and L4, 30% of the contract value, and almost none of it exists.

- `ABDM_GATEWAY_URL` is not set anywhere. Every edge function that does call the
  gateway resolves it through `requireEnv` at runtime, so as configured today
  `abdm-auth`, `abha-link-init`, `abha-link-confirm`, `consent-approve` and
  `hi-data-transfer` all throw `Missing required environment variable` on first call.
- `abha-enrol` is a hardcoded mock. Its caller `lib/abhaEnrollment.ts` is also mocked,
  with the real invoke commented out and replaced by `{ status: "SUCCESS", message:
  "Mock OTP Sent", txnId: "mock-123" }`. ABHA creation at registration does not talk
  to ABDM at all.
- `consent-approve` points at a path the code itself flags as a placeholder.
- No record anywhere of sandbox registration, client-id, HIP-ID or HIU-ID state. No
  M1, M2 or M3 scenario results. No NHA validation logs. Searched the whole tree for
  sandbox, certification, milestone and the ABDM host names; the only hits are prose
  in a markdown note and an `"sbx"` default for `X-CM-ID`.
- HFR and HPR are free-text fields on the hospital profile and staff directory. Nothing
  validates them or looks them up against a registry.
- No onboarding runbook.

Section 2.4 carries a shared-risk clause for NHA turnaround and for Client-side facility
registration. That clause protects the Vendor against NHA delay. It does not cover work
not started.

### 2.5 Appointment booking and follow-up differentiation — Built as of 18 Sep 2026

Booking with reconciliation against walk-ins in the same queue; encounter type
distinguished on the record as new, scheduled follow-up or unscheduled return and
carried into the FHIR Composition (`build_opd_consult_bundle` emits it); follow-up
scheduled from within the encounter at the point the advice is given, with interval
and reason; booked follow-ups auto-populate the assigned doctor's queue; follow-up may
be modified or cancelled with the change recorded.

Until 18 September the desk-side half did not exist: `schedule_follow_up` was the only
writer of a future appointment anywhere in the product, so a patient who telephoned
could not be booked. `book_appointment`, `reschedule_appointment`, `cancel_appointment`
and `upcoming_appointments` were added, with a Bookings tab on reception. Ten pgTAP
assertions cover it.

Outstanding: WhatsApp reminders are coded and scheduled in `vercel.json` but have never
sent, because `CRON_SECRET` is not set in Vercel. The route answers 503 without it.

Note for the record: `appointments.visit_type` and `opd_encounters.visit_type` use two
different vocabularies (`new|follow_up|review|procedure` against
`new|scheduled_follow_up|unscheduled_return`). The encounter vocabulary is the one the
SOW names. The panel that displays booked patients was comparing appointment rows
against the encounter vocabulary, so every follow-up displayed as "New visit"; fixed
18 September.

### 2.6 Speech-to-text — in-situ model and single-pass transcription — **Not built**

The clause asks for a medically pre-trained LLM deployed in situ, replacing external
API-based inference, and complete-encounter transcription in a single pass.

What exists is the opposite on both counts. Transcription is **AssemblyAI**, external,
streaming, turn by turn. Clinical extraction is **Gemini 2.5 Flash**, external. SNOMED
resolution is **CSIRO Ontoserver**, external. There is no local inference of any kind:
no ollama, llama.cpp, vllm or whisper dependency, and no local model endpoint.

Transcription is also not single-pass over an encounter. Each microphone session is
scoped to one field — complaint, examination, diagnosis, plan, advice — not to the
consultation. There is no ambient recorder. A batch whole-file route exists at
`app/api/voice/transcribe/route.ts` but no client code calls it, and
`transcriptions.session_id` is always inserted as null.

The pipeline order the SOW preserves (transcription, extraction, SNOMED lookup, doctor
confirmation) is three-quarters present. **The confirmation step is not a gate.**
Extracted content is written straight into chart state. The extraction row is persisted
with `doctor_confirmed: false` and nothing in the repository ever sets it to true. What
exists instead is post-hoc: amber chips for low confidence, an edit popover, per-chip
removal. The clause says "Nothing is committed to the record without explicit clinician
confirmation."

§11.4 asks the Vendor to state model, hosting, latency and **recurring infrastructure
cost per month** before signature. None of that has been answered, and the running cost
falls on the Client under §7.

### 2.7 Minor additions to scope already priced

- **Brand and generic prescription search — Built.** The writer searches registry and
  in-house stock together on either, and resolves to the generic for print via
  `formatAbdmMedicationLabel`. One hole: manual free-text entries carry
  `active_ingredient: "Unknown"` and so print brand-only, which is not NMC-compliant.
- **Prescription writer opens inline within the encounter flow, not as a modal — Not
  built.** It is still `components/PrescriptionModal.tsx`.
- **Realtime queue status surfaced to the patient by notification — Not built.** Realtime
  is wired in twelve places, all staff-side. The only signed-out route in the product is
  `/rx/[id]`.

---

## Section 3.3 — clinical safeguard retained at no additional scope

Investigation advice must remain capturable as structured plan text within the SOAP
note and **must appear on the printed and WhatsApp-delivered outputs**.

**Partial.** Capture works: a free-text advice box with quick-add pills including
"Review in 3 days", persisted as `plan_details.advice_notes`, plus a separate structured
`planInvestigations`. It reaches the printout. It does not reach WhatsApp. The POST body
sends only medications and lab summary text, the message template has no plan slot, and
`get_public_prescription` — which backs the `/rx/[id]` page the WhatsApp link opens —
returns no `plan_details`, no `quick_exam`, no diagnosis, no ICD-10 and no follow-up
date. So "CBC and X-ray advised, review in 3 days" never reaches the patient.

---

## Section 4 — retained without change

This is the section most at risk of being assumed done because it predates the
restructure.

### Engineering foundation (Proposal v1.0 §2.1)

- **Separate STAGING and PRODUCTION environments, production credentials not held by
  developers — Not built.** There is one environment. No staging project, no
  `.env.staging`, no staging target in `vercel.json`. §5 requires all acceptance testing
  to be performed on staging, so this blocks acceptance itself, not just deployment.
- **CI on every merge with a clinical-safety test suite as a blocking gate — Partial.**
  `ci.yml` runs typecheck, lint and build. `db-isolation-tests.yml` runs 50 RLS and audit
  assertions plus a migration-drift check, but skips itself silently when
  `SUPABASE_DB_URL` is absent, which it currently is. There is no clinical-safety suite:
  no test asserts that a contraindicated pair blocks, or that a severe allergy blocks.
- **Migration discipline — Partial.** Drift detection was added 18 September
  (`scripts/check-migration-drift.mjs`, wired into CI) after the folder was found to hold
  173 files of which 93 had never been applied, against 296 applied migrations with no
  file. All 375 were recovered from `schema_migrations.statements`. The
  `information_schema` verification before DDL, and schema-reload notification, are not
  implemented.
- **Seed-data framework producing a realistic OPD day — Not built.** `scripts/` holds
  ICD-10 ingest, embedding backfill, migration tooling and one insurance-coverage SQL
  file. No seed framework, no `supabase/seed.sql`. §11.2 asks whether it doubles as an
  audit dataset; there is nothing to answer about.
- **Resolution of the shared `checklist_type` defect — Unverified.** The identifier
  appears in one migration and in the baseline schema. Whether the defect is resolved
  cannot be determined without the Vendor's statement of what the defect was, which
  §11.2 requests.

### Registration and front desk (§2.2)

- Demographics and mobile number: built, with `+91` validation.
- **Photo at registration: Not built.** The `patient_photos` table and the
  `patient-photos` bucket exist and `PatientAvatar` reads from them, but nothing in the
  product ever writes one. Camera capture exists for clinical attachments and insurance
  cards, neither wired to registration.
- **Duplicate detection via mobile hash: Not built as specified.** A `mobile_hash`
  column exists on `patients` and is dead — one schema line, zero references. Duplicate
  detection is real but keyed on an **Aadhaar** SHA-256 via `check_patient_exists`.
  Functionally reasonable, contractually a different clause, and it fails for any patient
  without Aadhaar.
- DPDPA purpose-bound versioned consent: built, see 2.3.
- **ABHA creation and linking: Partial.** Linking supports both Aadhaar-OTP and
  mobile-OTP. Creation at registration is Aadhaar-only and, as noted in 2.4, mocked.
- **Failure paths: Not built.** OTP timeout has no implementation anywhere — no
  countdown, no resend, no expiry state. Patient-declines has no implementation — the
  registration ABHA step offers only "Send OTP" and "Verify & continue", with "Start
  over" as the sole escape. Not-linked is partially handled with a message and a chip,
  but no persisted status and no retry.
- Realtime reception queue with token flow, doctor assignment, live status and wait-time
  display: **Built.**

### Patient safety and identification (§2.3)

- **Persistent patient banner on every clinical screen — Partial, and thin.** The shared
  component `PatientEncounterBanner` exists and is good. It is used on **exactly one
  page**, the OPD encounter. IPD rolls a bespoke strip. Lab, nursing, triage, OPD
  investigations (both views), the encounters list and IPD investigations render no
  patient identity block at all.
- **CR number — does not exist.** No `cr_number` column, no equivalent, anywhere in the
  schema or the code. The banner has no prop for it. The clause names it explicitly
  alongside DocPad ID.
- **Confirmation prompt before every prescription and finalisation action — Partial.**
  `PatientActionConfirmPopover` exists and shows photo, name, age/sex and DocPad ID. On
  prescribing it gates **opening** the writer, not saving; reopening and saving needs no
  re-confirmation, and the pharmacy dispense screen has none. On encounter finalisation
  there is no confirmation at all: "Save & close" and "Save & next patient" are plain
  buttons.
- **Duplicate detection with merge-review path — Not built.** On a duplicate hit,
  registration hard-stops with "Patient already registered as …". There is no same-person
  / different-person / merge branch. A name-similarity helper flags similar names visually
  in lists, which is not a merge-review path.

### Encounter and clinical documentation (§2.4)

- **SOAP-based encounter card — Partial.** The zones exist and are in the right order —
  chief complaint, examination, working diagnosis, plan, with triage notes and vitals —
  but nothing is labelled subjective, objective, assessment or plan. Zero occurrences of
  "subjective" or "objective" on the OPD encounter page. Actual SOAP labelling exists
  only on the IPD daily-notes side.
- **Specialty context from the practitioner's primary specialty — Partial.** The page
  reads both `primary_specialty` and `specialty`, but drives every voice and SNOMED
  surface from `specialty`, falling back to a department dropdown and then to a hardcoded
  "General Medicine". `primary_specialty` is used only for a surgical-specialty gate.
- **Three-tier SNOMED lookup — Partial, and the third tier is a different product.** All
  three tiers exist inside `search_snomed_cached`: doctor frequency, concept cache,
  ILIKE fallback. But the chief-complaint and diagnosis pickers both pass an ECL and a
  cache filter, which sets `skipRpc` and bypasses tier 1 entirely; only the voice path
  reaches it. And the external fallback is **CSIRO Ontoserver**, not Snowstorm. The SOW
  names Snowstorm; the word appears in the repo once, in a comment.
- **Vitals positioned with the chief complaint — Partial.** Same screen, same grid row,
  different columns: complaint in the main column, Quick vitals in the right sticky
  aside, with a quick-action that scrolls to it.
- **Continuous autosave with visible autosave state — Partial, and the weaker half is
  missing.** There is a continuous client-side draft to `sessionStorage`, rehydrated on
  load, with a navigation guard and a beforeunload handler. There is **no timed or
  debounced save to the database** on the OPD encounter, and **no visible autosave
  indicator**. The only save feedback is tied to explicit button clicks. A close a laptop
  and the draft survives in that browser tab only.
- **Explicit finalise action locking the encounter — Partial, and this is a defect.** The
  finalise action works and the UI locks convincingly: `inert` on the chart, a Finalized
  badge, disabled fields. **Nothing enforces it in the database.** The update policy on
  `opd_encounters` has no status predicate, and none of the six triggers on the table
  blocks a write to a completed row. Any client that PATCHes the row edits a finalised
  encounter. IPD discharge summaries do have a real lock, which shows the pattern was
  known.
- **FHIR Composition on finalisation, NRCES OP consult profile, `Encounter.class = AMB`
  — Built.** Present on all 37 encounters.

### Speech-to-text (§2.5 retained) — Built at parity

The existing pipeline is preserved and integrated. See 2.6 for what the restructure adds
on top and has not delivered.

### Prescribing (§2.6)

- Standard-dosage entry reusing the DDI engine: built.
- **Real-time safety checking during entry rather than on save — Built, with a nuance.**
  The check is a 300 ms debounced effect keyed off the added-medicines list. It fires
  after a line is confirmed with its dosage, not as the drug is typed or selected. That
  is during entry, well before save, and I would accept it.
- **NMC-compliant printed prescription — Partial on three of five fields.** Practitioner
  name and registration number are solid. Qualification is printed in the fallback header
  and signature block but is absent from the letterhead path, which passes only name,
  specialty and registration number. Generic naming works for catalog drugs and fails for
  manual entries. ICD-10 renders for the diagnosis but only the **first** one — the caller
  joins all diagnosis terms into a display string while taking `diagnosisEntries[0].icd10`
  — and procedures are passed with a SNOMED code only, so the procedure ICD-10 branch can
  never fire.
- **Dispensing routes: send to pharmacy, and print and hand to patient — Not built as two
  routes.** Both buttons call the same handler, which unconditionally inserts the lines,
  calls `finalize_prescription` and then unconditionally prints. There is no print-only
  path that skips the pharmacy queue, and no pharmacy-only path that skips printing.
  (Separately: the "Save Draft" button has no `onClick` handler at all.)
- WhatsApp share: built, staff-gated, recipient re-resolved server-side rather than
  trusted from the request body.

### Pharmacy handoff (§2.8) — Built

Routing into `pharmacy_ordered_prescription_queue` and a working dispense screen with
partial-dispense reasons, receipts and cancel. Inventory is deducted at prescribe time
rather than dispense time, which is flagged in-code as Phase 4 and is consistent with
full pharmacy inventory being out of scope.

### Cross-cutting (§2.9) — usable on 10-11 inch tablets — **Not built**

No tablet work of any kind. `tailwind.config.ts` extends colours only and overrides no
breakpoints. Zero `useMediaQuery`, `matchMedia`, `isTablet` or `isMobile` anywhere. The
single `@media` block in `globals.css` is `print`. Both primary clinical screens are
desktop-first on a single `lg:` (1024px) breakpoint, so a 10-11 inch tablet below that
width collapses into the mobile single-column stack. The dosage popover is
`min-w-[420px]`, which will not fit a 10 inch portrait viewport.

### Multi-tenancy — Built

Row-level tenancy keyed on hospital ID. No table in `public` is without RLS. The only
anon-executable SECURITY DEFINER functions are the seven intended ones. 50 pgTAP
assertions, including cross-tenant booking, reading and writing.

---

## Section 5 — revised acceptance criteria

| Gate | State |
| --- | --- |
| Clinical-UX composite ≥75/100 across the six in-scope categories | Never re-run since the baseline audit. No current score exists for any category. |
| RLS bypass attempts must fail in tests | **Met.** 50 assertions in `supabase/tests/rls_isolation.sql`. |
| OWASP Top-10 review at each landmark, findings closed before acceptance | Not done. No review, no findings register. |
| Automated regression suite covering all clinical safety paths and billing arithmetic | Not built. No test asserts a contraindicated pair blocks, a severe allergy blocks, or that an invoice totals correctly. |
| All acceptance testing on staging against scripted clinical scenarios reviewed by the Client | Cannot be met. There is no staging environment and no scripted scenarios exist. |

§11.6 records that the kick-off payment is not released until a detailed landmark-level
SOW including **the acceptance test scripts against which the Section 5 targets will be
measured** is issued and agreed in writing. That document does not exist in this
repository.

---

## What this adds up to

Ranked by materiality rather than by section order.

1. **ABDM (2.4)** — effectively not started. Two landmarks, 30% of contract value. The
   one enrolment path that registration depends on is a hardcoded mock.
2. **In-situ STT model (2.6)** — not started, and §11.4's running-cost question is
   unanswered, which is a recurring cost the Client bears for the life of the platform.
3. **No staging environment** — blocks the acceptance mechanism in §5, not only
   deployment.
4. **Finalised encounters are not locked in the database**, and **prescribing hard stops
   are not enforced past the button**. Both are clinical-safety clauses that look
   satisfied in a demonstration and are not satisfied in fact. These are the two I would
   raise first, because a staging demo passes them.
5. **Clinical-safety regression suite and OWASP review** — both named acceptance gates,
   neither started.
6. **Patient banner on one clinical screen out of nine, and no CR number in the schema.**
7. **Tablet usability** — no work at all, on a product intended to be used on a 10 inch
   tablet in clinic.
8. **Seed-data framework** — absent, and it is also what a demonstration needs.
9. **Registration gaps** — no photo, no mobile-hash duplicate detection, no merge-review,
   no OTP-timeout or patient-declines paths.
10. **Smaller and well-defined** — inline prescription writer, patient queue notification,
    plan text on the WhatsApp output, ICD-10 beyond the first diagnosis, qualification on
    the letterhead path, two genuinely separate dispensing routes.

Built and defensible: the audit log, DPDPA rights, appointments and follow-up
differentiation, the FHIR Composition, pharmacy handoff, multi-tenancy and the RLS test
suite.
