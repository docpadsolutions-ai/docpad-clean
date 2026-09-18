# DocPad Phase 1 — build plan

Derived from `SOW-STATUS.md`, which audited every clause of the v1.5 SOW against the
live build. This is the order the remaining work gets done in, and why that order.

Assumption agreed 18 Sep 2026: **we build all of it.** Anything that genuinely cannot
be built here, because it needs credentials or infrastructure we do not hold, is
isolated at the bottom under "Residue" and goes to Megsys rather than sitting in the
plan pretending to be schedulable.

The sequencing principle is not the SOW's section order and not difficulty. It is:
**correct what is false before adding what is missing, then build the gate that stops
it becoming false again, then everything else in dependency order.**

---

## Wave 1 — Enforcement  ✅ complete 18 Sep 2026

The product currently passes a demonstration on two clinical-safety clauses it does not
actually satisfy. That is the worst category of defect in this codebase, because the
normal way of discovering a gap, showing it to someone, confirms it as working.

1. **Lock finalised encounters at the database.** `opd_encounters` has no status
   predicate on its update policy and none of its six triggers blocks a write to a
   completed row. The UI locks convincingly with `inert`, a badge and disabled fields,
   and none of that survives a direct PATCH. Mirror the pattern already used for IPD
   discharge summaries. Clinical columns become immutable once status is completed or
   final; a small allowlist of administrative columns stays writable, since cancelling
   a follow-up legitimately clears `follow_up_date` on a finalised encounter.
2. **Enforce the prescribing hard stop server-side.** Today it is a `disabled` attribute
   on three buttons. It is absent from `handleFinalizePrescription`, from
   `handleWhatsAppSend`, from the `finalize_prescription` RPC and from the
   `prescriptions` insert. The check must run where the write happens.
3. **Grade allergy severity.** Every substring match against a free-text allergy field
   is currently a hard stop. §3.2 says severity-graded, and a product that blocks on
   everything trains people to override.
4. **Confirm identity at the write, not at the door.** The confirmation popover gates
   opening the prescription writer. Reopening and saving needs no confirmation, the
   pharmacy dispense screen has none, and encounter finalisation has none at all.

## Wave 2 — The gate, and something to test against  (5 and 6 done; 7 needs the Client)

Wave 1 is worthless if it can regress silently, and it cannot be demonstrated to anyone
without data.

5. **Clinical-safety test suite, blocking in CI.** The four rules above become its first
   assertions: a contraindicated pair blocks the write, a severe allergy blocks the
   write, a finalised encounter rejects a clinical update, a prescription cannot be
   finalised past a hard stop. §2.1 of Proposal v1.0 names this as a blocking gate and
   §5 names it as an acceptance criterion; neither is satisfied by the current CI, which
   runs typecheck, lint and build.
6. **Seed-data framework producing a realistic OPD day.** Nothing else in the plan can
   be demonstrated, staged or acceptance-tested without it. It is also the answer to
   §11.2's question about whether it doubles as an audit dataset.
7. **Staging environment.** §5 requires all acceptance testing to be performed on
   staging. One environment means the acceptance mechanism itself cannot run. Depends on
   6, because an empty staging project is not a staging environment.
8. **Billing arithmetic regression coverage.** Named in §5 alongside clinical safety and
   currently untested.
9. **Migration discipline completion.** Drift detection landed 18 September. The
   `information_schema` verification before DDL, and schema-reload notification, did not.

## Wave 3 — Identity and record integrity

Everything here is a patient-safety clause in §2.3 of Proposal v1.0 that is presently
either absent or present on one screen out of nine.

10. **Shared patient banner across all clinical screens.** `PatientEncounterBanner` is a
    good component used on exactly one page. Lab, nursing, triage, both OPD
    investigation views, the encounters list and IPD investigations show no patient
    identity at all. This is the wrong-patient clause, and the audit baseline for
    wrong-patient prevention was 27% against a target of ≥85%.
11. **CR number.** It does not exist anywhere in the schema. Needs a column, a
    generation rule, and a decision on what happens to the 37 existing patients.
12. **Patient photo at registration.** The `patient_photos` table and the bucket exist
    and are read from. Nothing writes. Blocks 10 from being complete, since the banner
    specifies a photo.
13. **Duplicate detection on a mobile hash.** The `mobile_hash` column is dead. Detection
    runs on an Aadhaar hash instead, which is defensible but fails for any patient
    without Aadhaar, and is not the clause.
14. **Merge-review path.** Registration currently hard-stops on a duplicate with no
    same-person / different-person / merge branch.
15. **Encounter autosave to the database, with a visible saved state.** There is a
    continuous draft to `sessionStorage` and no server-side autosave at all, so a draft
    lives in one browser tab and nowhere else. The clause asks for both the autosave and
    the visible state.

## Wave 4 — Clinical documentation conformance

Smaller, and each one is a specific divergence from a named clause rather than a missing
feature.

16. SOAP labelling on the encounter card. The zones are correct and in the right order;
    nothing is labelled subjective, objective, assessment or plan.
17. Specialty context read from `primary_specialty` rather than `specialty` with a
    hardcoded "General Medicine" fallback.
18. Tier-1 bypass in the SNOMED lookup. The chief-complaint and diagnosis pickers pass an
    ECL and a cache filter, which sets `skipRpc` and skips doctor-frequency entirely, so
    the tier that learns from the clinician is reached only by the voice path.
19. **Snowstorm versus Ontoserver — a decision, not a task.** The SOW names Snowstorm.
    The build uses CSIRO Ontoserver, which works. Either switch, or get the substitution
    recorded in writing. Doing neither leaves an open conformance gap at acceptance.
20. Vitals co-located with the chief complaint rather than in the right sticky aside.

## Wave 5 — Output and prescribing conformance

21. **Plan text and ICD-10 into the patient-facing output.** `get_public_prescription`
    returns no `plan_details`, no `quick_exam`, no diagnosis, no ICD-10 and no follow-up
    date, and the WhatsApp body has no plan slot. So "CBC and X-ray advised, review in 3
    days" reaches the printout and never reaches the patient. §3.3 retains this
    explicitly and at no additional scope.
22. **NMC print fixes.** Qualification is absent from the letterhead path. Only the first
    diagnosis's ICD-10 is passed. Manual free-text entries carry `active_ingredient:
    "Unknown"` and print brand-only.
23. **Two genuinely separate dispensing routes.** Both buttons call the same handler,
    which always routes to pharmacy and always prints. Also the Save Draft button, which
    has no `onClick` handler at all.
24. **ABHA failure paths:** OTP timeout with countdown and resend, a patient-declines
    branch, and mobile-OTP as an enrolment option rather than linking only.
25. **Inline prescription writer.** Deliberately late. It is the largest refactor left,
    it touches the exact surface Waves 1 and 5 are correcting, and doing it first means
    doing it twice.

## Wave 6 — Surface, and the things acceptance is measured by

26. **Tablet usability at 10 to 11 inches.** No breakpoint work exists. One `lg:`
    breakpoint on both primary clinical screens, a `min-w-[420px]` dosage popover, and no
    media-query handling anywhere outside print. A clinic tablet below 1024px logical
    width collapses into the mobile stack.
27. **Realtime queue status surfaced to the patient by notification.** Parked by
    agreement on 18 September as low current utility. Sequenced here rather than dropped.
28. **OWASP Top-10 review with a findings register**, closed out per landmark. Named in
    §5; not started.
29. **Re-run the clinical-UX audit** and score the six in-scope categories against the
    ≥75 composite. There is no current score for any category, so there is presently no
    way to know whether the acceptance target is met.
30. **Acceptance test scripts.** §11.6 records that kick-off is not released until the
    landmark-level SOW including the scripts against which Section 5 is measured is
    issued and agreed. Whoever ends up delivering, this document has to exist, and
    scripted scenarios must include edge cases rather than the happy path alone.

## Carried, not SOW

31. ESLint. **Partly done 18 Sep 2026.** The 34 genuine bugs are fixed: impure
    `Date.now()` during render, refs written during render, assignment to
    `window.location.href` from inside a component, and assorted trivia. Two shared
    hooks came out of it, `useNow` and `useLatestRef`, and the first of those also
    fixes a real defect nobody had noticed - relative labels like "3m ago" only
    changed when something else happened to re-render, so they could sit wrong
    indefinitely. 122 remain, all `set-state-in-effect`, `static-components` and one
    `preserve-manual-memoization`, downgraded to warnings with the reasoning written
    into `eslint.config.mjs`. They get fixed area by area as each area is touched.
    Note that the count rose from 103 to 114 when the ref errors were fixed: the
    React compiler stops analysing a component at its first error, so eleven had
    been invisible behind the ones in front of them. Expect it to rise again.
32. 14,397 remaining ICD-10 embeddings, blocked on the Gemini free-tier daily cap. A
    billing decision, and the same cap applies to the live app at about one embed request
    per prescription save.

## Residue — cannot be built here

Both are real scope. Neither is blocked on effort.

- **ABDM, §2.4.** Two landmarks and 30% of contract value. Needs gateway credentials, a
  sandbox registration, HFR listing for the facility and HPR registration for
  practitioners. `ABDM_GATEWAY_URL` is unset, `abha-enrol` is a hardcoded mock, and
  nothing records registration or M1/M2/M3 state. The code skeleton is largely there;
  the engagement with NHA is not.
- **In-situ STT model, §2.6.** Needs a hosting decision and a monthly infrastructure
  budget. §11.4 asks for model, hosting, latency and recurring cost before signature and
  none has been answered. Under §7 that cost is the Client's for the life of the
  platform, so it is a commercial decision before it is a technical one.
- **The `checklist_type` defect.** Cannot be assessed without Megsys stating what the
  defect was, which §11.2 asks them to do.

---

## Order of execution

Waves 1 and 2 run first and in order, because 2 is what makes 1 permanent. Wave 3 is the
largest block of genuine patient-safety work. Waves 4 and 5 are conformance and can be
interleaved. Wave 6 is last because 29 and 30 measure everything before them, and
measuring early measures nothing.

Two decisions are needed from the Client and neither blocks starting: Snowstorm versus
Ontoserver (item 19), and whether `drug_interactions` grows beyond 24 pairs in-house or
becomes a Phase 2 line item. The second is not Vendor scope under this SOW, and it is
still the item with the highest clinical consequence in the product.
