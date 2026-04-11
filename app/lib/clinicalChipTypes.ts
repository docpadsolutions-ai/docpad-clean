import type { ClinicalFinding } from "../components/VoiceDictationButton";
import { composeBodySiteLabel } from "./clinicalVoicePipeline";

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

/** Primary line for chip label (finding + site, SNOMED term when confident). */
export function clinicalChipPrimaryLabel(c: ClinicalChip): string {
  const code = c.snomedCode?.trim();
  const term = c.snomedTerm?.trim();
  if (code && term && !c.snomedLowConfidence) return term;

  const finding = c.finding.trim();
  const site = c.bodySite?.trim();
  if (!finding) return site ? site.charAt(0).toUpperCase() + site.slice(1) : "";
  if (!site) return finding.charAt(0).toUpperCase() + finding.slice(1);
  const siteLower = site.toLowerCase();
  if (finding.toLowerCase().includes(siteLower)) {
    return finding.charAt(0).toUpperCase() + finding.slice(1);
  }
  const siteNice = site.charAt(0).toUpperCase() + site.slice(1).toLowerCase();
  return `${siteNice} ${finding}`.trim();
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
    snomedLowConfidence: lowConf || !hasCode,
  };
}

/** Minimal chip when loading from FHIR / legacy text-only rows. */
/** One line for encounter `quick_exam` / prescription from an examination chip. */
export function clinicalExamChipPersistLine(c: ClinicalChip): string {
  const loc = composeBodySiteLabel(c.laterality, c.bodySite);
  const base = clinicalChipPrimaryLabel(c);
  return [loc && `[${loc}]`, base, c.negation ? "– Absent" : null].filter(Boolean).join(" ");
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
    snomedLowConfidence: !snomed.trim(),
  };
}
