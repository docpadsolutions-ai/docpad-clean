-- ABDM consent auto-expiry — run in Supabase SQL Editor after:
-- 1) Vault: secret CRON_SECRET (same value as Edge secret).
-- 2) CLI: supabase secrets set CRON_SECRET=...
-- 3) Deploy: supabase functions deploy abdm-consent-expiry
--
-- Schedule: every day at 00:00 India Standard Time (IST = UTC+5:30).
-- That moment is 18:30 UTC on the *previous* calendar date, so use:
--   minute=30, hour=18 UTC → `30 18 * * *`
--
-- Replace YOUR_PROJECT_REF with your project ref (Dashboard → Settings → API).

-- Optional: unschedule previous name
-- select cron.unschedule(jobid) from cron.job where jobname = 'abdm-consent-expiry-ist-midnight';

select cron.schedule(
  'abdm-consent-expiry-ist-midnight',
  '30 18 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/abdm-consent-expiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
