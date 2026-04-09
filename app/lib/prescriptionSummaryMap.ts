import type { FhirMedicationRequest } from "./fhirMedicationRequest";

/**
 * `prescriptions` / `opd_prescriptions` line — core columns used across DocPad.
 * Optional columns may be absent on older DBs; `pickDrugNameFromPrescriptionRow` still reads them when present.
 */
export type PrescriptionSummaryRow = {
  id: string;
  encounter_id: string;
  medicine_name?: string | null;
  drug_name?: string | null;
  medication_name?: string | null;
  medication?: unknown;
  dosage_text?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  clinical_indication?: string | null;
  created_at?: string | null;
};

/** Expand common dose-frequency abbreviations to full words (NABH-style clarity). */
export function expandFrequencyAbbreviations(input: string): string {
  const s = input.trim();
  if (!s) return "";
  let t = s;
  const rules: [RegExp, string][] = [
    [/\bTDS\b/gi, "Three times daily"],
    [/\bTID\b/gi, "Three times daily"],
    [/\bBDS\b/gi, "Twice daily"],
    [/\bBD\b/gi, "Twice daily"],
    [/\bBID\b/gi, "Twice daily"],
    [/\bOD\b/gi, "Once daily"],
    [/\bQID\b/gi, "Four times daily"],
    [/\bQDS\b/gi, "Four times daily"],
    [/\bHS\b/gi, "At bedtime"],
    [/\bSOS\b/gi, "As needed"],
    [/\bPRN\b/gi, "As needed"],
    [/\bSTAT\b/gi, "Immediately"],
  ];
  for (const [re, repl] of rules) {
    t = t.replace(re, repl);
  }
  return t.replace(/\s+/g, " ").trim();
}

export function pickDrugNameFromPrescriptionRow(row: Record<string, unknown>): string {
  const candidates = [row.medicine_name, row.drug_name, row.medication_name, row.name, row.display_name, row.text];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const med = row.medication;
  if (med && typeof med === "object" && !Array.isArray(med)) {
    const m = med as Record<string, unknown>;
    const nested = [m.display, m.name, m.text, m.medicine_name];
    for (const v of nested) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

function scheduleSecondaryLine(freqRaw: string | null | undefined, durationRaw: string | null | undefined): string {
  const freq = expandFrequencyAbbreviations(typeof freqRaw === "string" ? freqRaw : "");
  const dur = typeof durationRaw === "string" ? durationRaw.trim() : "";
  const line = [freq || null, dur || null].filter(Boolean).join(" · ");
  return line || "—";
}

/** Maps a DB prescription line to a MedicationRequest for the patient summary card. */
export function prescriptionRowToMedicationRequest(row: Record<string, unknown>): FhirMedicationRequest {
  const id = row.id != null ? String(row.id) : "";
  const encounterId = row.encounter_id != null ? String(row.encounter_id) : "";
  const drug = pickDrugNameFromPrescriptionRow(row);
  const dose = typeof row.dosage_text === "string" ? row.dosage_text.trim() : "";
  const primary = drug ? (dose ? `${drug} ${dose}` : drug) : dose || "Medication";

  const secondary = scheduleSecondaryLine(
    typeof row.frequency === "string" ? row.frequency : null,
    typeof row.duration === "string" ? row.duration : null,
  );

  const indicationRaw = row.clinical_indication ?? row.indication;
  const indication = typeof indicationRaw === "string" ? indicationRaw.trim() : "";

  return {
    resourceType: "MedicationRequest",
    id,
    status: "active",
    intent: "order",
    medicationCodeableConcept: { text: primary },
    dosageInstruction: [{ text: secondary }],
    reasonCode: indication ? [{ text: indication }] : undefined,
    authoredOn: row.created_at != null ? String(row.created_at) : undefined,
    encounterId: encounterId || undefined,
  };
}
