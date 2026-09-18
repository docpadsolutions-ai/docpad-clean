-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260417165635.

-- Remove any existing job first
SELECT cron.unschedule('mar-overdue-notifications')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mar-overdue-notifications'
);

-- Schedule every 30 minutes, all day
SELECT cron.schedule(
  'mar-overdue-notifications',
  '*/30 * * * *',
  $$SELECT notify_overdue_mar_slots()$$
);
