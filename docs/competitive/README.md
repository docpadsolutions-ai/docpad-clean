# Competitive analysis

Research outputs kept in the repo so the reasoning behind scoping decisions stays next to the code.

| File | What it is | Date |
| --- | --- | --- |
| `docpad-vs-eka-care-2026-10.html` | DocPad vs Eka Care — product-owner comparison with verdicts by segment, a feature matrix, click-counted friction comparison, and a two-track build order. Open it in a browser. | 16 Oct 2026 |

## docpad-vs-eka-care-2026-10.html

**Evidence base.** Both products were mapped screen by screen on 15–16 October 2026: Eka Care (`dr.eka.care`, 21 routes / 29 components / 51 endpoints, walked end to end with a test patient on a base-plan account) and DocPad (the Vercel instance, 42 routes / 61 endpoints). The DocPad side was additionally verified against this repository at commit `3f0d836`. Company and market figures come from outside sources, attributed on the page.

**Headline conclusions.**

- Split verdict: Eka wins for a solo doctor or small OPD clinic; DocPad wins for a 50–200 bed hospital.
- **Our clinical-safety advantage is architectural, not yet clinical.** The prescribing hard stop rarely fires in practice: the only screen that records an allergy writes to `patients.known_allergies`, which `patient_allergy_matches` classifies as `unknown`, and an unclassified substance never sets the blocking flag. `supabase/tests/clinical_safety.sql` (lines 115–121) documents this. Combined with roughly 24 rows of interaction content, the safety claim should not be used in a sales conversation until the entry path feeds the checker.
- Roughly 8 interactions take an Eka visit from queue to a sent prescription, against roughly 20 on DocPad.
- A recurring pattern worth auditing: capability that is built but not connected — the admin OPD template builder is never read by the encounter, `slot_duration_minutes` is stored and never enforced, `reminders_communication` consent is defined and never checked, the appointment-reminder cron needs `CRON_SECRET`.

Caveats, including what could not be evaluated on either side, are in the page footer.
