-- Correction to the line-maths trigger added minutes ago.
--
-- It filled the derived columns with coalesce(NEW.x, computed), which never fired:
-- line_subtotal, net_amount, gross_amount, tax_amount and discount_amount all carry
-- a DEFAULT of 0, so a caller that supplies only quantity, unit_price, discount_percent
-- and tax_percent arrives at the trigger with zeros rather than nulls. The identities
-- then held trivially (0 = 0 - 0) and the whole line came out as zero.
--
-- Caught by the first test that put a discount and GST on a line, which is the point
-- of writing the test. For these columns zero and unset are the same statement, so
-- that is how the trigger now reads them.
--
-- What is filled and what is checked are deliberately different. The formula fills
-- blanks. The CHECK is only on the identities between the stored columns - net is
-- subtotal minus discount, gross is net plus tax - because a line may legitimately
-- carry a price that is not quantity times unit price (package rates, negotiated
-- amounts, the override_reason that already exists on charge_items). What may never
-- happen is an invoice that does not add up.

create or replace function public.trg_invoice_line_math()
returns trigger
language plpgsql
as $function$
declare
  m record;
  tol constant numeric := 0.01;   -- one paisa of rounding slack
begin
  select * into m from public.billing_line_math(
    NEW.quantity, NEW.unit_price, NEW.factor,
    NEW.discount_percent, NEW.discount_amount, NEW.tax_percent);

  -- Zero means "not stated" for every one of these: they all default to 0.
  if coalesce(NEW.line_subtotal, 0) = 0 then NEW.line_subtotal := m.subtotal; end if;

  if coalesce(NEW.discount_amount, 0) = 0 and coalesce(NEW.discount_percent, 0) <> 0 then
    NEW.discount_amount := m.discount;
  end if;
  NEW.discount_amount := coalesce(NEW.discount_amount, 0);

  if coalesce(NEW.net_amount, 0) = 0 then
    NEW.net_amount := round(NEW.line_subtotal - NEW.discount_amount, 2);
  end if;

  if coalesce(NEW.tax_amount, 0) = 0 and coalesce(NEW.tax_percent, 0) <> 0 then
    NEW.tax_amount := round(NEW.net_amount * NEW.tax_percent / 100.0, 2);
  end if;
  NEW.tax_amount := coalesce(NEW.tax_amount, 0);

  if coalesce(NEW.gross_amount, 0) = 0 then
    NEW.gross_amount := round(NEW.net_amount + NEW.tax_amount, 2);
  end if;

  -- The identities. A line that does not add up is a bug upstream, and saying so is
  -- more use than quietly correcting the symptom.
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

  if NEW.discount_amount < 0 or NEW.tax_amount < 0 then
    raise exception 'A discount or tax amount cannot be negative' using errcode = '22023';
  end if;

  return NEW;
end;
$function$;
