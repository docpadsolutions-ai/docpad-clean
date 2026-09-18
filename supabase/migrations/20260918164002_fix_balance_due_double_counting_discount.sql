-- invoices.balance_due was double-counting the discount.
--
-- Found by writing the first test that put a discount on an invoice. The generated
-- expression was:
--
--     balance_due = (total_gross - total_discount) - amount_paid
--
-- but total_gross is already net of the discount. A line computes net = subtotal
-- minus discount, gross = net plus tax, and the invoice total is the sum of those
-- line grosses. Subtracting total_discount a second time removes it twice.
--
-- The application has never agreed with that column. `app/billing/invoices/page.tsx`
-- and `app/billing/invoice/[id]/page.tsx` both compute what is outstanding as
-- `total_gross - amount_paid`, and the invoice detail screen renders total_discount
-- as a subtraction line ABOVE total_gross, which only makes sense if gross is the
-- final payable.
--
-- Why nobody noticed: every discount in the database is zero, so the two formulas
-- have always produced the same number. Every invoice line ever written is quantity
-- 1, factor 1, no discount, no tax.
--
-- Why it matters: balance_due is not an internal figure. It is read by the reception
-- billing screen, the invoice list, the outstanding-invoices table, the payment
-- modal, and `components/billing/InvoicePDF.tsx`, which prints it as the amount due
-- on the invoice handed to the patient. The first discounted invoice would have
-- under-billed by exactly the discount, on paper, at the counter.
--
-- This migration changes no existing value, because every current discount is zero.

alter table public.invoices
  alter column balance_due set expression as (total_gross - amount_paid);

comment on column public.invoices.balance_due is
  'Derived: total_gross minus amount_paid. total_gross is already net of discount, so the discount must not be subtracted again. May be negative, which means the clinic owes a refund.';


-- Corresponding fix in the recalculation added moments ago, which tried to write
-- balance_due directly and cannot: it is a generated column, and Postgres is right
-- to refuse.
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

  -- balance_due is generated from these and must not be assigned.
  update invoices
     set total_net      = round(v_net, 2),
         total_tax      = round(v_tax, 2),
         total_gross    = round(v_gross, 2),
         total_discount = round(v_disc, 2),
         amount_paid    = round(v_paid, 2)
   where id = p_invoice_id;
end;
$function$;
