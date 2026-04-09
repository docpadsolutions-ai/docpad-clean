/**
 * FHIR R4 MedicationRequest — minimal fields for summary UI.
 * @see https://hl7.org/fhir/R4/medicationrequest.html
 */

export type FhirMedicationRequestStatus =
  | "active"
  | "on-hold"
  | "cancelled"
  | "completed"
  | "entered-in-error"
  | "stopped"
  | "draft"
  | "unknown";

export interface FhirDosageInstruction {
  text?: string;
  /** Additional dose + frequency line for display */
  doseAndRateSummary?: string;
}

export interface FhirCodeableConcept {
  text?: string;
  coding?: Array<{ system?: string; code?: string; display?: string }>;
}

/** In-memory representation for DocPad summary (backed by `prescriptions` rows). */
export interface FhirMedicationRequest {
  resourceType: "MedicationRequest";
  id: string;
  status: FhirMedicationRequestStatus;
  intent: "order";
  medicationCodeableConcept?: FhirCodeableConcept;
  dosageInstruction?: FhirDosageInstruction[];
  /** Problem / diagnosis this Rx targets — maps to `clinical_indication` when present */
  reasonCode?: FhirCodeableConcept[];
  authoredOn?: string;
  /** Source encounter for deep links */
  encounterId?: string;
}

export function groupMedicationRequestsByIndication(
  requests: FhirMedicationRequest[],
): Map<string, FhirMedicationRequest[]> {
  const map = new Map<string, FhirMedicationRequest[]>();
  for (const r of requests) {
    const raw = r.reasonCode?.[0]?.text?.trim();
    const key = raw && raw.length > 0 ? raw : "Current";
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return map;
}
