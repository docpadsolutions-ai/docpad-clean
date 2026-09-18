-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260412210000.

-- Align `invoices` with app: base list amount is `total_net` (was `subtotal` in older migration).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'subtotal'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'total_net'
  ) then
    alter table public.invoices rename column subtotal to total_net;
  end if;
end $$;
