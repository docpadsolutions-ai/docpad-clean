-- The demonstrated failure mode in ICD-10 lookup is vocabulary, not ranking: the
-- classification says "age-related cataract" and the doctor says "senile cataract";
-- it says "haemorrhoids" spelled hemorrhoids and the patient says "piles"; it says
-- "intervertebral disc displacement" and an Indian orthopaedic note says "PIVD".
-- No amount of embedding tuning bridges that reliably, and the lexical half cannot
-- match words that are simply not there.
--
-- This is the vocabulary layer. Phrases found in the note add their ICD-side wording
-- to the query terms; nothing is replaced, so "senile cataract" searches for senile,
-- cataract, age and related together and the IDF weighting sorts it out.
--
-- The seed below is authored, not sourced from a standards body, and is weighted
-- towards orthopaedics and common Indian OPD usage. It is meant to be reviewed and
-- extended by a clinician. The authoritative version of this idea is the ICD-10-CM
-- Alphabetic Index (a free CDC file), which loads into this same table when we get
-- to it.

create table if not exists public.clinical_synonyms (
  id         uuid primary key default gen_random_uuid(),
  phrase     text not null,
  expansion  text not null,
  source     text not null default 'seed',
  note       text,
  created_at timestamptz not null default now()
);

create unique index if not exists clinical_synonyms_phrase_key
  on public.clinical_synonyms (lower(phrase));

comment on table public.clinical_synonyms is
  'Lay, abbreviated and regional wording mapped to the vocabulary ICD-10 actually uses. Consulted by _icd10_query_terms; expansions are added to the query, never substituted for it.';

alter table public.clinical_synonyms enable row level security;

drop policy if exists clinical_synonyms_read on public.clinical_synonyms;
create policy clinical_synonyms_read on public.clinical_synonyms
  for select to authenticated using (true);

revoke all on table public.clinical_synonyms from public, anon;
grant select on table public.clinical_synonyms to authenticated;
grant all on table public.clinical_synonyms to service_role;

insert into public.clinical_synonyms (phrase, expansion, note) values
  -- orthopaedics: what the clinic says vs what the classification says
  ('pivd',                'intervertebral disc displacement prolapse',  'prolapsed intervertebral disc, common Indian usage'),
  ('slip disc',           'intervertebral disc displacement',           null),
  ('slipped disc',        'intervertebral disc displacement',           null),
  ('disc prolapse',       'intervertebral disc displacement',           null),
  ('frozen shoulder',     'adhesive capsulitis shoulder',               null),
  ('tennis elbow',        'lateral epicondylitis',                      null),
  ('golfers elbow',       'medial epicondylitis',                       null),
  ('housemaids knee',     'prepatellar bursitis',                       null),
  ('knock knee',          'genu valgum',                                null),
  ('bow legs',            'genu varum',                                 null),
  ('flat foot',           'pes planus flat',                            null),
  ('flat feet',           'pes planus flat',                            null),
  ('club foot',           'talipes equinovarus congenital deformity',   null),
  ('wry neck',            'torticollis',                                null),
  ('gonarthrosis',        'osteoarthritis knee',                        'European and Indian usage'),
  ('coxarthrosis',        'osteoarthritis hip',                         'European and Indian usage'),
  ('arthrosis',           'osteoarthritis',                             null),
  ('wear and tear',       'osteoarthritis degenerative',                null),
  ('lumbago',             'low back pain',                              null),
  ('backache',            'back pain',                                  null),
  ('avn',                 'osteonecrosis avascular necrosis',           null),
  ('acl',                 'anterior cruciate ligament',                 null),
  ('pcl',                 'posterior cruciate ligament',                null),
  ('acl tear',            'anterior cruciate ligament sprain rupture',  null),
  ('meniscal tear',       'meniscus derangement tear',                  null),
  ('cts',                 'carpal tunnel syndrome',                     null),
  ('water on the knee',   'effusion knee joint',                        null),
  ('water in knee',       'effusion knee joint',                        null),

  -- ageing terminology the classification renamed
  ('senile',              'age related',                                'ICD-10-CM renamed senile cataract to age-related cataract'),
  ('senile cataract',     'age related cataract nuclear',               null),
  ('old age',             'age related senile',                         null),

  -- lay terms patients use
  ('piles',               'hemorrhoids',                                null),
  ('heart attack',        'myocardial infarction',                      null),
  ('stroke',              'cerebral infarction cerebrovascular',        null),
  ('fits',                'seizure convulsion epilepsy',                null),
  ('loose motions',       'diarrhea',                                   null),
  ('loose motion',        'diarrhea',                                   null),
  ('sugar',               'diabetes mellitus',                          'Indian OPD shorthand; review if it misfires'),
  ('high bp',             'hypertension elevated blood pressure',       null),
  ('low bp',              'hypotension',                                null),
  ('kidney stone',        'calculus kidney',                            null),
  ('renal stone',         'calculus kidney',                            null),
  ('gall stone',          'calculus gallbladder cholelithiasis',        null),
  ('gallstone',           'calculus gallbladder cholelithiasis',        null),
  ('breathlessness',      'dyspnea shortness of breath',                null),
  ('giddiness',           'dizziness vertigo',                          null),
  ('vomitings',           'vomiting',                                   null),
  ('body ache',           'myalgia pain',                               null),
  ('weakness',            'asthenia weakness malaise',                  null),

  -- abbreviations seen in Indian OPD notes
  ('tb',                  'tuberculosis',                               null),
  ('urti',                'upper respiratory infection acute',          null),
  ('lrti',                'lower respiratory infection',                null),
  ('copd',                'chronic obstructive pulmonary disease',      null),
  ('cva',                 'cerebral infarction cerebrovascular',        null),
  ('mi',                  'myocardial infarction',                      null),
  ('ihd',                 'ischemic heart disease',                     null),
  ('cad',                 'coronary artery disease atherosclerotic',    null),
  ('ckd',                 'chronic kidney disease',                     null),
  ('uti',                 'urinary tract infection',                    null),
  ('dm',                  'diabetes mellitus',                          null),
  ('t2dm',                'type 2 diabetes mellitus',                   null),
  ('t1dm',                'type 1 diabetes mellitus',                   null),
  ('htn',                 'hypertension',                               null),
  ('oa',                  'osteoarthritis',                             null),
  ('ra',                  'rheumatoid arthritis',                       null),
  ('dvt',                 'deep vein thrombosis phlebitis',             null),
  ('gerd',                'gastro esophageal reflux disease',           null),
  ('bph',                 'benign prostatic hyperplasia',               null),
  ('lbp',                 'low back pain',                              null),
  ('ptb',                 'pulmonary tuberculosis',                     null)
on conflict do nothing;
