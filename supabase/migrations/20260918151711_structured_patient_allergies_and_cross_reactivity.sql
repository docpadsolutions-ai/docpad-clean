-- Wave 1.3 - give allergies a severity, a category and a cross-reactivity map.
--
-- Two problems, both of which made the Wave 1.2 hard stop cruder than it should be.
--
-- 1. patients.known_allergies is a bare text[]. There is no severity anywhere, so
--    SOW 3.2's "hard stops for severe allergy" could not be implemented as written:
--    every match was a hard stop, including "Peanuts" and "pineapple", which are in
--    the live data. Blocking on things that cannot interact is how prescribers learn
--    to click through warnings, which costs you the alerts that matter.
--
-- 2. Matching was by name, so "penicillin" on file did not catch amoxicillin.
--
-- The obvious fix for (2) was drugs.drug_class, and it is wrong. That column has 36
-- values across 1,362 drugs, of which "antibiotic" alone covers 198. A penicillin
-- allergy would have blocked azithromycin. An over-broad block is a worse clinical
-- artefact than no block, so cross-reactivity gets an explicit curated map instead,
-- with two strengths: same_group blocks, related advises.
--
-- Honest statement of coverage, in the same spirit as the 24 interaction pairs: the
-- seed below covers beta-lactams, NSAIDs, sulfonamide antibiotics, macrolides,
-- fluoroquinolones and opioids. That is the ground an orthopaedic practice actually
-- stands on, and it is not a complete cross-reactivity database. Anything outside it
-- falls back to name matching, exactly as before.
--
-- Clinical choices worth naming, because they are judgements and not facts:
--   * Cephalosporins are `related` to penicillins, not same_group. Modern data puts
--     cross-reactivity at roughly 1-2%, so a documented penicillin allergy should
--     raise a caution against cefuroxime, not a refusal. Carbapenems likewise.
--   * COX-2 selective agents are `related` to the other NSAIDs, since they are
--     usually tolerated in NSAID-exacerbated respiratory disease.
--   * Codeine/tramadol/morphine reactions are usually pseudo-allergic histamine
--     release rather than true allergy, so that group is `related` throughout.
--   * Non-antibiotic sulfonamides (furosemide, thiazides, celecoxib) are deliberately
--     NOT in the sulfonamide group; they do not reliably cross-react, and including
--     them is a common and harmful over-reach.

create table if not exists public.patient_allergies (
  id               uuid primary key default extensions.uuid_generate_v4(),
  hospital_id      uuid not null references public.hospitals(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  substance        text not null,
  substance_snomed text,
  category         text not null default 'unknown'
                   check (category in ('drug', 'food', 'environment', 'other', 'unknown')),
  severity         text not null default 'unknown'
                   check (severity in ('mild', 'moderate', 'severe', 'anaphylaxis', 'unknown')),
  reaction         text,
  noted_at         timestamptz not null default now(),
  noted_by         uuid,
  inactive_at      timestamptz,
  inactive_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists patient_allergies_patient_idx
  on public.patient_allergies (patient_id) where inactive_at is null;
create unique index if not exists patient_allergies_unique_substance
  on public.patient_allergies (patient_id, lower(btrim(substance))) where inactive_at is null;

comment on table public.patient_allergies is
  'Structured allergy record. Replaces the bare patients.known_allergies text[], which carried no severity and so could not support the severity-graded hard stop SOW 3.2 asks for.';
comment on column public.patient_allergies.severity is
  'unknown is not benign: an ungraded DRUG allergy is treated as a hard stop, an ungraded food or environmental one as an advisory.';

alter table public.patient_allergies enable row level security;

drop policy if exists patient_allergies_select on public.patient_allergies;
create policy patient_allergies_select on public.patient_allergies
  for select to authenticated
  using (hospital_id = auth_hospital_id());

drop policy if exists patient_allergies_write on public.patient_allergies;
create policy patient_allergies_write on public.patient_allergies
  for all to authenticated
  using (hospital_id = auth_hospital_id())
  with check (hospital_id = auth_hospital_id());

-- Cross-reactivity. `member` is an ingredient name as it appears in prescribing;
-- `relation` says whether sharing this group is a true match or only a caution.
create table if not exists public.allergen_groups (
  group_key text not null,
  member    text not null,
  relation  text not null default 'same_group' check (relation in ('same_group', 'related')),
  note      text,
  primary key (group_key, member)
);

comment on table public.allergen_groups is
  'Curated allergy cross-reactivity. Deliberately narrow: drugs.drug_class was rejected for this because "antibiotic" covers 198 drugs and would make a penicillin allergy block azithromycin.';

alter table public.allergen_groups enable row level security;
drop policy if exists allergen_groups_read on public.allergen_groups;
create policy allergen_groups_read on public.allergen_groups
  for select to authenticated using (true);

insert into public.allergen_groups (group_key, member, relation, note) values
  ('beta_lactam_penicillin', 'penicillin', 'same_group', null),
  ('beta_lactam_penicillin', 'benzylpenicillin', 'same_group', null),
  ('beta_lactam_penicillin', 'phenoxymethylpenicillin', 'same_group', null),
  ('beta_lactam_penicillin', 'amoxicillin', 'same_group', null),
  ('beta_lactam_penicillin', 'ampicillin', 'same_group', null),
  ('beta_lactam_penicillin', 'cloxacillin', 'same_group', null),
  ('beta_lactam_penicillin', 'flucloxacillin', 'same_group', null),
  ('beta_lactam_penicillin', 'dicloxacillin', 'same_group', null),
  ('beta_lactam_penicillin', 'piperacillin', 'same_group', null),
  ('beta_lactam_penicillin', 'clavulanate', 'same_group', 'only ever appears with amoxicillin'),
  ('beta_lactam_penicillin', 'sulbactam', 'same_group', 'only ever appears with ampicillin/cefoperazone'),
  ('beta_lactam_penicillin', 'tazobactam', 'same_group', 'only ever appears with piperacillin'),
  ('beta_lactam_penicillin', 'cefalexin', 'related', 'cephalosporin, cross-reactivity roughly 1-2%'),
  ('beta_lactam_penicillin', 'cephalexin', 'related', 'cephalosporin, cross-reactivity roughly 1-2%'),
  ('beta_lactam_penicillin', 'cefazolin', 'related', 'distinct side chain, lowest cross-reactivity of the group'),
  ('beta_lactam_penicillin', 'cefuroxime', 'related', 'cephalosporin'),
  ('beta_lactam_penicillin', 'cefixime', 'related', 'cephalosporin'),
  ('beta_lactam_penicillin', 'cefpodoxime', 'related', 'cephalosporin'),
  ('beta_lactam_penicillin', 'ceftriaxone', 'related', 'cephalosporin'),
  ('beta_lactam_penicillin', 'cefotaxime', 'related', 'cephalosporin'),
  ('beta_lactam_penicillin', 'ceftazidime', 'related', 'cephalosporin'),
  ('beta_lactam_penicillin', 'cefepime', 'related', 'cephalosporin'),
  ('beta_lactam_penicillin', 'meropenem', 'related', 'carbapenem, cross-reactivity under 1%'),
  ('beta_lactam_penicillin', 'imipenem', 'related', 'carbapenem'),
  ('beta_lactam_penicillin', 'ertapenem', 'related', 'carbapenem'),
  ('nsaid', 'aspirin', 'same_group', null),
  ('nsaid', 'acetylsalicylic acid', 'same_group', null),
  ('nsaid', 'ibuprofen', 'same_group', null),
  ('nsaid', 'diclofenac', 'same_group', null),
  ('nsaid', 'aceclofenac', 'same_group', null),
  ('nsaid', 'naproxen', 'same_group', null),
  ('nsaid', 'ketorolac', 'same_group', null),
  ('nsaid', 'ketoprofen', 'same_group', null),
  ('nsaid', 'indomethacin', 'same_group', null),
  ('nsaid', 'piroxicam', 'same_group', null),
  ('nsaid', 'mefenamic acid', 'same_group', null),
  ('nsaid', 'nimesulide', 'same_group', null),
  ('nsaid', 'flurbiprofen', 'same_group', null),
  ('nsaid', 'celecoxib', 'related', 'COX-2 selective, usually tolerated in NSAID hypersensitivity'),
  ('nsaid', 'etoricoxib', 'related', 'COX-2 selective, usually tolerated'),
  ('nsaid', 'paracetamol', 'related', 'weak COX inhibition, tolerated by most; listed so the caution is visible'),
  ('sulfonamide_antibiotic', 'sulfamethoxazole', 'same_group', null),
  ('sulfonamide_antibiotic', 'cotrimoxazole', 'same_group', 'sulfamethoxazole + trimethoprim'),
  ('sulfonamide_antibiotic', 'sulfadiazine', 'same_group', null),
  ('sulfonamide_antibiotic', 'sulfasalazine', 'same_group', null),
  ('sulfonamide_antibiotic', 'sulfonamide', 'same_group', null),
  ('sulfonamide_antibiotic', 'sulpha', 'same_group', 'common spelling on Indian records'),
  ('macrolide', 'erythromycin', 'same_group', null),
  ('macrolide', 'azithromycin', 'same_group', null),
  ('macrolide', 'clarithromycin', 'same_group', null),
  ('macrolide', 'roxithromycin', 'same_group', null),
  ('fluoroquinolone', 'ciprofloxacin', 'same_group', null),
  ('fluoroquinolone', 'levofloxacin', 'same_group', null),
  ('fluoroquinolone', 'ofloxacin', 'same_group', null),
  ('fluoroquinolone', 'moxifloxacin', 'same_group', null),
  ('fluoroquinolone', 'norfloxacin', 'same_group', null),
  ('opioid', 'codeine', 'related', 'reactions are usually histamine release, not IgE'),
  ('opioid', 'tramadol', 'related', null),
  ('opioid', 'morphine', 'related', null),
  ('opioid', 'pethidine', 'related', null)
on conflict (group_key, member) do nothing;

-- Backfill the text[] into the structured table. Category is inferred by asking
-- whether the substance looks like something we dispense; severity stays unknown,
-- which for a drug means it still blocks.
insert into public.patient_allergies (hospital_id, patient_id, substance, category, severity, noted_at)
select p.hospital_id, p.id, btrim(a),
       case
         when exists (select 1 from allergen_groups g
                       where lower(btrim(a)) like '%' || g.member || '%'
                          or g.member like '%' || lower(btrim(a)) || '%')
           then 'drug'
         when exists (select 1 from drugs d
                       where lower(coalesce(d.generic_name, '')) like '%' || lower(btrim(a)) || '%'
                          or lower(coalesce(d.brand_name, ''))  like '%' || lower(btrim(a)) || '%')
           then 'drug'
         else 'other'
       end,
       'unknown',
       coalesce(p.created_at, now())
  from patients p, unnest(coalesce(p.known_allergies, '{}')) a
 where btrim(a) <> ''
on conflict do nothing;

comment on column public.patients.known_allergies is
  'Legacy. Kept because a lot of read paths still use it. patient_allergies is the source of truth for prescribing safety; this column is a fallback for patients with no structured rows yet.';

-- Every allergy match for a set of medicines, with the reason and whether it blocks.
-- The client uses this too, so the advisory/hard-stop split is decided in one place
-- rather than once in SQL and once in TypeScript.
create or replace function public.patient_allergy_matches(
  p_patient_id uuid,
  p_medicines  jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);
  if p_medicines is null or jsonb_array_length(p_medicines) = 0 then
    return '[]'::jsonb;
  end if;

  with meds as (
    select lower(btrim(coalesce(nullif(m ->> 'medicine_name', ''), m ->> 'generic_name'))) as label,
           lower(btrim(coalesce(nullif(m ->> 'generic_name', ''), m ->> 'medicine_name'))) as generic
      from jsonb_array_elements(p_medicines) m
  ),
  -- Structured rows if the patient has them, otherwise the legacy column, so no
  -- patient silently loses their allergy check during the transition.
  allergies as (
    select a.substance, a.category, a.severity
      from patient_allergies a
     where a.patient_id = p_patient_id and a.inactive_at is null
    union all
    select btrim(k), 'unknown', 'unknown'
      from patients p, unnest(coalesce(p.known_allergies, '{}')) k
     where p.id = p_patient_id and btrim(k) <> ''
       and not exists (select 1 from patient_allergies a2
                        where a2.patient_id = p_patient_id and a2.inactive_at is null)
  ),
  hits as (
    -- direct: the name of the drug and the name of the allergen overlap
    select m.label as drug, a.substance, a.category, a.severity,
           'direct'::text as match, null::text as via, null::text as note
      from meds m join allergies a
        on m.label <> '' and (
             m.label   like '%' || lower(a.substance) || '%'
          or lower(a.substance) like '%' || m.label   || '%'
          or m.generic like '%' || lower(a.substance) || '%'
          or lower(a.substance) like '%' || m.generic || '%')
    union all
    -- cross-reactivity: both sides resolve into the same curated group
    select m.label, a.substance, a.category, a.severity,
           case when gd.relation = 'same_group' and ga.relation = 'same_group'
                then 'same_group' else 'related' end,
           gd.group_key, gd.note
      from meds m
      join allergen_groups gd on m.generic like '%' || gd.member || '%'
                              or m.label   like '%' || gd.member || '%'
      join allergen_groups ga on ga.group_key = gd.group_key
      join allergies a on lower(a.substance) like '%' || ga.member || '%'
                       or ga.member like '%' || lower(a.substance) || '%'
  ),
  ranked as (
    select distinct on (drug, substance)
           drug, substance, category, severity, match, via, note
      from hits
     order by drug, substance,
              case match when 'direct' then 1 when 'same_group' then 2 else 3 end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'drug', drug,
           'allergen', substance,
           'category', category,
           'severity', severity,
           'match', match,
           'via', via,
           'note', note,
           -- The rule, in one place. An ungraded DRUG allergy blocks; an ungraded
           -- food or environmental one advises. A `related` match never blocks,
           -- because a cephalosporin after penicillin is a decision, not a refusal.
           'blocking', (
             category = 'drug'
             and match in ('direct', 'same_group')
             and severity in ('severe', 'anaphylaxis', 'unknown')
           )
         )), '[]'::jsonb)
    into v
    from ranked;

  return v;
end;
$function$;

revoke all on function public.patient_allergy_matches(uuid, jsonb) from public, anon;
grant execute on function public.patient_allergy_matches(uuid, jsonb) to authenticated, service_role;

grant select on public.allergen_groups to authenticated, service_role;
grant select, insert, update on public.patient_allergies to authenticated;
grant all on public.patient_allergies to service_role;

-- Rewire the Wave 1.2 hard stop onto the graded matcher.
create or replace function public.prescription_safety_blocks(
  p_patient_id        uuid,
  p_medicines         jsonb,
  p_exclude_encounter uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_safety json;
  v_blocks jsonb := '[]'::jsonb;
begin
  perform public._assert_hospital_scope('patient', p_patient_id);

  if p_medicines is null or jsonb_array_length(p_medicines) = 0 then
    return v_blocks;
  end if;

  v_safety := public.check_prescription_safety(p_patient_id, p_medicines, p_exclude_encounter);

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'interaction',
           'severity', i ->> 'severity',
           'drug_a', i ->> 'drug_a',
           'drug_b', i ->> 'drug_b',
           'detail', coalesce(i ->> 'clinical_effect', i ->> 'description'),
           'management', i ->> 'management')), '[]'::jsonb)
    into v_blocks
    from jsonb_array_elements((v_safety::jsonb) -> 'interactions') i
   where lower(coalesce(i ->> 'severity', '')) in ('severe', 'contraindicated');

  v_blocks := v_blocks || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', 'allergy',
             'severity', m ->> 'severity',
             'allergen', m ->> 'allergen',
             'drug', m ->> 'drug',
             'match', m ->> 'match',
             'detail', case when m ->> 'match' = 'direct'
                         then 'The patient has a recorded allergy to this medicine.'
                         else format('Cross-reacts with a recorded allergy to %s.', m ->> 'allergen') end))
      from jsonb_array_elements(public.patient_allergy_matches(p_patient_id, p_medicines)) m
     where (m ->> 'blocking')::boolean
  ), '[]'::jsonb);

  return v_blocks;
end;
$function$;
