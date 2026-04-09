-- Production / older local DBs used `billing_account_id`; align column name with app + `20260412140000` (account_id).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'billing_account_id'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'account_id'
  ) then
    alter table public.invoices rename column billing_account_id to account_id;
  end if;
end $$;
