-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260408061004.

-- Before NOT NULL checks: derive charge_code_display from display_label / charge_code; default category.
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
  return new;
end;
$fn$;

drop trigger if exists trg_charge_items_fill_display_and_category on public.charge_items;
create trigger trg_charge_items_fill_display_and_category
before insert on public.charge_items
for each row execute function public.trg_charge_items_fill_display_and_category();

comment on function public.trg_charge_items_fill_display_and_category() is
  'Invoice UI sends display_label only; ensures charge_code_display and category satisfy NOT NULL.';
