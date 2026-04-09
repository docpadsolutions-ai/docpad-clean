import type { CatalogEntry } from "./medicineCatalog";
import { formatAbdmMedicationLabel, medicineCatalog } from "./medicineCatalog";
import { calculateTotalQuantity, clampPrescriptionQuantity } from "./medicationUtils";

/** One line on the Rx — stable `id` for React keys and edit/replace. */
export type PrescriptionLine = {
  id: string;
  catalog: CatalogEntry;
  dosage: string;
  frequency: string;
  duration: string;
  /** e.g. "After food", "Before food" */
  timing: string;
  instructions: string;
  /** Total dispensable units (tablets, etc.) from frequency × duration (or override for SOS/PRN). */
  total_quantity: number;
};

export function newPrescriptionLineId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `rx-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Merge timing + free text for `prescriptions.instructions` (single DB column). */
export function composeInstructionsForDb(timing: string, customInstructions: string): string {
  const t = timing.trim();
  const c = customInstructions.trim();
  if (t && c) return `${t}. ${c}`;
  return t || c || "";
}

/** Units per administration when dosage names tablets/capsules; else 1 for strength-only strings (e.g. 500mg). */
function unitsPerAdministration(dosage: string): number {
  const d = dosage.trim().toLowerCase();
  const tabMatch = d.match(/(\d+(?:\.\d+)?)\s*(?:tab|tablet|cap|capsule)/);
  if (tabMatch) return Math.max(1, Math.ceil(parseFloat(tabMatch[1])));
  const lead = d.match(/^(\d+(?:\.\d+)?)/);
  if (lead && !/\b(mg|mcg|g\b|ml|iu)\b/.test(d)) {
    return Math.max(1, Math.ceil(parseFloat(lead[1])));
  }
  return 1;
}

/**
 * Estimated total dispensable units (e.g. tablets) for hospital_inventory deduction.
 * Prefers `line.total_quantity` when set; otherwise falls back to dosage × legacy frequency/duration heuristics.
 */
export function estimatePrescribedQuantity(line: PrescriptionLine): number {
  const tq = line.total_quantity;
  if (typeof tq === "number" && Number.isFinite(tq) && tq > 0) {
    return Math.min(99999, Math.max(1, Math.ceil(tq)));
  }

  const perDose = unitsPerAdministration(line.dosage || "");
  const freq = (line.frequency ?? "").toLowerCase();
  let perDay = 1;
  if (/\btds\b|thrice|3\s*time|tid\b/i.test(freq)) perDay = 3;
  else if (/\bbd\b|b\.d|twice|2\s*time|bid\b/i.test(freq)) perDay = 2;
  else if (/\bod\b|once\s*daily|o\.d|qd\b/i.test(freq)) perDay = 1;
  else if (/\bsos\b|prn\b/i.test(freq)) perDay = 1;

  const dur = (line.duration ?? "").toLowerCase();
  let days = 1;
  const weekMatch = dur.match(/(\d+(?:\.\d+)?)\s*weeks?/);
  const dayMatch = dur.match(/(\d+(?:\.\d+)?)\s*days?/);
  if (weekMatch) days = Math.max(1, Math.ceil(parseFloat(weekMatch[1]) * 7));
  else if (dayMatch) days = Math.max(1, Math.ceil(parseFloat(dayMatch[1])));
  else if (/\b1\s*week\b/.test(dur)) days = 7;

  const total = Math.ceil(perDose * perDay * days);
  return Math.min(99999, Math.max(1, total));
}

export type VoiceRxPrefillRow = {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
};

export function matchCatalogForVoiceName(voiceName: string): CatalogEntry | null {
  const n = voiceName.trim().toLowerCase();
  if (!n) return null;
  const exact = medicineCatalog.find((m) => m.name.toLowerCase() === n);
  if (exact) return exact;
  return (
    medicineCatalog.find(
      (m) =>
        m.name.toLowerCase().includes(n) ||
        n.includes(m.name.toLowerCase()) ||
        m.active_ingredient.toLowerCase().includes(n) ||
        n.includes(m.active_ingredient.toLowerCase()),
    ) ?? null
  );
}

export function voiceRowToPrescriptionLine(row: VoiceRxPrefillRow, index: number): PrescriptionLine {
  const name = (row.name ?? "").trim();
  const match = matchCatalogForVoiceName(name);
  const catalog: CatalogEntry =
    match ?? {
      id: `voice-${index}-${Date.now()}`,
      name: name || "Medication",
      displayName: name || "Medication",
      brand_name: name || "Medication",
      generic_name: name || "Unknown",
      snomed: "",
      active_ingredient: name || "Unknown",
      active_ingredient_snomed: "",
      form_snomed: "385055001",
      form_name: "Tablet",
      defaultDose: "",
      defaultFreq: "",
      defaultDuration: "",
      stock: 0,
      pricePerUnit: 0,
      category: "general",
    };
  const dosage = (row.dosage ?? "").trim() || catalog.defaultDose;
  const frequency = (row.frequency ?? "").trim() || catalog.defaultFreq;
  const duration = (row.duration ?? "").trim() || catalog.defaultDuration;
  return {
    id: newPrescriptionLineId(),
    catalog,
    dosage,
    frequency,
    duration,
    timing: "",
    instructions: "",
    total_quantity: calculateTotalQuantity(frequency, duration),
  };
}

/**
 * Positive integer for `prescriptions.total_quantity` from line override or 1-0-1 × duration logic.
 * Null/empty frequency or duration uses `calculateTotalQuantity` defaults (minimum 1).
 */
export function resolveTotalQuantityForPrescriptionDb(line: PrescriptionLine): number {
  const frequency = String(line.frequency ?? "").trim();
  const duration = String(line.duration ?? "").trim();
  const raw = line.total_quantity;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return clampPrescriptionQuantity(Math.round(raw));
  }
  return calculateTotalQuantity(frequency, duration);
}

/** One structured row for Supabase `prescriptions` (enterprise: not a single concatenated Rx string). */
export function prescriptionLineToDbRow(
  line: PrescriptionLine,
  encounterId: string,
  patientId: string,
): Record<string, unknown> {
  const generic = (line.catalog.generic_name ?? line.catalog.active_ingredient).trim();
  const frequency = String(line.frequency ?? "").trim();
  const duration = String(line.duration ?? "").trim();
  return {
    encounter_id: encounterId,
    patient_id: patientId,
    medicine_name: formatAbdmMedicationLabel(line.catalog),
    active_ingredient_snomed: line.catalog.active_ingredient_snomed ?? "",
    active_ingredient_name: generic,
    dosage_form_snomed: line.catalog.form_snomed ?? "",
    dosage_form_name: line.catalog.form_name ?? "",
    dosage_text: String(line.dosage ?? "").trim(),
    frequency,
    duration,
    instructions: composeInstructionsForDb(line.timing, line.instructions),
    total_quantity: resolveTotalQuantityForPrescriptionDb({ ...line, frequency, duration }),
  };
}
