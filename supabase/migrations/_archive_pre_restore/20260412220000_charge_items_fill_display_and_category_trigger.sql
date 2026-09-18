-- Remote/production `charge_items` requires NOT NULL `charge_code_display` and `category`.
-- App inserts `display_label` from the catalog; this trigger fills the rest before constraints run.

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

drop trigger if exists trg_charge_items_fill_display_and_category on public.charge_items;
create trigger trg_charge_items_fill_display_and_category
before insert on public.charge_items
for each row execute function public.trg_charge_items_fill_display_and_category();

comment on function public.trg_charge_items_fill_display_and_category() is
  'Invoice UI sends display_label only; fills charge_code_display, category, and billing_accounts account_id when null.';
