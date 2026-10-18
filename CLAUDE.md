@AGENTS.md

# DocPad — project guide for Claude

DocPad is a **multi-tenant hospital information system for the Indian market**: one
Next.js App Router application on Vercel, with Supabase (Postgres + RLS + Auth +
Storage + Realtime + Edge Functions) as the entire backend. It covers the whole
patient journey — registration → OPD/IPD encounter → clinical documentation (voice +
SNOMED) → prescribing with safety checks → pharmacy dispense → billing/insurance →
FHIR/ABDM export — with audit, DPDPA consent and per-hospital tenancy throughout.

Built to a fixed-scope SOW ("DocPad Phase 1 SOW v1.5"; Client: DocPad, Vendor: Megsys
Digital). Scope status lives in `SOW-STATUS.md`, the build plan in `PHASE1-PLAN.md`,
owner-only operational tasks in `RUNBOOK.md` / `SECURITY-TODO.md` / `YOUR-TODO.md`.
Read `SOW-STATUS.md` before claiming a feature is "done" — several things that look
built in the UI are not contractually complete.

Repo: `docpadsolutions-ai/docpad-clean`. The GitHub name says "clean" (a history
restructure); the product and the Supabase project are both called **Docpad**.

---

## Commands

```bash
npm run dev          # next dev
npm run build        # next build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint

# Database suites — all need $SUPABASE_DB_URL (session pooler URI)
npm run test:safety  # pgTAP: clinical safety (finalise lock, DDI, allergy hard stops)
npm run test:billing # pgTAP: invoice arithmetic identities
npm run test:db      # pgTAP: RLS cross-tenant isolation + audit
npm run test:all     # safety → billing → rls → migration drift
node scripts/check-migration-drift.mjs   # migrations/ vs DB, both directions

npm run seed:demo    # seed the demo hospital day
npm run seed:demo:reset
```

CI (`.github/workflows/ci.yml`) runs typecheck + lint + build on every PR.
`.github/workflows/db-safety-tests.yml` runs the three pgTAP suites and the drift
check — **but only if the repo secret `SUPABASE_DB_URL` is set**. Without it the job
passes green having asserted nothing. Check that before trusting a green run.

---

## Architecture

```
Browser (doctor / nurse / reception / pharmacy / lab / admin / patient)
  │  Next.js 16 App Router — mostly client components
  │
  ├─ supabase-js, RLS-scoped ──────────► Supabase Postgres
  │                                        • RLS on every public table, keyed hospital_id
  │                                        • SECURITY DEFINER RPCs (7 anon-executable)
  │                                        • append-only audit_logs (zz_audit_row, 83 tables)
  │                                        • Realtime (live queues), Storage buckets
  │
  └─ fetch() ──────────────► app/api/** route handlers (anything needing a secret)
                                │
                                └─► Gemini, AssemblyAI, CSIRO Ontoserver, Twilio, Resend

  Supabase Edge Functions (Deno, supabase/functions/): abdm-auth, abha-enrol,
  abha-link-init/confirm, consent-approve, consent-request-notify, abdm-consent-expiry,
  hi-data-transfer, generate-patient-summary, suggest-icd10, embed-interaction,
  send-expiry-alerts
```

**Stack:** Next.js 16.2.2 · React 19.2 · TypeScript 5 · Tailwind v4 · Radix UI ·
TanStack Table · react-window · Recharts · react-hook-form + Zod v4 · Zustand ·
`@react-pdf/renderer` · Supabase JS/SSR · Gemini 2.5 Flash · AssemblyAI · Twilio ·
Resend · `@noble/*` crypto (ABDM, Aadhaar/mobile hashing).

### Layout

| Path | What's in it |
| --- | --- |
| `app/` | Routes. `app/api/**` = route handlers (18), `app/actions/` = server actions |
| `components/` | Feature folders: `ipd/`, `billing/`, `abdm/`, `investigations/`, `prescribing/`, `nursing/`, `insurance/`, `ui/` … |
| `lib/` | ~100 modules: Supabase clients, SNOMED, FHIR builders, ABDM, IPD logic, medications, DPDPA, permissions, routing |
| `hooks/` | 21 React hooks (`usePrescriptionSafety`, `usePatientIdentity`, `useAppRole` …) |
| `supabase/` | `migrations/` (385 + 173 archived), `functions/`, `tests/`, `rollbacks/`, `sql/` |
| `scripts/` | Drift check, demo seed, ICD-10 ingest/embeddings, SNOMED vocab extraction |
| `services/ecg-digitizer/` | Standalone Python microservice (FastAPI-style), not part of the Next build |
| `docs/competitive/` | Competitive analysis vs Eka Care |

### Key `lib/` modules worth knowing

- **Supabase clients** — `lib/supabase/client.ts` (browser), `server.ts` (RSC/handlers),
  `admin.ts` (service role — **server only, never import into a client component**)
- **Routing/RBAC** — `lib/dashboardRoleRouting.ts`, `lib/navConfig.ts`,
  `lib/postLoginHomePath.ts`, `lib/permissions.ts`, `lib/userRole.ts`
- **Clinical** — `lib/clinicalVoicePipeline.ts`, `lib/geminiClinicalPrompt.ts`,
  `lib/snomedEclBuilder.ts`, `lib/snomedCsiroExpand.ts`, `lib/indiaSnomedRefsets.ts`
- **FHIR** — `lib/fhirEncounterTimeline.ts`, `lib/fhirMedicationRequest.ts`, `lib/fhirInvoice.ts`
- **ABDM** — `lib/abdm/encryption.ts`, `lib/abdm/fhir-builder.ts`, `lib/abdm/consent-filter.ts`
- **Identity** — `lib/patientIdentity.ts`, `lib/patientNameSimilarity.ts`, `lib/registerNewPatient.ts`

---

## Routing and RBAC

**`proxy.ts` at the repo root is this project's middleware.** Next.js 16 renamed
`middleware.ts` → `proxy.ts` and the export is `proxy()`, not `middleware()`. All
session checks, role gating and canonical redirects live there. Do not add a
`middleware.ts`.

The proxy resolves `practitioners.user_role` (falling back to legacy `role`), maps it
to a home path + allowed prefixes via `resolveDashboardRoutingFromRoleRaw()`, and
redirects anything outside those prefixes.

| Role | Home | Notes |
| --- | --- | --- |
| doctor / unknown | `/dashboard/opd` | `/opd` per `postLoginHomePath.ts` |
| nurse (incl. "Staff Nurse", "RN") | `/dashboard` | matched by regex, not just exact string |
| receptionist | `/reception` | |
| pharmacist | `/dashboard/pharmacy` | |
| lab technician | `/lab` | |
| admin | `/dashboard/admin` (or `/dashboard/opd` if also clinical) | `rawRoleHasAdminPrivileges()` |

Sidebar items come from `sidebarItemsForRole()` in `lib/navConfig.ts`, but **which
modules appear is also gated by the `hospitals.enabled_modules` feature-flag column**
(read in `components/RoleSidebar.tsx`). The sidebar is configuration, not hard-coded.

### ⚠️ Duplicate route trees

Several features exist at more than one path — `app/dashboard/opd/*` **and**
`app/opd/*`; `app/dashboard/ipd/*` **and** `app/ipd/*`; `app/dashboard/pharmacy/*`
**and** `app/pharmacy/*`; plus an `app/(dashboard)/` group holding `reception`, `lab`,
`nursing`, `patients`, `data-rights`. Some are live, some are stubs.

Before editing a screen, **confirm which path actually serves it** — check `proxy.ts`
redirects, `navConfig.ts` hrefs, and the route the running app lands on. Known
canonicalisations in `proxy.ts`: `/dashboard/reception` → `/reception`, and
`/dashboard/triage` → `/reception` (standalone triage is deprecated).

---

## Data

### Tenancy and safety — non-negotiable

- **RLS is the security boundary.** Every `public` table is RLS'd on `hospital_id` via
  `auth_hospital_id()`. Any new table needs policies in the same migration. 50 pgTAP
  assertions in `supabase/tests/rls_isolation.sql` cover cross-tenant isolation.
- **Audit is append-only.** `zz_audit_row` triggers on 83 tables write to `audit_logs`;
  UPDATE/DELETE on that table fail at the DB layer. Don't try to "clean up" audit rows.
- **Clinical safety is enforced in Postgres, not the UI.** Finalised encounters are
  locked; severe interactions and matching allergies block the write; cross-reactivity
  advises rather than refuses. If you touch prescribing, `components/PrescriptionModal.tsx`
  or `hooks/usePrescriptionSafety.ts`, run `npm run test:safety` — and note those two
  files are explicit path triggers on the DB-safety workflow.
- **Invoice arithmetic has identities asserted in SQL.** A discount once subtracted
  twice from `balance_due` — the number printed on a patient's invoice. Run
  `npm run test:billing` after any billing-math change.

### ⚠️ Migrations: the schema is NOT reconstructable from the repo

`supabase/migrations/` holds **incremental** changes only. The core baseline tables —
`patients`, `opd_encounters`, `prescriptions`, `hospitals`, `practitioners`,
`audit_logs`, `transcriptions`, `appointments` — exist only in the live database.
(Staff are `practitioners`, not a `staff` table — 59 call sites use `from("practitioners")`.)
The folder and the DB have drifted historically (93 orphan files vs 296 applied
migrations with no file).

- **Never run `supabase db push`.** It would apply orphan files to a schema that
  evolved differently.
- Apply migrations through the Supabase MCP `apply_migration` (or the dashboard), then
  commit the file.
- Run `node scripts/check-migration-drift.mjs` after any schema change.
- There is **no generated `database.types.ts`** — Supabase queries are untyped. Shape
  your own types at the call site; don't assume a column exists, check a migration or
  the live schema.

### Table domains (~101 in migrations + baseline tables in-DB)

- **Clinical core** — patients, opd_encounters, prescriptions, transcriptions, appointments
- **Problems/allergies** — active_problems, patient_allergies, allergen_groups,
  drug_interactions, medication_reconciliation
- **IPD (~35)** — ipd_admissions, ipd_beds, ipd_bed_transfers, ipd_wards, ipd_mar,
  ipd_nursing_vitals, ipd_progress_notes, ipd_discharge_summaries, ipd_doctor_orders,
  ipd_consult_requests, ipd_nabh_checklist, ot_rooms, ot_surgeries, pac_requests …
- **Pharmacy** — drugs, snomed_drug_map, stock_transactions, ward_inventory, vendors
- **Billing/insurance** — invoices, invoice_line_items, charge_items,
  charge_item_definitions, insurance_claims, preauth_requests, tpas, corporate_panels,
  patient_wallet, billing_audit_log
- **ABDM** — abdm_auth_tokens, abdm_consent_requests, abdm_subscriptions,
  abdm_webhook_inbox, abha_sessions, hip_link_requests, hi_data_transfers
- **Consent/DPDPA** — patient_consents, data_principal_requests, ipd_consents,
  clinical_procedure_consents
- **AI/terminology** — doctor_interaction_embeddings, clinical_synonyms, patient_summaries

### Standards

SNOMED CT for clinical terminology (via CSIRO Ontoserver — note the SOW named
Snowstorm; this is an open conformance item), ICD-10 for diagnosis coding, FHIR
Composition emitted on OPD encounter finalise (NRCES OP-consult profile,
`Encounter.class = AMB`), ABDM/ABHA for national health-ID interoperability, DPDPA
2023 consent, NABH 6th Edition clauses referenced in analytics. Regulatory source
documents live in the Claude project, not the repo.

**Aadhaar is hashed on-device (SHA-256) and never written to Postgres** — it goes only
to the ABHA Edge Function bridge. Keep it that way.

---

## Environment

Client-visible (`NEXT_PUBLIC_*`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_URL`,
`SNOMED_INDIA_REFSET`, `ECG_DIGITIZER_URL`, `DEV_BYPASS_CONSENTS`.

Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `GEMINI_API_KEY`,
`GEMINI_OCR_MODEL`, `GEMINI_ECG_MODEL`, `ASSEMBLYAI_API_KEY`, `RESEND_API_KEY`,
`TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `CRON_SECRET`,
`DATABASE_BACKUP_INTERNAL_SECRET`.

Edge functions (`Deno.env`): `ABDM_CM_ID`, `ABDM_HIP_ID`, `ABDM_HIU_ID`,
`ABDM_WEBHOOK_SECRET`, `ABDM_*_PATH`, plus `SUPABASE_*`, `GEMINI_API_KEY`, `RESEND_*`.

⚠️ `NEXT_PUBLIC_GEMINI_API_KEY` still appears in the codebase. A `NEXT_PUBLIC_` key is
shipped to the browser — **never introduce a new one for a secret**, and prefer
`GEMINI_API_KEY` server-side. Key rotation is tracked as an owner task in
`SECURITY-TODO.md`.

Deployment is Vercel; `vercel.json` defines two appointment-reminder crons (12:30 and
02:30 UTC) hitting `/api/reminders/appointments`, gated on `CRON_SECRET`.

---

## Conventions

- **Read the Next.js 16 docs in `node_modules/next/dist/docs/` before writing routing,
  caching or data-fetching code.** This version has breaking changes vs. older
  conventions (see `AGENTS.md`).
- Secrets live in route handlers or Edge Functions. Browser code talks to Supabase
  directly and is protected by RLS alone.
- Forms: react-hook-form + Zod. Tables: TanStack Table, virtualised with react-window
  where long. Toasts: sonner. Charts: Recharts.
- Theming goes through Tailwind tokens and `next-themes`. **Don't hardcode surface
  colours** — the Billing module currently does, which makes `/billing/insurance`
  render dark-on-dark in light mode. Fix toward tokens, don't copy the pattern.
- Design language: Geist Sans/Mono, slate + blue (`#1d4ed8`), 12px card radius, 8px
  inputs, flat surfaces with 1px hairline borders rather than shadows.
- The ECG digitizer is Python and deploys separately; don't wire it into the Next build.

---

## Known gaps — don't mistake these for bugs to fix silently

1. **ABDM (L3+L4)** — effectively not started. `ABDM_GATEWAY_URL` is unset and
   `abha-enrol` is a hardcoded mock. Needs NHA sandbox credentials plus HFR/HPR
   registration. Largest gap in the engagement.
2. **In-situ speech-to-text model** — not built. Current STT is external
   (AssemblyAI + Gemini), not the contracted medically-pretrained in-situ model.
3. **No staging environment** — blocks the SOW §5 acceptance mechanism.
4. **Drug-interaction content is 24 curated pairs.** Warfarin + aspirin returns clean.
   A clinical risk, flagged as Client/Phase-2 content work — the engine is fine, the
   data isn't there.
5. **Tablet (10–11") usability** — no breakpoint work done.
6. **~1/3 of mapped routes** never resolve past a loading state, say "Coming soon", or
   are thin stubs. `/admin/analytics/clinical` is a known broken page.
7. **Nested app chrome** — the encounter workspace renders a second DocPad header
   inside the sidebar shell, giving two competing navigations on the most important
   screen in the product.
