-- Run in Supabase SQL Editor after:
-- 1) Project Settings → Vault: create secret named CRON_SECRET (same value everywhere).
-- 2) Edge Functions → Secrets (or CLI): supabase secrets set CRON_SECRET=<same value>
-- 3) Deploy: send-expiry-alerts (verify_jwt = false; POST requires header x-cron-secret).
--
-- Replace YOUR_PROJECT_REF with your Supabase project ref (Dashboard → Settings → API).

-- Optional: remove previous job name if re-scheduling
-- select cron.unschedule(jobid) from cron.job where jobname = 'daily-expiry-alerts';

select cron.schedule(
  'daily-expiry-alerts',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-expiry-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
