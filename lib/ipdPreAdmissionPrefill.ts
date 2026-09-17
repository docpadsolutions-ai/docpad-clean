import type { SupabaseClient } from "@supabase/supabase-js";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function pickEmbedded<T extends Record<string, unknown>>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  if (Array.isArray(v)) return (v[0] as T | undefined) ?? null;
  return v;
}

const ONSET = new Set(["sudden", "gradual", "insidious"]);
const REL = new Set(["good", "fair", "poor"]);
const SETTING = new Set(["OPD", "ER", "IPD", "Tele"]);
const SOURCE = new Set(["Patient", "Relative", "Records"]);
const DURATION_UNITS = new Set(["days", "weeks", "months", "years"]);

function normalizeOnset(v: unknown): "" | "sudden" | "gradual" | "insidious" {
  const s = str(v).toLowerCase();
  return ONSET.has(s) ? (s as "sudden" | "gradual" | "insidious") : "";
}

function normalizeReliability(v: unknown): "" | "good" | "fair" | "poor" {
  const s = str(v).toLowerCase();
  return REL.has(s) ? (s as "good" | "fair" | "poor") : "";
}

function parseStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v) as unknown;
      if (Array.isArray(j)) return j.map((x) => str(x)).filter(Boolean);
    } catch {
      return v
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function toSettingSet(values: string[]): Set<"OPD" | "ER" | "IPD" | "Tele"> {
  const out = new Set<"OPD" | "ER" | "IPD" | "Tele">();
  for (const raw of values) {
    const u = raw.toUpperCase();
    if (u === "OPD" || u === "ER" || u === "IPD" || u === "TELE") {
      out.add(u === "TELE" ? "Tele" : (u as "OPD" | "ER" | "IPD"));
    }
  }
  return out;
}

function toSourceSet(values: string[]): Set<"Patient" | "Relative" | "Records"> {
  const out = new Set<"Patient" | "Relative" | "Records">();
  for (const raw of values) {
    const t = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (t === "Patient" || t === "Relative" || t === "Records") out.add(t);
  }
  return out;
}

export type OpqrstShape = {
  onset: string;
  provocation: string;
  palliation: string;
  quality: string;
  region: string;
  severityNow: string;
  severityWorst: string;
  severityBaseline: string;
  timing: string;
  associated: string;
  negatives: string;
};

const emptyOpqrst = (): OpqrstShape => ({
  onset: "",
  provocation: "",
  palliation: "",
  quality: "",
  region: "",
  severityNow: "",
  severityWorst: "",
  severityBaseline: "",
  timing: "",
  associated: "",
  negatives: "",
});

function parseSymptomCharacterizations(v: unknown): { opqrst: OpqrstShape; category: string } {
  const base = emptyOpqrst();
  let category = "";
  if (v == null) return { opqrst: base, category };
  let obj: Record<string, unknown> | null = null;
  if (typeof v === "string") {
    try {
      obj = JSON.parse(v) as Record<string, unknown>;
    } catch {
      return { opqrst: base, category };
    }
  } else if (typeof v === "object" && !Array.isArray(v)) {
    obj = v as Record<string, unknown>;
  }
  if (!obj) return { opqrst: base, category };

  const keys: (keyof OpqrstShape)[] = [
    "onset",
    "provocation",
    "palliation",
    "quality",
    "region",
    "severityNow",
    "severityWorst",
    "severityBaseline",
    "timing",
    "associated",
    "negatives",
  ];
  for (const k of keys) {
    const val = obj[k] ?? obj[k.replace(/([A-Z])/g, "_$1").toLowerCase()];
    if (val != null) base[k] = str(val);
  }
  category = str(obj.category ?? obj.symptom_category);
  return { opqrst: base, category };
}

function parseReviewOfSystems(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v) as Record<string, unknown>;
      return Boolean(j.all_other_systems_negative ?? j.all_negative ?? j.allNegative);
    } catch {
      return /all\s*(other\s*)?systems?\s*negative/i.test(v);
    }
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Boolean(o.all_other_systems_negative ?? o.all_negative ?? o.allNegative);
  }
  return false;
}

function parseEncounterVitalsJson(v: unknown): Partial<{
  hr: string;
  bpSys: string;
  bpDia: string;
  rr: string;
  temp: string;
  spo2: string;
}> {
  if (v == null || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const hr = str(o.hr ?? o.heart_rate ?? o.pulse);
  const rr = str(o.rr ?? o.respiratory_rate);
  const temp = str(o.temp ?? o.temperature);
  const spo2 = str(o.spo2);
  let bpSys = "";
  let bpDia = "";
  const bp = str(o.bp ?? o.blood_pressure);
  if (bp) {
    const m = /^(\d+)\s*\/\s*(\d+)/.exec(bp);
    if (m) {
      bpSys = m[1];
      bpDia = m[2];
    }
  }
  bpSys = bpSys || str(o.bp_systolic ?? o.systolic);
  bpDia = bpDia || str(o.bp_diastolic ?? o.diastolic);
  return { hr, bpSys, bpDia, rr, temp, spo2 };
}

export type PrefillFromEncounterInput = Record<string, unknown>;

/** Map `opd_encounters` row (+ optional structured columns) into assessment form fields. */
export function mapOpdEncounterToAssessmentDraft(enc: PrefillFromEncounterInput): {
  chiefComplaint: string;
  ccOnset: "" | "sudden" | "gradual" | "insidious";
  ccSetting: Set<"OPD" | "ER" | "IPD" | "Tele">;
  ccSource: Set<"Patient" | "Relative" | "Records">;
  ccReliability: "" | "good" | "fair" | "poor";
  durationAmt: string;
  durationUnit: "days" | "weeks" | "months" | "years";
  hpiOneLiner: string;
  hpiNarrative: string;
  symptomCategory: string;
  opqrst: OpqrstShape;
  rosAllNegative: boolean;
  vitals: { hr: string; bpSys: string; bpDia: string; rr: string; temp: string; spo2: string };
  specialty: string;
  primaryDxDisplay: string;
  primaryDxIcd10: string;
} {
  const chiefComplaint =
    str(enc.chief_complaint_text) || str(enc.chief_complaint) || "";

  const ccOnset = normalizeOnset(enc.onset);
  const ccReliability = normalizeReliability(enc.reliability);

  const settingRaw = parseStringArray(enc.setting);
  const ccSetting = toSettingSet(settingRaw.length ? settingRaw : parseStringArray(str(enc.setting)));

  const sourceRaw = parseStringArray(enc.source);
  const ccSource = toSourceSet(sourceRaw.length ? sourceRaw : parseStringArray(str(enc.source)));

  const dv = enc.duration_value;
  const durationAmt =
    dv != null && dv !== ""
      ? typeof dv === "number"
        ? String(dv)
        : str(dv)
      : "";

  let durationUnit = str(enc.duration_unit).toLowerCase() as "days" | "weeks" | "months" | "years";
  if (!DURATION_UNITS.has(durationUnit)) durationUnit = "weeks";

  const hpiOneLiner = str(enc.hpi_one_liner);
  const hpiNarrative = str(enc.hpi_narrative);

  const { opqrst, category: symCatFromJson } = parseSymptomCharacterizations(enc.symptom_characterizations);
  const symptomCategory = symCatFromJson;

  const rosAllNegative = parseReviewOfSystems(enc.review_of_systems);

  let vitals = {
    hr: "",
    bpSys: "",
    bpDia: "",
    rr: "",
    temp: "",
    spo2: "",
  };
  const fromJson = parseEncounterVitalsJson(enc.vitals);
  vitals = { ...vitals, ...fromJson };
  if (enc.pulse != null) vitals.hr = str(enc.pulse);
  const bps = str(enc.blood_pressure);
  if (bps) {
    const m = /^(\d+)\s*\/\s*(\d+)/.exec(bps);
    if (m) {
      vitals.bpSys = m[1];
      vitals.bpDia = m[2];
    }
  }
  if (enc.temperature != null) vitals.temp = str(enc.temperature);
  if (enc.spo2 != null) vitals.spo2 = str(enc.spo2);
  const rr = enc.respiratory_rate ?? enc.rr;
  if (rr != null) vitals.rr = str(rr);

  const specialty = str(enc.department) || "";

  let primaryDxDisplay = "";
  let primaryDxIcd10 = "";
  const dx = enc.diagnosis_fhir;
  if (dx && typeof dx === "object" && !Array.isArray(dx)) {
    const d = dx as { display?: string; icd10?: string | null };
    primaryDxDisplay = str(d.display);
    if (d.icd10) primaryDxIcd10 = str(d.icd10);
  }

  return {
    chiefComplaint,
    ccOnset,
    ccSetting,
    ccSource,
    ccReliability,
    durationAmt,
    durationUnit,
    hpiOneLiner,
    hpiNarrative,
    symptomCategory,
    opqrst,
    rosAllNegative,
    vitals,
    specialty,
    primaryDxDisplay,
    primaryDxIcd10,
  };
}

function formatPrefillBannerDate(v: unknown): string {
  const t = str(v);
  if (!t) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export type AdmissionEncounterFetchResult = {
  encounter: Record<string, unknown> | null;
  encounterId: string | null;
  appointmentId: string | null;
  prefillBannerDate: string;
  error: Error | null;
};

/**
 * Resolve OPD encounter via ipd_admissions → appointments → opd_encounters.
 * Uses explicit chained queries so embeds work without PostgREST relationship hints.
 */
export async function fetchOpdEncounterViaAdmissionChain(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<AdmissionEncounterFetchResult> {
  const empty: AdmissionEncounterFetchResult = {
    encounter: null,
    encounterId: null,
    appointmentId: null,
    prefillBannerDate: "",
    error: null,
  };

  const { data: adm, error: e1 } = await supabase
    .from("ipd_admissions")
    .select("appointment_id")
    .eq("id", admissionId)
    .maybeSingle();

  if (e1) return { ...empty, error: new Error(e1.message) };
  const appointmentId = adm?.appointment_id != null ? str(adm.appointment_id) : "";
  if (!appointmentId) return empty;

  const { data: appt, error: e2 } = await supabase
    .from("appointments")
    .select("encounter_id")
    .eq("id", appointmentId)
    .maybeSingle();

  if (e2) return { ...empty, error: new Error(e2.message) };
  const encId = appt?.encounter_id != null ? str(appt.encounter_id) : "";
  if (!encId) return { ...empty, appointmentId };

  const { data: enc, error: e3 } = await supabase
    .from("opd_encounters")
    .select("*, patient:patients!patient_id(*)")
    .eq("id", encId)
    .maybeSingle();

  if (e3) return { ...empty, appointmentId, error: new Error(e3.message) };
  if (!enc || typeof enc !== "object") return { ...empty, appointmentId };

  const row = enc as Record<string, unknown>;
  const prefillBannerDate = formatPrefillBannerDate(row.updated_at ?? row.created_at);

  return {
    encounter: row,
    encounterId: str(row.id) || encId,
    appointmentId,
    prefillBannerDate,
    error: null,
  };
}

export { pickEmbedded };
