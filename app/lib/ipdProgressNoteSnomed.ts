import type { ClinicalChip, ClinicalLaterality } from "./clinicalChipTypes";
import {
  clinicalChipFromLegacyDisplay,
  clinicalChipPrimaryLabel,
  type ClinicalSeverity,
} from "./clinicalChipTypes";

export type IpdDiagnosisEntry = {
  term: string;
  snomed: string;
  icd10: string | null;
};

/** JSONB on ipd_progress_notes — invisible SNOMED storage alongside SOAP text columns. */
export type IpdSnomedTermRow = {
  display: string;
  conceptId: string;
  icd10: string;
  severity?: string;
  laterality?: string;
  /** ROM planes (degrees) for examination findings — graphing / trending. */
  structured_values?: Record<string, number>;
};

export type IpdSnomedTermsPayload = {
  terms: IpdSnomedTermRow[];
};

function normalizeSeverity(v: string | null | undefined): ClinicalSeverity {
  const x = (v ?? "").trim().toLowerCase();
  if (x === "mild" || x === "moderate" || x === "severe") return x;
  return null;
}

function normalizeLaterality(v: string | null | undefined): ClinicalLaterality {
  const x = (v ?? "").trim().toLowerCase();
  if (x === "left" || x === "right" || x === "bilateral") return x;
  return null;
}

function sIcd10(v: unknown): string {
  if (v == null) return "";
  const t = String(v).trim();
  return t;
}

function parseStructuredValuesRecord(raw: unknown): Record<string, number> | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Map one persisted term row → ClinicalChip (complaints / examination). */
export function ipdSnomedTermToClinicalChip(row: IpdSnomedTermRow): ClinicalChip {
  const base = clinicalChipFromLegacyDisplay(row.display, row.conceptId);
  const sv = row.structured_values;
  const hasRom = sv != null && Object.keys(sv).length > 0;
  return {
    ...base,
    severity: normalizeSeverity(row.severity),
    laterality: normalizeLaterality(row.laterality),
    structuredValues: hasRom ? sv : null,
    chipDisplay: hasRom ? row.display.trim() : null,
  };
}

export function ipdSnomedTermToDiagnosisEntry(row: IpdSnomedTermRow): IpdDiagnosisEntry {
  const icd = sIcd10(row.icd10);
  return {
    term: row.display.trim(),
    snomed: row.conceptId.trim(),
    icd10: icd || null,
  };
}

function rowFromUnknown(x: unknown): IpdSnomedTermRow | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const display = String(r.display ?? "").trim();
  if (!display) return null;
  const conceptId = String(r.conceptId ?? "").trim();
  const icd10 = sIcd10(r.icd10);
  const severity = r.severity != null ? String(r.severity).trim() : undefined;
  const laterality = r.laterality != null ? String(r.laterality).trim() : undefined;
  const sv = parseStructuredValuesRecord(r.structured_values);
  const rv = parseStructuredValuesRecord(r.rom_values);
  let mergedSv: Record<string, number> | undefined;
  if (sv || rv) {
    mergedSv = { ...(rv ?? {}), ...(sv ?? {}) };
    if (Object.keys(mergedSv).length === 0) mergedSv = undefined;
  }
  const term: IpdSnomedTermRow = {
    display,
    conceptId,
    icd10,
  };
  if (severity) term.severity = severity;
  if (laterality) term.laterality = laterality;
  if (mergedSv) term.structured_values = mergedSv;
  return term;
}

/**
 * Parse JSONB `{ terms: [...] }` with backward compatibility for legacy shapes
 * (symptoms_json.symptoms, local_exam_json.snomed_terms / examination_terms).
 */
export function parseIpdSnomedTermsJson(raw: unknown): IpdSnomedTermRow[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      return parseIpdSnomedTermsJson(JSON.parse(t));
    } catch {
      return [];
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return [];
  const o = raw as Record<string, unknown>;

  const fromTerms = o.terms;
  if (Array.isArray(fromTerms)) {
    const out: IpdSnomedTermRow[] = [];
    for (const x of fromTerms) {
      const row = rowFromUnknown(x);
      if (row) out.push(row);
    }
    return out;
  }

  const legacySymptoms = o.symptoms;
  if (Array.isArray(legacySymptoms)) {
    const out: IpdSnomedTermRow[] = [];
    for (const x of legacySymptoms) {
      if (!x || typeof x !== "object") continue;
      const r = x as Record<string, unknown>;
      const display = String(r.display ?? "").trim();
      if (!display) continue;
      out.push({
        display,
        conceptId: String(r.conceptId ?? "").trim(),
        icd10: sIcd10(r.icd10),
        ...(r.severity != null ? { severity: String(r.severity) } : {}),
        ...(r.laterality != null ? { laterality: String(r.laterality) } : {}),
      });
    }
    return out;
  }

  const legacyDx = o.snomed_terms;
  if (Array.isArray(legacyDx)) {
    const out: IpdSnomedTermRow[] = [];
    for (const x of legacyDx) {
      if (!x || typeof x !== "object") continue;
      const r = x as Record<string, unknown>;
      const display = String(r.display ?? "").trim();
      if (!display) continue;
      out.push({
        display,
        conceptId: String(r.conceptId ?? "").trim(),
        icd10: sIcd10(r.icd10),
      });
    }
    return out;
  }

  const legacyEx = o.examination_terms ?? o.examination_snomed;
  if (Array.isArray(legacyEx)) {
    const out: IpdSnomedTermRow[] = [];
    for (const x of legacyEx) {
      if (!x || typeof x !== "object") continue;
      const r = x as Record<string, unknown>;
      const display = String(r.display ?? "").trim();
      if (!display) continue;
      const row: IpdSnomedTermRow = {
        display,
        conceptId: String(r.conceptId ?? "").trim(),
        icd10: sIcd10(r.icd10),
      };
      if (r.severity != null) row.severity = String(r.severity);
      if (r.laterality != null) row.laterality = String(r.laterality);
      out.push(row);
    }
    return out;
  }

  return [];
}

/** Legacy `local_exam_json` stored assessment under `snomed_terms` only. */
export function parseLegacyLocalExamAssessmentTerms(raw: unknown): IpdSnomedTermRow[] {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const st = (raw as Record<string, unknown>).snomed_terms;
  return parseIpdSnomedTermsJson({ snomed_terms: st });
}

/** Legacy `local_exam_json` stored examination under `examination_terms`. */
export function parseLegacyLocalExamFindingTerms(raw: unknown): IpdSnomedTermRow[] {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const o = raw as Record<string, unknown>;
  const et = o.examination_terms ?? o.examination_snomed;
  return parseIpdSnomedTermsJson({ examination_terms: et });
}

export function buildComplaintSnomedPayload(chips: ClinicalChip[]): IpdSnomedTermsPayload {
  return {
    terms: chips.map((c) => {
      const row: IpdSnomedTermRow = {
        display: clinicalChipPrimaryLabel(c),
        conceptId: c.snomedCode?.trim() ?? "",
        icd10: "",
      };
      if (c.severity) row.severity = c.severity;
      if (c.laterality) row.laterality = c.laterality;
      return row;
    }),
  };
}

export function buildAssessmentSnomedPayload(entries: IpdDiagnosisEntry[]): IpdSnomedTermsPayload {
  return {
    terms: entries.map((d) => ({
      display: d.term.trim(),
      conceptId: d.snomed.trim(),
      icd10: d.icd10?.trim() ?? "",
    })),
  };
}

export function buildFindingsSnomedPayload(chips: ClinicalChip[]): IpdSnomedTermsPayload {
  return {
    terms: chips.map((c) => {
      const row: IpdSnomedTermRow = {
        display: clinicalChipPrimaryLabel(c),
        conceptId: c.snomedCode?.trim() ?? "",
        icd10: "",
      };
      if (c.severity) row.severity = c.severity;
      if (c.laterality) row.laterality = c.laterality;
      if (c.structuredValues && Object.keys(c.structuredValues).length > 0) {
        row.structured_values = c.structuredValues;
      }
      return row;
    }),
  };
}

export function buildSubjectiveDisplayText(chips: ClinicalChip[], free: string): string {
  const line = chips.map(clinicalChipPrimaryLabel).filter(Boolean).join("; ");
  return [line, free.trim()].filter(Boolean).join("\n\n");
}

export function buildAssessmentDisplayText(diagnoses: IpdDiagnosisEntry[], free: string): string {
  const line = diagnoses.map((d) => d.term.trim()).filter(Boolean).join("; ");
  return [line, free.trim()].filter(Boolean).join("\n\n");
}

export function buildObjectiveDisplayText(chips: ClinicalChip[], free: string): string {
  const line = chips.map(clinicalChipPrimaryLabel).filter(Boolean).join("; ");
  return [line, free.trim()].filter(Boolean).join("\n\n");
}

/**
 * When only `{ terms }` is stored in JSONB, free narrative lives in the SOAP text column.
 * Recover the free portion after the chip line (saved with `build*DisplayText`).
 */
export function recoverFreeTextBelowChipLine(fullSoap: string, chipLine: string): string {
  const t = fullSoap.trim();
  const c = chipLine.trim();
  if (!c) return t;
  if (t === c) return "";
  if (t.startsWith(c + "\n\n")) return t.slice(c.length + 2).trim();
  if (t.startsWith(c + "\n")) return t.slice(c.length + 1).trim();
  return t;
}

/** Legacy symptoms_json / local_exam may have stored free_text beside terms. */
export function readLegacyFreeTextFromJson(raw: unknown): string | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const ft = (raw as Record<string, unknown>).free_text;
  return typeof ft === "string" ? ft : undefined;
}

export function readLegacyAssessmentObjectiveFreeFromLocalExam(raw: unknown): {
  assessment?: string;
  objective?: string;
} {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const a = o.assessment_free;
  const b = o.objective_free;
  return {
    assessment: typeof a === "string" ? a : undefined,
    objective: typeof b === "string" ? b : undefined,
  };
}
