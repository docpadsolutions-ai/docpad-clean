/**
 * Appended to the existing Gemini system instruction in {@link VoiceDictationButton}
 * for `complaint` / `examination` extraction — same JSON entity array schema as OPD.
 */

export const GEMINI_SCREEN_CONTEXT_PRE_ADMISSION = `You are processing a pre-admission clinical assessment for an inpatient admission. Extract: chief_complaint, body_site, duration, hpi_summary, examination_findings[], diagnosis[], plan_summary. Map all clinical content into the required JSON array schema (finding, bodySite, laterality, negation, duration, severity, rawText). Return structured JSON matching that schema only.`;

export const GEMINI_SCREEN_CONTEXT_IPD_DAILY_NOTE = `You are processing a daily inpatient progress note. Extract: subjective_summary, vitals[], examination_findings[], wound_status, rom_active, rom_passive, assessment, plan[]. Map all clinical content into the required JSON array schema (finding, bodySite, laterality, negation, duration, severity, rawText). Return structured JSON matching that schema only.`;
