-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061115.

create or replace function public.trg_charge_items_fill_display_and_category()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.charge_code_display is null or length(trim(new.charge_code_display)) = 0 then
    new.charge_code_display := coalesce(
      nullif(trim(new.display_label), ''),
      nullif(trim(new.charge_code), ''),
      'Service'
    );
  end if;
  if new.category is null or length(trim(new.category)) = 0 then
    new.category := 'other';
  end if;
  if new.account_id is null and new.patient_id is not null then
    select ba.id into new.account_id
    from public.billing_accounts ba
    where ba.patient_id = new.patient_id
    order by ba.created_at desc nulls last
    limit 1;
  end if;
  return new;
end;
$fn$;
