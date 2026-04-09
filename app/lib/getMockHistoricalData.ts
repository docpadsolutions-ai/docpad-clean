import type { HealthTimelineNode } from "./fhirEncounterTimeline";

/**
 * Deterministic mock IPD / Surgery / Emergency events over the last ~12 months (demo only).
 */
export function getMockHistoricalData(patientSeed: string): HealthTimelineNode[] {
  const base = patientSeed.length * 9973;
  const monthsAgo = (m: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    d.setDate(d.getDate() + (base % 7) - 3);
    return d.toISOString();
  };

  const nodes: HealthTimelineNode[] = [
    {
      resourceType: "Encounter",
      id: `mock-ipd-${base}-1`,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "IMP",
        display: "inpatient encounter",
      },
      period: { start: monthsAgo(10), end: monthsAgo(9) },
      reasonCode: [
        {
          coding: [{ system: "http://snomed.info/sct", code: "431855005", display: "CKD stage 3" }],
          text: "CKD Stage 3 — metabolic workup",
        },
      ],
      _source: "mock",
      _kind: "ipd",
      _displayLabel: "CKD Stage 3",
    },
    {
      resourceType: "Encounter",
      id: `mock-emer-${base}-2`,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "EMER",
        display: "emergency",
      },
      period: { start: monthsAgo(7), end: monthsAgo(7) },
      reasonCode: [
        {
          coding: [{ system: "http://snomed.info/sct", code: "267036007", display: "Dyspnea" }],
          text: "Acute dyspnea",
        },
      ],
      _source: "mock",
      _kind: "emergency",
      _displayLabel: "Acute dyspnea",
    },
    {
      resourceType: "Encounter",
      id: `mock-ss-${base}-3`,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "SS",
        display: "short stay",
      },
      period: { start: monthsAgo(5), end: monthsAgo(5) },
      reasonCode: [
        {
          coding: [{ system: "http://snomed.info/sct", code: "80146002", display: "Appendectomy" }],
          text: "Laparoscopic appendectomy",
        },
      ],
      _source: "mock",
      _kind: "surgery",
      _displayLabel: "Appendectomy",
    },
    {
      resourceType: "Encounter",
      id: `mock-ipd-${base}-4`,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "IMP",
        display: "inpatient encounter",
      },
      period: { start: monthsAgo(3), end: monthsAgo(2) },
      reasonCode: [
        {
          coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertensive disorder" }],
          text: "Hypertensive urgency",
        },
      ],
      _source: "mock",
      _kind: "ipd",
      _displayLabel: "Hypertensive urgency",
    },
    {
      resourceType: "Encounter",
      id: `mock-emer-${base}-5`,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "EMER",
        display: "emergency",
      },
      period: { start: monthsAgo(1), end: monthsAgo(1) },
      reasonCode: [
        {
          text: "Minor trauma — forearm laceration",
        },
      ],
      _source: "mock",
      _kind: "emergency",
      _displayLabel: "Forearm laceration",
    },
  ];

  return nodes;
}
