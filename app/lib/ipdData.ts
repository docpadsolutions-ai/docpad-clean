import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickIpdPreAdmissionAssessmentColumns,
  type IpdPreAdmissionAssessmentColumn,
} from "@/app/lib/ipdPreAdmissionAssessmentColumns";

/** Normalize RPC return: single row object or first element of array. */
export function unwrapRpcRow<T extends Record<string, unknown>>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? (first as T) : null;
  }
  if (typeof data === "object") return data as T;
  return null;
}

export async function rpcGetIpdAdmission(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_ipd_admission", {
    p_admission_id: admissionId,
  });
  if (error) return { data: null, error: new Error(error.message) };
  const row = unwrapRpcRow<Record<string, unknown>>(data);
  return { data: row, error: null };
}

/** Unwrap JSONB from `get_ipd_admission` when nested under `data`. */
export function normalizeIpdAdmissionBundle(raw: unknown): Record<string, unknown> | null {
  const row = unwrapRpcRow<Record<string, unknown>>(raw);
  if (!row) return null;
  if (row.admission != null || Array.isArray(row.progress_notes)) return row;
  const inner = row.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return row;
}

/**
 * Inpatient encounter page: loads `ipd_admissions` with explicit columns (including `patient_id`)
 * and ward/bed/patient/pre_admission embeds. Prefer this over `get_ipd_admission` when the RPC
 * omits top-level `patient_id`.
 */
export async function fetchIpdAdmissionForEncounterPage(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const fullSelect = `
    *,
    ward:ipd_wards(name, code),
    bed:ipd_beds(bed_number),
    patient:patients(*),
    pre_admission:ipd_pre_admission_assessments(*)
  `;
  const { data: rowFull, error: errFull } = await supabase
    .from("ipd_admissions")
    .select(fullSelect)
    .eq("id", admissionId)
    .maybeSingle();

  if (!errFull && rowFull && typeof rowFull === "object") {
    return { data: rowFull as Record<string, unknown>, error: null };
  }

  const slimSelect = `
    *,
    ward:ipd_wards(name, code),
    bed:ipd_beds(bed_number),
    patient:patients(*)
  `;
  const { data: rowSlim, error: errSlim } = await supabase
    .from("ipd_admissions")
    .select(slimSelect)
    .eq("id", admissionId)
    .maybeSingle();

  if (!errSlim && rowSlim && typeof rowSlim === "object") {
    return { data: rowSlim as Record<string, unknown>, error: null };
  }

  const { data: rowBare, error: errBare } = await supabase
    .from("ipd_admissions")
    .select("*")
    .eq("id", admissionId)
    .maybeSingle();

  if (!errBare && rowBare && typeof rowBare === "object") {
    return { data: rowBare as Record<string, unknown>, error: null };
  }

  const msg = errFull?.message ?? errSlim?.message ?? errBare?.message ?? "Failed to load admission";
  return { data: null, error: new Error(msg) };
}

export async function rpcGetOrCreateProgressNote(
  supabase: SupabaseClient,
  args: { admissionId: string; hospitalDayNumber: number; noteDate: string },
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_or_create_progress_note", {
    p_admission_id: args.admissionId,
    p_hospital_day_number: args.hospitalDayNumber,
    p_note_date: args.noteDate,
  });
  if (error) return { data: null, error: new Error(error.message) };
  const row = unwrapRpcRow<Record<string, unknown>>(data);
  return { data: row, error: null };
}

/** Creates a progress note for `p_note_date` (ON CONFLICT returns existing row — caller refetches list). */
export async function rpcAddHospitalDay(
  supabase: SupabaseClient,
  args: { admissionId: string; noteDate: string },
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("add_hospital_day", {
    p_admission_id: args.admissionId,
    p_note_date: args.noteDate,
  });
  if (error) return { data: null, error: new Error(error.message) };
  const row = unwrapRpcRow<Record<string, unknown>>(data);
  return { data: row, error: null };
}

/** Sets surgery day on a note; refetch all notes so `day_label` updates admission-wide. */
export async function rpcMarkSurgeryDay(
  supabase: SupabaseClient,
  args: { noteId: string; surgeryDate: string },
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("mark_surgery_day", {
    p_note_id: args.noteId,
    p_surgery_date: args.surgeryDate,
  });
  if (error) return { data: null, error: new Error(error.message) };
  const row = unwrapRpcRow<Record<string, unknown>>(data);
  return { data: row, error: null };
}

function parseAdmissionIdFromRpcData(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === "string" && data.trim()) return data.trim();
  if (typeof data === "object" && data !== null) {
    const o = data as Record<string, unknown>;
    const id =
      o.admission_id ??
      o.p_admission_id ??
      o.id ??
      o.ipd_admission_id ??
      o.new_admission_id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export type FirstWardBed = {
  wardId: string;
  bedId: string;
  /** Human-readable e.g. "Ward 3A, Bed 12" */
  label: string;
};

function isAvailableBed(b: Record<string, unknown>): boolean {
  return str(b.status).toLowerCase() === "available";
}

/**
 * `get_bed_availability` returns a JSONB array of wards:
 * `{ ward_id, ward_name, beds: [{ id, bed_number, status, bed_type }, ...] }[]`
 * Picks the first ward that has at least one bed with `status === 'available'`,
 * then the first such bed. `p_bed_id` for admit is `bed.id`.
 */
export function parseFirstWardBedFromAvailability(data: unknown): FirstWardBed | null {
  const wards = Array.isArray(data) ? data : [];
  const wardList = wards.filter(
    (w): w is Record<string, unknown> => w != null && typeof w === "object",
  );

  const firstWard = wardList.find((w) => {
    const beds = w.beds;
    if (!Array.isArray(beds)) return false;
    return beds.some(
      (b) => b != null && typeof b === "object" && isAvailableBed(b as Record<string, unknown>),
    );
  });
  if (!firstWard) return null;

  const wardId = str(firstWard.ward_id);
  if (!wardId) return null;

  const beds = Array.isArray(firstWard.beds) ? firstWard.beds : [];
  const firstBed = beds.find(
    (b) => b != null && typeof b === "object" && isAvailableBed(b as Record<string, unknown>),
  ) as Record<string, unknown> | undefined;
  if (!firstBed) return null;

  const bedId = str(firstBed.id);
  if (!bedId) return null;

  const wName = str(firstWard.ward_name);
  const bNum = str(firstBed.bed_number);
  const label =
    wName && bNum
      ? `${wName}, Bed ${bNum}`
      : wName || (bNum ? `Bed ${bNum}` : `${wardId} / ${bedId}`);

  return { wardId, bedId, label };
}

export type AdmitPatientInput = {
  p_hospital_id: string;
  p_patient_id: string;
  /** OPD encounter being converted — matches `ipd_admissions.opd_encounter_id` / pre-admission `opd_encounter_id`. */
  p_opd_encounter_id: string;
  p_admitting_doctor_id: string;
  /** Optional — send null when unknown */
  p_admitting_department_id?: string | null;
  p_admission_type?: string;
  p_primary_diagnosis_icd10?: string | null;
  p_primary_diagnosis_display?: string | null;
  /** If omitted, first ward/bed with `status === 'available'` from `get_bed_availability` (dev / no picker yet). */
  p_ward_id?: string;
  p_bed_id?: string;
  /** Pre-admit assessment row created before consent + admission */
  p_pre_admission_assessment_id?: string | null;
};

/**
 * Calls `admit_patient` with the full parameter set expected by Supabase.
 * Resolves `p_ward_id` / `p_bed_id` from `get_bed_availability` when not provided.
 */
export async function rpcAdmitPatient(
  supabase: SupabaseClient,
  input: AdmitPatientInput,
): Promise<{ admissionId: string | null; error: Error | null }> {
  let wardId = str(input.p_ward_id);
  let bedId = str(input.p_bed_id);

  if (!wardId || !bedId) {
    const { data: bedData, error: bedErr } = await supabase.rpc("get_bed_availability", {
      p_hospital_id: input.p_hospital_id,
    });
    if (bedErr) {
      return { admissionId: null, error: new Error(`get_bed_availability: ${bedErr.message}`) };
    }
    const first = parseFirstWardBedFromAvailability(bedData);
    if (!first) {
      return {
        admissionId: null,
        error: new Error("No available bed."),
      };
    }
    wardId = first.wardId;
    bedId = first.bedId;
  }

  const params: Record<string, unknown> = {
    p_hospital_id: input.p_hospital_id,
    p_patient_id: input.p_patient_id,
    p_opd_encounter_id: input.p_opd_encounter_id,
    p_admitting_doctor_id: input.p_admitting_doctor_id,
    p_ward_id: wardId,
    p_bed_id: bedId,
    p_admission_type: input.p_admission_type ?? "elective",
    p_primary_diagnosis_icd10: input.p_primary_diagnosis_icd10 ?? null,
    p_primary_diagnosis_display: input.p_primary_diagnosis_display ?? null,
  };

  const dept = input.p_admitting_department_id;
  if (dept !== undefined) {
    params.p_admitting_department_id = dept;
  } else {
    params.p_admitting_department_id = null;
  }

  const preId = str(input.p_pre_admission_assessment_id);
  if (preId) params.p_pre_admission_assessment_id = preId;

  const { data, error } = await supabase.rpc("admit_patient", params);
  if (error) return { admissionId: null, error: new Error(error.message) };
  const id = parseAdmissionIdFromRpcData(data);
  if (id) return { admissionId: id, error: null };
  if (data != null) return { admissionId: String(data), error: null };
  return { admissionId: null, error: new Error("admit_patient returned no data") };
}

export async function rpcUpdateConsentStatus(
  supabase: SupabaseClient,
  args: {
    consentId: string;
    status: string;
    obtainedBy?: string | null;
    verificationMode?: string | null;
  },
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc("update_consent_status", {
    p_consent_id: args.consentId,
    p_status: args.status,
    p_obtained_by: args.obtainedBy ?? null,
    p_verification_mode: args.verificationMode ?? null,
  });
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function fetchIpdProgressNotes(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ rows: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("ipd_progress_notes")
    .select("*")
    .eq("admission_id", admissionId)
    .order("hospital_day_number", { ascending: true });
  if (error) return { rows: [], error: new Error(error.message) };
  return { rows: (data ?? []) as Record<string, unknown>[], error: null };
}

export async function fetchIpdTreatments(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ rows: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("ipd_treatments")
    .select("*")
    .eq("admission_id", admissionId)
    .order("treatment_date", { ascending: false });
  if (error) return { rows: [], error: new Error(error.message) };
  return { rows: (data ?? []) as Record<string, unknown>[], error: null };
}

export async function fetchIpdConsents(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ rows: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("ipd_admission_consents")
    .select("*")
    .eq("admission_id", admissionId)
    .order("sort_order", { ascending: true });
  if (error) {
    const { data: d2, error: e2 } = await supabase
      .from("ipd_admission_consents")
      .select("*")
      .eq("admission_id", admissionId);
    if (e2) return { rows: [], error: new Error(e2.message) };
    return { rows: (d2 ?? []) as Record<string, unknown>[], error: null };
  }
  return { rows: (data ?? []) as Record<string, unknown>[], error: null };
}

export async function fetchIpdVitalsForNote(
  supabase: SupabaseClient,
  progressNoteId: string,
): Promise<{ row: Record<string, unknown> | null; error: Error | null }> {
  const { data, error } = await supabase
    .from("ipd_vitals")
    .select("*")
    .eq("progress_note_id", progressNoteId)
    .maybeSingle();
  if (error) return { row: null, error: new Error(error.message) };
  return { row: (data ?? null) as Record<string, unknown> | null, error: null };
}

export async function updateProgressNoteSoap(
  supabase: SupabaseClient,
  noteId: string,
  patch: {
    subjective?: unknown;
    objective?: unknown;
    assessment_plan?: unknown;
  },
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from("ipd_progress_notes")
    .update({
      ...(patch.subjective !== undefined ? { subjective: patch.subjective } : {}),
      ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
      ...(patch.assessment_plan !== undefined ? { assessment_plan: patch.assessment_plan } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

/**
 * Row shape for `public.ipd_pre_admission_assessments` — keys must match
 * {@link IPD_PRE_ADMISSION_ASSESSMENT_COLUMNS} / live DB (no legacy `symptoms_opqrst`, `ros_json`, `vital_signs`).
 */
export type IpdPreAdmissionAssessment = Partial<Record<IpdPreAdmissionAssessmentColumn, unknown>>;

/** Alias for {@link IpdPreAdmissionAssessment}. */
export type IpdPreAdmissionAssessmentRow = IpdPreAdmissionAssessment;

/** Insert payload: required core FKs plus any optional confirmed columns. */
export type IpdPreAdmissionAssessmentInsert = IpdPreAdmissionAssessment & {
  hospital_id: string;
  opd_encounter_id: string;
  patient_id: string;
};

export type { IpdPreAdmissionAssessmentColumn } from "@/app/lib/ipdPreAdmissionAssessmentColumns";

/** Persist pre-admission assessment before consent + `admit_patient`. */
export async function insertIpdPreAdmissionAssessment(
  supabase: SupabaseClient,
  row: IpdPreAdmissionAssessmentInsert,
): Promise<{ id: string | null; error: Error | null }> {
  const cleaned = pickIpdPreAdmissionAssessmentColumns(row as Record<string, unknown>);
  const { data, error } = await supabase
    .from("ipd_pre_admission_assessments")
    .insert(cleaned)
    .select("id")
    .maybeSingle();
  if (error) return { id: null, error: new Error(error.message) };
  const id = data && typeof data === "object" && "id" in data ? str((data as { id: unknown }).id) : "";
  return { id: id || null, error: null };
}

export async function updateIpdPreAdmissionAssessment(
  supabase: SupabaseClient,
  assessmentId: string,
  patch: Partial<IpdPreAdmissionAssessmentInsert>,
): Promise<{ error: Error | null }> {
  const cleaned = pickIpdPreAdmissionAssessmentColumns({
    ...(patch as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  });
  const { error } = await supabase
    .from("ipd_pre_admission_assessments")
    .update(cleaned)
    .eq("id", assessmentId);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

/** Link assessment row on the admission after `admit_patient` (and/or RPC may also set this). */
export async function linkPreAdmissionAssessmentToAdmission(
  supabase: SupabaseClient,
  admissionId: string,
  preAdmissionAssessmentId: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from("ipd_admissions")
    .update({ pre_admission_assessment_id: preAdmissionAssessmentId })
    .eq("id", admissionId);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

/** JSON bundle from `compile_discharge_summary` RPC. */
export type CompileDischargeSummaryResult = Record<string, unknown>;

export async function rpcCompileDischargeSummary(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ data: CompileDischargeSummaryResult | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("compile_discharge_summary", {
    p_admission_id: admissionId,
  });
  if (error) return { data: null, error: new Error(error.message) };
  const row = unwrapRpcRow<CompileDischargeSummaryResult>(data);
  if (row && typeof row === "object" && "data" in row && (row as { data?: unknown }).data != null) {
    const inner = (row as { data: unknown }).data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return { data: inner as CompileDischargeSummaryResult, error: null };
    }
  }
  return { data: row, error: null };
}

export type UpsertDischargeSummaryPayload = {
  p_admission_id: string;
  p_status: "draft" | "finalized";
  p_discharge_condition: string | null;
  p_discharge_date: string | null;
  p_discharge_type: string | null;
  p_hospital_course_summary: string | null;
  p_discharge_medications: unknown;
  p_discharge_instructions: string | null;
  p_follow_up_date: string | null;
  p_diet_advice: string | null;
  p_activity_restrictions: string | null;
  p_wound_care_instructions: string | null;
  p_implant_details: unknown;
  p_post_op_protocol: string | null;
  p_physiotherapy_plan: string | null;
  p_final_diagnosis_icd10: string[] | null;
  p_final_diagnosis_display: string[] | null;
  p_procedures_done: unknown;
};

export async function rpcUpsertDischargeSummary(
  supabase: SupabaseClient,
  payload: UpsertDischargeSummaryPayload,
): Promise<{ data: unknown; error: Error | null }> {
  const { data, error } = await supabase.rpc("upsert_discharge_summary", payload as Record<string, unknown>);
  if (error) return { data: null, error: new Error(error.message) };
  return { data, error: null };
}
