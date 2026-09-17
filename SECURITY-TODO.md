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

## 4. Push the two commits

```bash
cd ~/docpad-clean
git log --oneline -2     # 46c3d51 snapshot, a4ccdac security fixes
git push origin main
```

The sandbox has no GitHub credentials, so this has to run on your Mac. The
first commit is the months of uncommitted work — push it even if you want to
review the second one first.

## 5. Smoke-test while signed in (30 minutes, worth doing before anything else)

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
