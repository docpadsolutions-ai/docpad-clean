-- DocPad billing arithmetic suite (pgTAP).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/billing_arithmetic.sql
--
-- SOW 5 names "automated regression suite covering all clinical safety paths and
-- billing arithmetic" as an acceptance criterion. This is the billing half.
--
-- It exists because the live data proves nothing. All 18 invoices agree with their
-- lines, and every line in the database is quantity 1, factor 1, zero discount, zero
-- tax. "600 = 600" is not evidence of a correct formula, and writing the first test
-- that put a discount and GST on a line found a real defect in under a minute:
-- invoices.balance_due was generated as (total_gross - total_discount) - amount_paid,
-- which subtracts the discount twice, and that column is what InvoicePDF prints as
-- the amount due on the paper handed to the patient.
--
-- Everything runs in one transaction that is rolled back, so it is safe against any
-- environment. It needs one hospital with one patient.
begin;

select plan(13);
create temp table tap(l text);

create temp table t_ctx as
select p.id as patient_id, p.hospital_id from patients p limit 1;

create temp table t_inv as
with ins as (
  insert into invoices (hospital_id, patient_id, status, invoice_date)
  select hospital_id, patient_id, 'draft', now() from t_ctx
  returning id
)
select id from ins;

-- Three sessions at 250, ten percent off, eighteen percent GST. None of those three
-- things has ever appeared on a real line in this database.
insert into invoice_line_items (invoice_id, item_description, quantity, unit_price,
                                factor, discount_percent, tax_percent)
select id, 'Physiotherapy session', 3, 250, 1, 10, 18 from t_inv;

insert into tap select is(
  (select line_subtotal from invoice_line_items where invoice_id = (select id from t_inv)),
  750.00::numeric, 'three at 250 makes a subtotal of 750');

insert into tap select is(
  (select discount_amount from invoice_line_items where invoice_id = (select id from t_inv)),
  75.00::numeric, 'a discount given as a percentage is turned into an amount');

insert into tap select is(
  (select net_amount from invoice_line_items where invoice_id = (select id from t_inv)),
  675.00::numeric, 'net is the subtotal less the discount');

insert into tap select is(
  (select tax_amount from invoice_line_items where invoice_id = (select id from t_inv)),
  121.50::numeric, 'GST is charged on the discounted amount, not the list price');

insert into tap select is(
  (select gross_amount from invoice_line_items where invoice_id = (select id from t_inv)),
  796.50::numeric, 'gross is net plus tax');

insert into tap select is(
  (select total_gross from invoices where id = (select id from t_inv)),
  796.50::numeric, 'the invoice total follows its lines without anyone asking it to');

-- The regression that started all this. Under the old generated expression this
-- would have read 721.50, and 721.50 is what the patient would have been asked for.
insert into tap select is(
  (select balance_due from invoices where id = (select id from t_inv)),
  796.50::numeric, 'balance due does not subtract the discount a second time');

insert into tap select lives_ok(
  format($q$insert into payments (hospital_id, invoice_id, patient_id, amount, payment_method, status)
           select hospital_id, %L, patient_id, 300, 'cash', 'confirmed' from t_ctx$q$,
         (select id from t_inv)),
  'a part payment can be recorded');

insert into tap select is(
  (select balance_due from invoices where id = (select id from t_inv)),
  496.50::numeric, 'a part payment comes off the balance');

update payments set voided_at = now(), status = 'voided'
 where invoice_id = (select id from t_inv);

insert into tap select is(
  (select balance_due from invoices where id = (select id from t_inv)),
  796.50::numeric, 'voiding a payment puts the balance back and keeps the row');

insert into tap select throws_ok(
  format($q$insert into invoice_line_items (invoice_id, item_description, quantity,
                                            unit_price, net_amount, gross_amount)
           values (%L, 'Does not add up', 1, 100, 100, 999)$q$, (select id from t_inv)),
  '22023', null, 'a line whose gross is not net plus tax is refused');

insert into tap select throws_ok(
  format($q$insert into invoice_line_items (invoice_id, item_description, quantity,
                                            unit_price, discount_amount)
           values (%L, 'Discount exceeds the line', 1, 100, 500)$q$, (select id from t_inv)),
  '22023', null, 'a discount larger than the line itself is refused');

-- And the whole existing dataset, which is the thing a regression suite is really
-- for: not that today is right, but that tomorrow has not quietly drifted.
insert into tap select is(
  (select count(*)::int from (
     select i.id
       from invoices i
       left join (select invoice_id, sum(gross_amount) g
                    from invoice_line_items group by invoice_id) l on l.invoice_id = i.id
       left join (select invoice_id, sum(amount) p from payments
                   where voided_at is null
                     and coalesce(status, '') not in ('void', 'voided', 'cancelled', 'failed')
                   group by invoice_id) pm on pm.invoice_id = i.id
      where round(coalesce(i.total_gross, 0), 2) <> round(coalesce(l.g, 0), 2)
         or round(coalesce(i.amount_paid, 0), 2) <> round(coalesce(pm.p, 0), 2)
   ) drift),
  0, 'no invoice in the database disagrees with its own lines or payments');

-- ----------------------------------------------------------------- report
select l from tap where l like 'not ok%';
select coalesce((select string_agg(l, E'\n') from tap where l like 'not ok%'),
                'ALL PASS: ' || (select count(*) from tap) || ' billing tests') as result;
select * from finish();

rollback;
