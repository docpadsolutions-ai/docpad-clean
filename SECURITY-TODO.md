# Your action items — 17 Sep 2026 security pass

Everything else from the audit is already applied to the code and to the
Supabase project `Docpad` (hvjbzlwlqnntwxgufjkm). These are the items that
need you, because they need credentials or a dashboard I can't reach.

## 1. Rotate two exposed keys

| Key | Why | Where |
| --- | --- | --- |
| Gemini API key | It was in the browser bundle via `NEXT_PUBLIC_GEMINI_API_KEY`, so anyone who opened DocPad could read it | Google AI Studio → create new key, delete old |
| Supabase service-role key | It was hardcoded in `scripts/ingest-icd10.ts` on disk (never committed) | Supabase → Project Settings → API → rotate |

After rotating, update **both** `.env.local` and the Vercel project env vars.

## 2. Rename the Gemini env var (server-side only)

- Add `GEMINI_API_KEY` = the new key, in `.env.local` and in Vercel.
- Delete `NEXT_PUBLIC_GEMINI_API_KEY` from both once the app works. The code
  still falls back to it, so nothing breaks in between.
- The Supabase Edge Functions already use their own `GEMINI_API_KEY` secret —
  update that too (Supabase → Edge Functions → Secrets).

## 3. Turn on leaked-password protection

Supabase → Authentication → Policies → enable "Leaked password protection"
(checks new passwords against HaveIBeenPwned). One toggle; no API for it.

## 4. Push the commits

```bash
cd ~/docpad-clean
git log --oneline -5     # snapshot, security fixes, audit trail, tests/CI
git push origin main
```

The sandbox has no GitHub credentials, so this has to run on your Mac. The
first commit is the months of uncommitted work — push it even if you want to
review the second one first.

## 5. Add one GitHub secret (optional, 2 minutes)

`SUPABASE_DB_URL` (Supabase → Project Settings → Database → Connection string → URI,
session pooler) in the repo's Actions secrets. That switches on the nightly
`Database isolation tests` workflow, which asserts no hospital can see another's data.
Without the secret that workflow skips itself; the typecheck/lint/build workflow runs either way.

## 6. Smoke-test while signed in (30 minutes, worth doing before anything else)

I could not reach Supabase from the sandbox, so these paths are verified by
SQL and by unit-level checks only, not by clicking through the app:

- [ ] Log in as a doctor: OPD queue, open an encounter, save a prescription.
- [ ] Send the prescription on WhatsApp, then open the `/rx/<id>` link in a
      private window (this should now work for a signed-out patient — it did
      not before).
- [ ] Nursing portal: ward list, vitals, MAR, a nursing task.
- [ ] IPD: open an admission (daily note should be created), discharge summary
      draft, consents.
- [ ] Pharmacy: dispense; Reception: register a patient, collect a lab payment.
- [ ] Admin: staff directory, invite a staff member, open the invite link in a
      private window and complete signup.
- [ ] Upload a lab report (OCR), an ECG, and an insurance card.
- [ ] AI: patient summary, similar past prescriptions, ICD-10 suggestion.

If anything returns "Not permitted: record belongs to another hospital" for a
record that *is* yours, tell me the RPC name — that means a parameter of that
function needs a different scope rule, and it is a one-line fix.
`supabase/rollbacks/20260917_security_hardening_rollback.sql` can reverse any
individual piece if something blocks you at the hospital.

## 7. For tomorrow's session (nothing to do now, just context)

Two items from the review are still open, and both need something from you before
they can be built:

**Backups.** The code in `app/api/admin/backups/*` assumes `pg_dump`, which cannot run
on Vercel, and the tables it writes to (`backup_logs`, `backup_worker_settings`,
`hospital_backup_schedule`) plus the `hospital-backups` bucket exist only in a local
migration file that was never applied. Pick one:
- Supabase Pro scheduled backups (~$25/mo, restores the whole project, no code), or
- a per-hospital encrypted logical export (SQL → AES-GCM → Storage, on a schedule) that
  works on the current plan but covers data only, not schema.

**Migration drift.** `supabase/migrations` and the live database no longer agree, so
`supabase db push` is unsafe. The fix starts on your Mac, where there is network access
to the database:

```bash
cd ~/docpad-clean
supabase link --project-ref hvjbzlwlqnntwxgufjkm
supabase db pull        # writes a baseline migration from the live schema
```

Then I reconcile the old files against that baseline and we get a migrations folder that
can actually be replayed.

---

## 8. Appointment reminders — environment setup (added with the follow-up work)

The reminder job is built and deployed with the app, but it will not send anything until
these are set in **Vercel → Project → Settings → Environment Variables** (Production):

- `CRON_SECRET` — any long random string. Vercel Cron sends it as
  `Authorization: Bearer <value>`; without it the route answers 503 and nothing is sent.
  Generate one with `openssl rand -hex 32`.
- `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` — these are the same three
  the prescription-link feature already uses. If WhatsApp sending works today, they exist.

`vercel.json` schedules two runs (times are UTC): 12:30 UTC — 18:00 IST — for tomorrow's
bookings, and 02:30 UTC — 08:00 IST — for today's. Change the `schedule` fields if the
clinic wants different hours.

To check it end to end without messaging anyone, call it with `?dry=1`:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-domain>/api/reminders/appointments?kind=day_before&dry=1"
```

It answers with how many bookings it would have messaged. Every real send is recorded in
`appointment_reminders`, and the job skips anything already recorded, so a double-fired
cron cannot message a patient twice.
