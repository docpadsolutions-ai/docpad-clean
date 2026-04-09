import type { FhirBundleR4, FhirResource } from "./fhir-builder";

/**
 * ABDM HI Types (Health Information types) commonly used in consent artefacts.
 * @see NDHM consent / HIU documentation for the authoritative enum.
 */
export const ABDM_HI_TYPES = [
  "Prescription",
  "DiagnosticReport",
  "OPConsultation",
  "DischargeSummary",
  "ImmunizationRecord",
  "HealthDocumentRecord",
  "WellnessRecord",
  "Invoice",
] as const;

export type AbdmHiType = (typeof ABDM_HI_TYPES)[number];

const DEFAULT_HI_FOR_UNKNOWN = "HealthDocumentRecord";

/**
 * Map a FHIR resource to an ABDM HI type for consent filtering.
 */
export function fhirResourceToHiType(resource: FhirResource): string {
  const rt = String(resource.resourceType ?? "");
  switch (rt) {
    case "MedicationRequest":
    case "MedicationStatement":
      return "Prescription";
    case "DiagnosticReport":
    case "ImagingStudy":
      return "DiagnosticReport";
    case "Observation":
      return inferObservationHiType(resource);
    case "Encounter":
    case "Composition":
      return "OPConsultation";
    case "Condition":
    case "Procedure":
      return "OPConsultation";
    case "Immunization":
      return "ImmunizationRecord";
    case "DocumentReference":
      return "HealthDocumentRecord";
    case "Patient":
    case "Organization":
    case "Practitioner":
    case "PractitionerRole":
      return "WellnessRecord";
    default:
      return DEFAULT_HI_FOR_UNKNOWN;
  }
}

function inferObservationHiType(obs: FhirResource): string {
  const cat = obs.category;
  if (Array.isArray(cat)) {
    for (const c of cat) {
      const coding = (c as { coding?: { code?: string }[] })?.coding;
      const code = coding?.[0]?.code;
      if (code === "vital-signs" || code === "laboratory") {
        return "DiagnosticReport";
      }
    }
  }
  const code = obs.code as { coding?: { code?: string }[] } | undefined;
  const loinc = code?.coding?.find((x) => x.code)?.code;
  if (loinc && /^\d+-\d+$/.test(loinc)) {
    return "DiagnosticReport";
  }
  return "OPConsultation";
}

function normalizeHiType(t: string): string {
  return t.trim();
}

/**
 * Returns true if the HI type is allowed by the consent grant (case-insensitive).
 */
export function isHiTypeAllowed(hiType: string, allowed: Set<string>): boolean {
  const n = normalizeHiType(hiType);
  for (const a of allowed) {
    if (a.toLowerCase() === n.toLowerCase()) return true;
  }
  return false;
}

/**
 * Build a Set from consent payload `hiTypes` arrays (NDHM shapes vary).
 */
export function allowedHiTypesFromConsentPayload(payload: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out.add(s);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      walk(o.hiTypes);
      walk(o.hi_types);
      walk(o.hiType);
      walk(o.type);
      walk(o.code);
      const types = o.types;
      if (Array.isArray(types)) walk(types);
    }
  };

  if (payload && typeof payload === "object") {
    const root = payload as Record<string, unknown>;
    walk(root.hiTypes);
    walk(root.hi_types);
    walk(root.permission);
    walk(root.consentDetail);
    walk(root.consent_detail);
    const detail = root.detail ?? root.consent;
    if (detail && typeof detail === "object") {
      walk((detail as Record<string, unknown>).hiTypes);
      walk((detail as Record<string, unknown>).hi_types);
    }
  }

  return out;
}

const ALWAYS_PASS_THROUGH = new Set(["Patient", "Organization", "Practitioner", "PractitionerRole"]);

/**
 * Remove Bundle entries whose resources are not covered by allowed HI types.
 * If `allowed` is empty, no entries are removed (fail-open — caller should validate consent exists).
 * Patient / Organization / Practitioner entries are kept so the bundle stays referentially usable.
 */
export function filterFhirBundleByHiTypes(bundle: FhirBundleR4, allowedHiTypes: Set<string>): FhirBundleR4 {
  if (allowedHiTypes.size === 0) {
    return { ...bundle, entry: [...bundle.entry] };
  }

  const entry = bundle.entry.filter((e) => {
    const res = e.resource;
    if (!res || typeof res !== "object") return false;
    const rt = String(res.resourceType ?? "");
    if (ALWAYS_PASS_THROUGH.has(rt)) return true;
    const hi = fhirResourceToHiType(res);
    return isHiTypeAllowed(hi, allowedHiTypes);
  });

  return {
    ...bundle,
    entry,
  };
}
