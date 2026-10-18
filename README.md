# DocPad

A multi-tenant hospital information system for the Indian market — one Next.js
application covering the full patient journey: registration → OPD/IPD encounter →
clinical documentation (voice + SNOMED CT) → prescribing with safety checks →
pharmacy dispense → billing and insurance → FHIR/ABDM export, with audit, DPDPA
consent and per-hospital isolation throughout.

Built to the "DocPad Phase 1 SOW v1.5" fixed scope. Client: DocPad. Vendor: Megsys Digital.

> **Status: a build in progress, not a finished product.** See
> [`SOW-STATUS.md`](SOW-STATUS.md) for what is and isn't contractually complete
> before treating any screen as a specification.

---

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16.2.2 (App Router), React 19.2, TypeScript 5 |
| Styling | Tailwind CSS v4, Radix UI primitives, Geist, `next-themes`, lucide-react |
| Data / UI | TanStack Table, react-window, Recharts, react-hook-form + Zod v4, Zustand |
| Backend | Supabase — Postgres + Row-Level Security + Auth + Storage + Realtime + Edge Functions (Deno) |
| AI | Google Gemini 2.5 Flash (clinical extraction, discharge NLP, ICD-10 suggestion), AssemblyAI (speech-to-text) |
| Terminology | SNOMED CT via CSIRO Ontoserver; ICD-10 for diagnosis coding |
| Messaging | Twilio (WhatsApp), Resend (email) |
| Hosting | Vercel |

---

## Getting started

Requires Node 22 (matching CI) and access to the project's Supabase instance.

```bash
npm ci
# create .env.local with the variables listed under "Environment" below
npm run dev                  # http://localhost:3000
```

### Commands

```bash
npm run dev          # development server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint

npm run test:safety  # pgTAP — clinical safety (finalise lock, interactions, allergies)
npm run test:billing # pgTAP — invoice arithmetic identities
npm run test:db      # pgTAP — RLS cross-tenant isolation and audit
npm run test:all     # all three, then the migration drift check

npm run seed:demo        # seed a demo hospital day
npm run seed:demo:reset  # reset and reseed
```

The database suites need `SUPABASE_DB_URL` (Supabase → Project Settings → Database →
Connection string → URI, session pooler). They run inside a transaction that is
rolled back, so they are safe against any environment.

---

## Environment

Client-visible (shipped to the browser — never put a secret behind a `NEXT_PUBLIC_` name):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SNOMED_INDIA_REFSET
NEXT_PUBLIC_ECG_DIGITIZER_URL
```

Server-only:

```
SUPABASE_SERVICE_ROLE_KEY   SUPABASE_DB_URL
GEMINI_API_KEY              GEMINI_OCR_MODEL   GEMINI_ECG_MODEL
ASSEMBLYAI_API_KEY          RESEND_API_KEY
TWILIO_SID                  TWILIO_AUTH_TOKEN  TWILIO_WHATSAPP_NUMBER
CRON_SECRET                 DATABASE_BACKUP_INTERNAL_SECRET
```

Supabase Edge Functions additionally read `ABDM_CM_ID`, `ABDM_HIP_ID`, `ABDM_HIU_ID`,
`ABDM_WEBHOOK_SECRET` and the `ABDM_*_PATH` endpoints.

---

## Project layout

```
app/              routes; app/api/** route handlers, app/actions/ server actions
components/       feature folders — ipd, billing, abdm, investigations, prescribing, ui …
lib/              ~100 modules — Supabase clients, SNOMED, FHIR builders, ABDM, RBAC
hooks/            React hooks
proxy.ts          session + role-based routing (Next 16's renamed middleware)
supabase/         migrations, Edge Functions, pgTAP tests, rollbacks
scripts/          migration drift check, demo seed, ICD-10 ingest and embeddings
services/         ecg-digitizer — standalone Python microservice, deployed separately
docs/             competitive analysis
```

### Modules

Reception and front desk · OPD encounters · IPD (admissions, beds, MAR, nursing,
progress notes, discharge) · Pharmacy (queue, dispense, inventory, drug master) ·
Billing and insurance (invoices, claims, pre-auth, TPAs, corporate panels) · Lab ·
Nursing · Admin (hospital profile, staff, departments, templates, pricing, wards,
analytics) · Patient-facing routes (`/rx/[id]`, `/register`, `/join`, `/data-rights`).

Which modules appear in the sidebar is driven by the `hospitals.enabled_modules`
feature-flag column, so it is configuration rather than hard-coded.

---

## Things to know before you change anything

- **`proxy.ts` is the middleware.** Next.js 16 renamed `middleware.ts` → `proxy.ts`
  and the export is `proxy()`. All session checks and role gating live there.
- **Never run `supabase db push`.** `supabase/migrations/` holds incremental changes
  only — the core baseline tables exist solely in the live database, and the folder
  has drifted from it historically. Apply migrations through Supabase, commit the
  file, then run `node scripts/check-migration-drift.mjs`.
- **RLS is the security boundary.** Every public table is isolated on `hospital_id`.
  A new table needs policies in the same migration.
- **The audit log is append-only.** UPDATE and DELETE on `audit_logs` fail at the
  database layer, by design.
- **Clinical safety is enforced in Postgres, not the UI** — finalised encounters are
  locked, severe interactions and matching allergies block the write. Run
  `npm run test:safety` after touching prescribing.
- **Aadhaar is hashed on-device and never written to Postgres.**

---

## Standards and compliance

FHIR Composition emitted on OPD encounter finalise (NRCES OP-consult profile) ·
SNOMED CT clinical terminology with India refsets · ICD-10 diagnosis coding ·
ABDM/ABHA national health-ID interoperability (HFR and HPR identifiers on hospital
and staff records) · DPDPA 2023 granular consent and data-principal rights ·
NABH 6th Edition clauses referenced in the compliance analytics.

---

## CI

| Workflow | What it does |
| --- | --- |
| `ci.yml` | Typecheck, lint and build on every push to `main` and every PR |
| `db-safety-tests.yml` | Clinical safety, billing arithmetic, RLS isolation and migration drift |

The database workflow is **only a gate once the repository secret `SUPABASE_DB_URL`
is set**. Without it every step is skipped and the job passes green having asserted
nothing; it emits a warning annotation in that state.

---

## Documentation

| File | Contents |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Working guide for AI coding agents — architecture, conventions, landmines |
| [`AGENTS.md`](AGENTS.md) | Next.js 16 breaking-change warning |
| [`SOW-STATUS.md`](SOW-STATUS.md) | Scope audit against the live build |
| [`PHASE1-PLAN.md`](PHASE1-PLAN.md) | Build plan by wave |
| [`RUNBOOK.md`](RUNBOOK.md) | Owner-only operational tasks |
| [`SECURITY-TODO.md`](SECURITY-TODO.md) | Security pass action items |
| [`YOUR-TODO.md`](YOUR-TODO.md) | Outstanding owner items |
| [`docs/competitive/`](docs/competitive/) | Competitive analysis |
