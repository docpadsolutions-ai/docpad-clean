-- Wave 2.8 - make the billing arithmetic an identity the database holds, not a
-- convention the application observes.
--
-- SOW 5 lists "automated regression suite covering all clinical safety paths and
-- billing arithmetic" as an acceptance criterion. Nothing covered the billing half,
-- and nothing enforced it either: no trigger on invoices, invoice_line_items or
-- payments recomputes a total. Every figure on an invoice is written by application
-- code and believed.
--
-- The live data is consistent today - all 18 invoices agree with their lines, and
-- amount_paid and balance_due agree with the payments. What it does NOT show is that
-- the arithmetic is right, because every line in the database is a degenerate case:
-- quantity 1, factor 1, zero discount, zero tax. Nothing has ever been billed at
-- quantity 3, with a percentage discount, or with GST on it. "600 = 600" is not
-- evidence of a correct formula.
--
-- So two things here. The identities become triggers, which makes drift impossible
-- rather than unlikely. And the line-level formula is checked rather than imposed:
-- the application stays the author of its numbers, and the database refuses numbers
-- that do not add up. Silently rewriting them would hide the bug that produced them.

create or replace function public.billing_line_math(
  p_quantity         numeric,
  p_unit_price       numeric,
  p_factor           numeric default 1,
  p_discount_percent numeric default 0,
  p_discount_amount  numeric default 0,
  p_tax_percent      numeric default 0
)
returns table (subtotal numeric, discount numeric, net numeric, tax numeric, gross numeric)
language sql
immutable
as $function$
  with base as (
    select round(coalesce(p_quantity, 0) * coalesce(p_unit_price, 0) * coalesce(nullif(p_factor, 0), 1), 2) as subtotal
  ),
  disc as (
    -- An explicit amount wins over a percentage; a percentage is only used to derive
    -- the amount when none was given. Both present and disagreeing is the caller's
    -- problem and is reported by the trigger below.
    select b.subtotal,
           case when coalesce(p_discount_amount, 0) <> 0 then round(p_discount_amount, 2)
                else round(b.subtotal * coalesce(p_discount_percent, 0) / 100.0, 2) end as discount
      from base b
  ),
  n as (select subtotal, discount, round(subtotal - discount, 2) as net from disc)
  select n.subtotal, n.discount, n.net,
         round(n.net * coalesce(p_tax_percent, 0) / 100.0, 2) as tax,
         round(n.net + round(n.net * coalesce(p_tax_percent, 0) / 100.0, 2), 2) as gross
    from n;
$function$;

comment on function public.billing_line_math(numeric, numeric, numeric, numeric, numeric, numeric) is
  'The one definition of what a single invoice line comes to. Used to fill blanks and to check what the application supplied; never to silently overwrite it.';


create or replace function public.trg_invoice_line_math()
returns trigger
language plpgsql
as $function$
declare
  m record;
  tol constant numeric := 0.01;   -- one paisa, for float and rounding slack
begin
  select * into m from public.billing_line_math(
    NEW.quantity, NEW.unit_price, NEW.factor,
    NEW.discount_percent, NEW.discount_amount, NEW.tax_percent);

  -- Fill what the caller left blank.
  NEW.line_subtotal   := coalesce(NEW.line_subtotal, m.subtotal);
  NEW.discount_amount := coalesce(NEW.discount_amount, m.discount);
  NEW.net_amount      := coalesce(NEW.net_amount, m.net);
  NEW.tax_amount      := coalesce(NEW.tax_amount, m.tax);
  NEW.gross_amount    := coalesce(NEW.gross_amount, m.gross);

  -- Check what it did not. A line that does not add up is a bug upstream, and the
  -- useful thing is to say so rather than to quietly correct the symptom.
  if abs(NEW.net_amount - (NEW.line_subtotal - NEW.discount_amount)) > tol then
    raise exception
      'Invoice line does not add up: net % should be subtotal % minus discount %',
      NEW.net_amount, NEW.line_subtotal, NEW.discount_amount
      using errcode = '22023';
  end if;

  if abs(NEW.gross_amount - (NEW.net_amount + NEW.tax_amount)) > tol then
    raise exception
      'Invoice line does not add up: gross % should be net % plus tax %',
      NEW.gross_amount, NEW.net_amount, NEW.tax_amount
      using errcode = '22023';
  end if;

  if NEW.discount_amount > NEW.line_subtotal + tol then
    raise exception 'Discount % is larger than the line subtotal %',
      NEW.discount_amount, NEW.line_subtotal using errcode = '22023';
  end if;

  return NEW;
end;
$function$;

drop trigger if exists aa_invoice_line_math on public.invoice_line_items;
create trigger aa_invoice_line_math
  before insert or update on public.invoice_line_items
  for each row execute function public.trg_invoice_line_math();


-- The invoice is the sum of its lines. Recomputed rather than trusted, because a
-- total that disagrees with the lines under it is the single most embarrassing
-- defect a billing screen can have.
create or replace function public.recalc_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_net numeric := 0; v_tax numeric := 0; v_gross numeric := 0; v_disc numeric := 0;
  v_paid numeric := 0;
begin
  if p_invoice_id is null then return; end if;

  select coalesce(sum(net_amount), 0), coalesce(sum(tax_amount), 0),
         coalesce(sum(gross_amount), 0), coalesce(sum(discount_amount), 0)
    into v_net, v_tax, v_gross, v_disc
    from invoice_line_items where invoice_id = p_invoice_id;

  -- A voided payment is evidence that money was taken and given back. It stays on
  -- the record and stops counting towards what has been paid.
  select coalesce(sum(amount), 0) into v_paid
    from payments
   where invoice_id = p_invoice_id
     and voided_at is null
     and coalesce(status, '') not in ('void', 'voided', 'cancelled', 'failed');

  update invoices
     set total_net      = round(v_net, 2),
         total_tax      = round(v_tax, 2),
         total_gross    = round(v_gross, 2),
         total_discount = round(v_disc, 2),
         amount_paid    = round(v_paid, 2),
         -- Deliberately allowed to go negative: an overpayment is a credit the
         -- clinic owes back, and hiding it at zero is how it gets forgotten.
         balance_due    = round(v_gross - v_paid, 2)
   where id = p_invoice_id;
end;
$function$;

comment on function public.recalc_invoice_totals(uuid) is
  'Recomputes an invoice from its lines and payments. The invoice totals are derived values; nothing else should write them.';


create or replace function public.trg_recalc_invoice_from_child()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if TG_OP = 'DELETE' then
    perform public.recalc_invoice_totals(OLD.invoice_id);
    return OLD;
  end if;

  perform public.recalc_invoice_totals(NEW.invoice_id);
  -- A line or payment moved between invoices leaves the old one stale otherwise.
  if TG_OP = 'UPDATE' and OLD.invoice_id is distinct from NEW.invoice_id then
    perform public.recalc_invoice_totals(OLD.invoice_id);
  end if;
  return NEW;
end;
$function$;

drop trigger if exists zz_recalc_invoice_from_line on public.invoice_line_items;
create trigger zz_recalc_invoice_from_line
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.trg_recalc_invoice_from_child();

drop trigger if exists zz_recalc_invoice_from_payment on public.payments;
create trigger zz_recalc_invoice_from_payment
  after insert or update or delete on public.payments
  for each row execute function public.trg_recalc_invoice_from_child();

grant execute on function public.billing_line_math(numeric, numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;
revoke all on function public.recalc_invoice_totals(uuid) from public, anon;
grant execute on function public.recalc_invoice_totals(uuid) to authenticated, service_role;
