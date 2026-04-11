import type { ClinicalFinding } from "../components/VoiceDictationButton";

export type ClinicalLaterality = "left" | "right" | "bilateral" | null;

export type ClinicalSeverity = "mild" | "moderate" | "severe" | null;

/** Chief complaint + examination voice chips — unified shape for UI + SNOMED. */
export type ClinicalChip = {
  id: string;
  finding: string;
  bodySite: string | null;
  laterality: ClinicalLaterality;
  duration: string | null;
  severity: ClinicalSeverity;
  negation: boolean;
  snomedCode: string | null;
  snomedTerm: string | null;
  snomedAlternatives: Array<{ sctid: string; term: string }>;
  isEdited: boolean;
  isConfirmed: boolean;
  rawText: string;
  /** Merged ROM / custom label — overrides composed lat+site+finding for chip text. */
  chipDisplay?: string | null;
  /** ROM degrees by plane (flexion, abduction, …) for persistence and trending. */
  structuredValues?: Record<string, number> | null;
  /** True when SNOMED match is weak or missing — yellow chip border. */
  snomedLowConfidence?: boolean;
};

export function newClinicalChipId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeLaterality(v: string | null | undefined): ClinicalLaterality {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "left" || s === "right" || s === "bilateral") return s;
  return null;
}

function normalizeSeverity(v: string | null | undefined): ClinicalSeverity {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "mild" || s === "moderate" || s === "severe") return s;
  return null;
}

function titleCaseLaterality(l: string | null | undefined): string {
  const s = (l ?? "").trim().toLowerCase();
  if (s === "left" || s === "right" || s === "bilateral") {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return "";
}

/**
 * Builds examination chip text from Gemini entity fields when `chip_display` is absent.
 * ROM: "{Laterality} {bodySite} ROM — {Flex 20° / Abd 30° / …}"
 * Measured: "{Laterality} {bodySite} {finding} — {value}°" (or other unit)
 */
export function buildExaminationChipDisplay(e: {
  chip_display?: string | null;
  laterality?: string | null;
  bodySite?: string | null;
  finding: string;
  structured_values?: Record<string, number> | null;
  value?: number | null;
  unit?: string | null;
}): string | null {
  if (e.chip_display?.trim()) return e.chip_display.trim();

  const lat = titleCaseLaterality(e.laterality);
  const site = (e.bodySite ?? "").trim();
  const find = (e.finding ?? "").trim();
  const sv = e.structured_values;

  if (sv && Object.keys(sv).length > 0) {
    const romStr = formatStructuredRomDegrees(sv);
    if (romStr) {
      const head = [lat, site, "ROM"].filter(Boolean).join(" ");
      return `${head} — ${romStr}`.replace(/\s+/g, " ").trim();
    }
  }

  if (e.value != null && Number.isFinite(Number(e.value)) && e.unit?.trim()) {
    const n = Number(e.value);
    const u = e.unit.trim().toLowerCase();
    const isDeg = u === "degrees" || u === "degree" || u === "°";
    const suffix = isDeg ? `${n}°` : `${n} ${e.unit.trim()}`;
    const head = [lat, site, find].filter(Boolean).join(" ");
    if (head) return `${head} — ${suffix}`;
    return suffix;
  }

  return null;
}

/** Formats structured ROM planes for chip text (matches common ortho abbreviations). */
export function formatStructuredRomDegrees(sv: Record<string, number>): string {
  const LABELS: Record<string, string> = {
    flexion: "Flex",
    extension: "Ext",
    abduction: "Abd",
    adduction: "Add",
    internal_rotation: "IR",
    external_rotation: "ER",
  };
  return Object.entries(sv)
    .map(([k, v]) => {
      const label = LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
      return `${label} ${v}°`;
    })
    .join(" / ");
}

function mergeRomIntoChipDisplay(base: string, sv: Record<string, number> | null | undefined): string {
  const b = base.trim();
  if (!sv || Object.keys(sv).length === 0) return b;
  const romStr = formatStructuredRomDegrees(sv);
  if (!romStr) return b;
  if (b.includes("°")) return b;
  return b ? `${b} — ${romStr}` : romStr;
}

/**
 * Visible chip / narrative text: always from Gemini (laterality + body site + finding).
 * SNOMED preferred terms are not shown here (invisible coding).
 * When `structuredValues` has ROM degrees, they are appended if not already present in the label.
 */
export function clinicalChipVoiceDisplayLabel(c: ClinicalChip): string {
  const sv = c.structuredValues;
  if (c.chipDisplay?.trim()) {
    return mergeRomIntoChipDisplay(c.chipDisplay.trim(), sv);
  }
  const latRaw = c.laterality?.trim().toLowerCase();
  const latPart =
    latRaw === "left" || latRaw === "right" || latRaw === "bilateral"
      ? latRaw.charAt(0).toUpperCase() + latRaw.slice(1)
      : "";
  const site = (c.bodySite ?? "").trim();
  const find = (c.finding ?? "").trim();
  const composed = [latPart, site, find].filter(Boolean).join(" ");
  return mergeRomIntoChipDisplay(composed, sv);
}

/** Alias — display text is always voice/entity fields, never `snomedTerm`. */
export function clinicalChipPrimaryLabel(c: ClinicalChip): string {
  return clinicalChipVoiceDisplayLabel(c);
}

export function clinicalChipFromVoiceFinding(f: ClinicalFinding, id = newClinicalChipId()): ClinicalChip {
  const top = f.snomed;
  const hasCode = Boolean(top?.conceptId?.trim());
  const lowConf = Boolean(hasCode && top?.lowConfidence);
  const alts = (f.snomedAlternatives ?? []).map((a) => ({
    sctid: String(a.conceptId ?? "").trim(),
    term: String(a.term ?? "").trim(),
  })).filter((a) => a.sctid && a.term);

  return {
    id,
    finding: f.finding.trim(),
    bodySite: f.bodySite?.trim() ? f.bodySite.trim() : null,
    laterality: normalizeLaterality(f.laterality),
    duration: f.duration?.trim() ? f.duration.trim() : null,
    severity: normalizeSeverity(f.severity),
    negation: Boolean(f.negation),
    snomedCode: top?.conceptId?.trim() || null,
    snomedTerm: top?.term?.trim() || null,
    snomedAlternatives: alts,
    isEdited: false,
    isConfirmed: Boolean(hasCode && !lowConf),
    rawText: f.rawText?.trim() ?? "",
    chipDisplay: f.chipDisplay?.trim() ? f.chipDisplay.trim() : null,
    structuredValues: f.structuredValues ?? f.romValues ?? null,
    snomedLowConfidence: lowConf || !hasCode,
  };
}

/** One line for encounter `quick_exam` / prescription from an examination chip. */
export function clinicalExamChipPersistLine(c: ClinicalChip): string {
  const base = clinicalChipVoiceDisplayLabel(c);
  return [base, c.negation ? "– Absent" : null].filter(Boolean).join(" ");
}

export function clinicalChipFromLegacyDisplay(term: string, snomed: string): ClinicalChip {
  const t = term.trim();
  return {
    id: newClinicalChipId(),
    finding: t,
    bodySite: null,
    laterality: null,
    duration: null,
    severity: null,
    negation: false,
    snomedCode: snomed.trim() || null,
    snomedTerm: t || null,
    snomedAlternatives: [],
    isEdited: false,
    isConfirmed: Boolean(snomed.trim()),
    rawText: "",
    chipDisplay: null,
    structuredValues: null,
    snomedLowConfidence: !snomed.trim(),
  };
}
