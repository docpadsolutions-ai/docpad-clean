/**
 * Timeline nodes shaped for FHIR R4 Encounter alignment (subset used in UI + persistence).
 * @see https://hl7.org/fhir/R4/encounter.html
 */

export type FhirEncounterStatus = "planned" | "arrived" | "triaged" | "in-progress" | "onleave" | "finished" | "cancelled" | "entered-in-error" | "unknown";

/** FHIR v3 ActCode — common classes for our timeline */
export type FhirEncounterClassCode = "AMB" | "IMP" | "EMER" | "SS";

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirCodeableConcept {
  coding?: Array<{ system?: string; code?: string; display?: string }>;
  text?: string;
}

/** Minimal Encounter resource fields we use in the Health Timeline */
export interface FhirEncounterTimelineNode {
  resourceType: "Encounter";
  id: string;
  status: FhirEncounterStatus;
  class: {
    system: "http://terminology.hl7.org/CodeSystem/v3-ActCode";
    code: FhirEncounterClassCode;
    display: string;
  };
  period: FhirPeriod;
  reasonCode?: FhirCodeableConcept[];
}

/** App-specific extensions (not sent as FHIR JSON to server — UI routing + styling) */
export type TimelineNodeSource = "live" | "mock";
export type TimelineEncounterKind = "opd" | "ipd" | "surgery" | "emergency";

export interface HealthTimelineNode extends FhirEncounterTimelineNode {
  _source: TimelineNodeSource;
  _kind: TimelineEncounterKind;
  /** Short label: chief complaint, then working diagnosis, else routine visit (live OPD). */
  _displayLabel: string;
  /** Live OPD row id — navigate + scroll when set */
  _opdEncounterId?: string;
}

export function sortTimelineByPeriodStart(a: HealthTimelineNode, b: HealthTimelineNode): number {
  const ta = Date.parse(a.period.start ?? "");
  const tb = Date.parse(b.period.start ?? "");
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}
