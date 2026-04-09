/**
 * Minimal FHIR R4 Bundle builder from DocPad OPD encounter + patient rows.
 * Profiles can be tightened to NDHM HIP bundles when integrating with gateway schemas.
 */

export type FhirResource = Record<string, unknown>;

export type FhirBundleR4 = {
  resourceType: "Bundle";
  type: "collection" | "document";
  timestamp?: string;
  identifier?: { system?: string; value: string };
  entry: { fullUrl?: string; resource: FhirResource }[];
};

function urnUuid(): string {
  return `urn:uuid:${crypto.randomUUID()}`;
}

function pickStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function pickNum(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build a `collection` Bundle: Patient, Encounter, optional Condition (diagnoses), MedicationRequest stubs.
 */
export function buildEncounterFhirBundle(input: {
  encounter: Record<string, unknown>;
  patient: Record<string, unknown>;
  organizationName?: string | null;
  prescriptions?: Record<string, unknown>[] | null;
}): FhirBundleR4 {
  const enc = input.encounter;
  const pat = input.patient;

  const patientId = pickStr(pat.id) ?? "unknown-patient";
  const encounterId = pickStr(enc.id) ?? "unknown-encounter";

  const patientRef = `Patient/${patientId}`;
  const encounterRef = `Encounter/${encounterId}`;

  const patientResource: FhirResource = {
    resourceType: "Patient",
    id: patientId,
    identifier: pat.docpad_id
      ? [{ system: "https://docpad.in/identifiers/docpad-id", value: String(pat.docpad_id) }]
      : undefined,
    name: pat.full_name
      ? [{ text: String(pat.full_name) }]
      : undefined,
    gender: mapGender(pat.sex ?? pat.gender),
    birthDate: pat.date_of_birth != null ? String(pat.date_of_birth).slice(0, 10) : undefined,
    telecom: pat.phone ? [{ system: "phone", value: String(pat.phone) }] : undefined,
  };

  const encounterResource: FhirResource = {
    resourceType: "Encounter",
    id: encounterId,
    status: mapEncounterStatus(pickStr(enc.status)),
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    subject: { reference: patientRef },
    period: {
      start: enc.encounter_date != null ? `${String(enc.encounter_date).slice(0, 10)}T00:00:00Z` : undefined,
    },
    reasonCode: enc.chief_complaint
      ? [{ text: String(enc.chief_complaint) }]
      : undefined,
    hospitalization: undefined,
  };

  /** Vitals as Observation resources */
  const vitals: FhirResource[] = [];
  const addObs = (code: string, display: string, value: unknown, unit?: string) => {
    if (value == null || value === "") return;
    vitals.push({
      resourceType: "Observation",
      id: `obs-${code}-${encounterId}`,
      status: "final",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
              display: "Vital Signs",
            },
          ],
        },
      ],
      code: {
        coding: [{ system: "http://loinc.org", code, display }],
        text: display,
      },
      subject: { reference: patientRef },
      encounter: { reference: encounterRef },
      effectiveDateTime: encounterResource.period && typeof encounterResource.period === "object"
        ? (encounterResource.period as { start?: string }).start
        : undefined,
      valueQuantity: unit
        ? { value: pickNum(value), unit, system: "http://unitsofmeasure.org" }
        : { value: pickNum(value) ?? String(value), unit: unit ?? "1" },
    });
  };

  addObs("29463-7", "Body weight", enc.weight, "kg");
  addObs("85354-9", "Blood pressure", enc.blood_pressure);
  addObs("8867-4", "Heart rate", enc.pulse, "/min");
  addObs("8310-5", "Body temperature", enc.temperature, "Cel");
  addObs("59408-5", "Oxygen saturation", enc.spo2, "%");

  const entries: { fullUrl?: string; resource: FhirResource }[] = [
    { fullUrl: urnUuid(), resource: patientResource },
    { fullUrl: urnUuid(), resource: encounterResource },
    ...vitals.map((r) => ({ fullUrl: urnUuid(), resource: r })),
  ];

  /** Diagnoses: support JSON array or newline-separated text */
  const dxRaw = enc.diagnosis ?? enc.diagnoses ?? enc.diagnosis_entries;
  const dxList = normalizeDiagnosisList(dxRaw);
  for (let i = 0; i < dxList.length; i++) {
    const d = dxList[i];
    entries.push({
      fullUrl: urnUuid(),
      resource: {
        resourceType: "Condition",
        id: `condition-${encounterId}-${i}`,
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
              code: "active",
            },
          ],
        },
        subject: { reference: patientRef },
        encounter: { reference: encounterRef },
        code: { text: d.text, coding: d.code ? [{ system: "http://snomed.info/sct", code: d.code }] : undefined },
      },
    });
  }

  const rx = input.prescriptions ?? [];
  for (let i = 0; i < rx.length; i++) {
    const p = rx[i];
    const medName =
      pickStr(p.medicine_name) ??
      pickStr(p.medication_name) ??
      pickStr(p.drug_name) ??
      pickStr(p.medication) ??
      "Medication";
    entries.push({
      fullUrl: urnUuid(),
      resource: {
        resourceType: "MedicationRequest",
        id: `medreq-${encounterId}-${i}`,
        status: "active",
        intent: "order",
        subject: { reference: patientRef },
        encounter: { reference: encounterRef },
        medicationCodeableConcept: { text: medName },
        dosageInstruction: p.dosage_text
          ? [{ text: String(p.dosage_text) }]
          : undefined,
      },
    });
  }

  if (input.organizationName?.trim()) {
    entries.push({
      fullUrl: urnUuid(),
      resource: {
        resourceType: "Organization",
        id: pickStr(enc.hospital_id) ?? "org",
        name: input.organizationName.trim(),
      },
    });
  }

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    identifier: {
      system: "https://docpad.in/fhir/bundle",
      value: `encounter-${encounterId}`,
    },
    entry: entries,
  };
}

function mapGender(sex: unknown): "male" | "female" | "other" | "unknown" {
  const s = String(sex ?? "").toLowerCase();
  if (s.startsWith("f")) return "female";
  if (s.startsWith("m")) return "male";
  if (s === "other" || s === "o") return "other";
  return "unknown";
}

function mapEncounterStatus(s: string | undefined): string {
  const v = (s ?? "finished").toLowerCase();
  if (["planned", "arrived", "triaged", "in-progress", "onleave", "finished", "cancelled"].includes(v)) {
    return v;
  }
  if (v === "finalized" || v === "completed") return "finished";
  return "finished";
}

function normalizeDiagnosisList(raw: unknown): { text: string; code?: string }[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return { text: item.trim() };
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const text =
            pickStr(o.text) ?? pickStr(o.label) ?? pickStr(o.name) ?? pickStr(o.diagnosis) ?? pickStr(o.condition_name);
          const code = pickStr(o.snomed_code) ?? pickStr(o.icd10) ?? pickStr(o.code);
          if (text) return { text, code };
        }
        return null;
      })
      .filter(Boolean) as { text: string; code?: string }[];
  }
  if (typeof raw === "string") {
    return raw
      .split(/\n|;|,/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  }
  return [];
}

/**
 * Stable JSON stringify for signing / encryption (sorted object keys shallowly — sufficient for typical bundles).
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? sortKeys(v as Record<string, unknown>) : v));
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, {});
}
