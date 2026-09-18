-- Pharmacy queue: prescriptions -> opd_encounters (encounter_id) -> patients (e.patient_id); filter by encounter hospital.
create or replace view public.pharmacy_ordered_prescription_queue
with (security_invoker = true) as
select
  p.*,
  pt.full_name as patient_name,
  pt.docpad_id as patient_docpad_id,
  pt.id as queue_patient_id,
  e.hospital_id
from public.prescriptions p
inner join public.opd_encounters e on p.encounter_id = e.id
inner join public.patients pt on e.patient_id = pt.id
where p.status = 'ordered';

comment on view public.pharmacy_ordered_prescription_queue is
  'Ordered Rx: INNER JOIN encounter then patient; filter with .eq(hospital_id, pharmacist org).';

grant select on public.pharmacy_ordered_prescription_queue to authenticated;
