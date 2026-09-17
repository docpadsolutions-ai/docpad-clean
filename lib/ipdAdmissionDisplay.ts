/** Pure helpers for `get_ipd_admission` RPC payload (ward/bed objects, pre_admission, patient). */

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  if (v != null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Ward & Bed display: `${ward.name ?? '—'}, ${bed.bed_number ?? '—'}` */
export function wardBedLabelFromAdmission(admission: Record<string, unknown> | null): string {
  const ward = admission ? asRecord(admission.ward) : null;
  const bed = admission ? asRecord(admission.bed) : null;
  const wName = ward?.name != null && str(ward.name) !== "" ? str(ward.name) : "—";
  const bNum = bed?.bed_number != null && str(bed.bed_number) !== "" ? str(bed.bed_number) : "—";
  return `${wName}, ${bNum}`;
}

export function preAdmissionFrom(admission: Record<string, unknown> | null): Record<string, unknown> | null {
  return asRecord(admission?.pre_admission);
}

export function patientFromAdmission(admission: Record<string, unknown> | null): Record<string, unknown> | null {
  return asRecord(admission?.patient);
}

/** First line or "Procedure: …" line from surgical plan notes. */
export function extractProcedureNameFromSurgicalPlanNotes(notes: string): string {
  const t = notes.trim();
  if (!t) return "";
  const proc = t.match(/procedure\s*[:\-]\s*([^\n]+)/i);
  if (proc?.[1]) return proc[1].trim();
  const line = t.split(/\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.slice(0, 120);
}

/** Try ISO / common date patterns inside free text. */
export function extractSurgeryDateFromNotes(notes: string): string | null {
  const t = notes.trim();
  if (!t) return null;
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    const [, a, b, y] = slash;
    const mm = a.padStart(2, "0");
    const dd = b.padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  const mdy = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})\b/i);
  if (mdy) {
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const mo = months[mdy[1].toLowerCase().slice(0, 3)];
    if (mo) {
      const d = mdy[2].padStart(2, "0");
      return `${mdy[3]}-${mo}-${d}`;
    }
  }
  return null;
}

export function formatClinicalDate(v: unknown): string {
  const t = str(v);
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function parseSymptomsJson(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v) as unknown;
      return Array.isArray(j) ? (j.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function symptomCategoryDisplay(
  preAdmission: Record<string, unknown> | null,
  specialty: string,
): string {
  const pa = preAdmission;
  const arr = parseSymptomsJson(pa?.symptoms_json);
  const cat = str(arr[0]?.category);
  if (cat) return cat;
  if (/orthop/i.test(specialty)) return "Musculoskeletal";
  return "—";
}

function systemicExamDisplay(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const j = JSON.parse(t) as { physical_examination?: { systemic?: unknown }; loaded_system_ids?: unknown };
    if (j?.physical_examination?.systemic != null) {
      const ids = Array.isArray(j.loaded_system_ids) ? j.loaded_system_ids.length : 0;
      return ids > 0 ? `Structured systemic exam (${ids} systems)` : "Structured systemic examination";
    }
  } catch {
    return t;
  }
  return t;
}

export function baselineExamDisplay(preAdmission: Record<string, unknown> | null): string {
  const pa = preAdmission;
  if (!pa) return "—";
  const g = str(pa.general_appearance);
  const sRaw = str(pa.systemic_examination);
  const s = systemicExamDisplay(sRaw);
  const combined = [g, s].filter(Boolean).join(" ").trim();
  return combined || "—";
}

export function allergiesListFromPatient(patient: Record<string, unknown> | null): string[] {
  if (!patient) return [];
  const raw = patient.known_allergies;
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object" && "display" in (x as object)) {
          return str((x as { display?: unknown }).display);
        }
        return str(x);
      })
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s) as unknown;
      if (Array.isArray(j)) {
        return j.map((x) => (typeof x === "string" ? x : str(x))).filter(Boolean);
      }
    } catch {
      return [s];
    }
  }
  return [];
}

export type AdmissionCardViewModel = {
  titleLine: string;
  specialtyBadge: string;
  wardBed: string;
  admissionDateDisplay: string;
  surgeryDateDisplay: string;
  chiefComplaint: string;
  hpi: string;
  symptomCategory: string;
  diagnosis: string;
  /** ICD-10 for primary diagnosis when stored (shown next to diagnosis text). */
  diagnosisIcd10: string | null;
  baselineExam: string;
  hasAllergies: boolean;
  allergyLabels: string[];
};

export function buildAdmissionCardView(
  admission: Record<string, unknown> | null,
): AdmissionCardViewModel {
  const adm = admission;
  const pa = preAdmissionFrom(adm);
  const patient = patientFromAdmission(adm);

  const specialtyBadge = str(pa?.specialty) || str(adm?.specialty) || "—";

  const spNotes = str(pa?.surgical_plan_notes);
  const titleSuffix = spNotes
    ? extractProcedureNameFromSurgicalPlanNotes(spNotes) || "Admission"
    : str(pa?.primary_diagnosis_display) || str(adm?.primary_diagnosis_display) || "Admission";

  const titleLine = `Inpatient Admission – ${titleSuffix}`;

  const wardBed = wardBedLabelFromAdmission(adm);
  const admissionDateDisplay = formatClinicalDate(adm?.admitted_at ?? adm?.admission_date);

  const surgeryFromNotes = spNotes ? extractSurgeryDateFromNotes(spNotes) : null;
  const surgeryDateRaw = surgeryFromNotes ?? str(pa?.surgery_date) ?? str(adm?.surgery_date);
  const surgeryDateDisplay = surgeryDateRaw ? formatClinicalDate(surgeryDateRaw) : "—";

  const chiefComplaint = str(pa?.chief_complaint) || "—";
  const hpi = str(pa?.hpi_narrative) || str(pa?.hpi_one_liner) || "—";
  const symptomCategory = symptomCategoryDisplay(pa, specialtyBadge);
  const diagnosis =
    str(pa?.primary_diagnosis_display) || str(adm?.primary_diagnosis_display) || "—";
  const diagnosisIcd10Raw = str(pa?.primary_diagnosis_icd10) || str(adm?.primary_diagnosis_icd10);
  const diagnosisIcd10 = diagnosisIcd10Raw || null;
  const baselineExam = baselineExamDisplay(pa);

  const allergyLabels = allergiesListFromPatient(patient);

  return {
    titleLine,
    specialtyBadge,
    wardBed,
    admissionDateDisplay,
    surgeryDateDisplay,
    chiefComplaint,
    hpi,
    symptomCategory,
    diagnosis,
    diagnosisIcd10,
    baselineExam,
    hasAllergies: allergyLabels.length > 0,
    allergyLabels,
  };
}
