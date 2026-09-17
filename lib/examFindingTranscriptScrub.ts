export type ExamFindingRow = {
  finding: string;
  location?: string | null;
  qualifier?: string | null;
  duration?: string | null;
  severity?: string | null;
};

/**
 * Anatomical / site-specific tokens that must not appear in examination `finding`
 * unless the same dictation transcript contains them (case-insensitive).
 * Prevents Gemini from "helpfully" inserting wrong SNOMED-style anatomy (e.g. nipple, conjunctival).
 */
const GROUNDED_LEXICON =
  /\b(conjunctival|conjunctiva|nipples?|mammary|breasts?|areolar|areolae|rectal|rectum|vaginal|vulv|vulvar|nasal|nostrils?|aural|otic|ocular|lacrimal|umbilical|corneal|cornea|tympanic|pupil|eyelids?|ophthalmic)\b/gi;

export function scrubExamFindingPhraseAgainstTranscript(finding: string, transcript: string): string {
  const tl = transcript.toLowerCase();
  let out = finding.replace(GROUNDED_LEXICON, (match) =>
    tl.includes(match.toLowerCase()) ? match : "",
  );
  out = out.replace(/\s{2,}/g, " ").trim();
  out = out.replace(/\s+([,.;:])/g, "$1");
  return out;
}

/** Ground each row's `finding` to words supported by the transcript (examination only). */
export function scrubExaminationFindingsAgainstTranscript(
  rows: ExamFindingRow[],
  transcript: string,
): ExamFindingRow[] {
  return rows.map((row) => {
    const next = scrubExamFindingPhraseAgainstTranscript(row.finding ?? "", transcript).trim();
    return { ...row, finding: next.length >= 2 ? next : row.finding };
  });
}
