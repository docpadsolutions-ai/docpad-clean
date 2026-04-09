import { supabase } from "../supabase";

export type PatientQueueVitals = {
  blood_pressure?: string | null;
  pulse?: string | null;
  weight?: string | null;
  temperature?: string | null;
  spo2?: string | null;
};

/** @deprecated Legacy triage `appointments` queue — see `WaitingPatientRow` for Command Center. */
export type LegacyWaitingAppointmentRow = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  ageGender: string;
  vitals: PatientQueueVitals;
  chiefComplaint?: string;
  timeLabel: string;
};

/** Merged waiting room: reception handoff + scheduled OPD encounters for today. */
export type WaitingPatientRow = {
  rowKey: string;
  source: "reception" | "opd_direct";
  patientId: string;
  patientName: string;
  docpadId?: string | null;
  ageGender: string;
  vitals: PatientQueueVitals;
  chiefComplaint?: string;
  /** Token / queue # shown in first column */
  primaryDisplay: string;
  receptionQueueId?: string | null;
  scheduledEncounterId?: string | null;
};

export type ActiveEncounterRow = {
  encounterId: string;
  encounterToken: string | null;
  patientName: string;
  ageGender: string;
  vitals: PatientQueueVitals;
  chiefComplaint?: string;
  status: "draft" | "in_progress";
};

type PatientShape = {
  full_name: string | null;
  age_years?: number | null;
  sex?: string | null;
  docpad_id?: string | null;
  /** Some schemas use `age` / `gender` instead of `age_years` / `sex`. */
  age?: number | null;
  gender?: string | null;
};

function pickPatient(p: PatientShape | PatientShape[] | null | undefined): PatientShape | null {
  if (!p) return null;
  return Array.isArray(p) ? p[0] ?? null : p;
}

function ageGenderLine(patient: PatientShape | null): string {
  if (!patient) return "—";
  const age = patient.age_years ?? patient.age;
  const sexOrGender = patient.sex?.trim() || patient.gender?.trim();
  if (age != null && sexOrGender) return `${age}Y, ${sexOrGender}`;
  if (age != null) return `${age}Y`;
  if (sexOrGender) return sexOrGender;
  return "—";
}

function parseTimeShort(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function vitalsFromJson(v: unknown): PatientQueueVitals {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  return {
    blood_pressure: o.blood_pressure != null ? String(o.blood_pressure) : null,
    pulse: o.pulse != null ? String(o.pulse) : null,
    weight: o.weight != null ? String(o.weight) : null,
    temperature: o.temperature != null ? String(o.temperature) : null,
    spo2: o.spo2 != null ? String(o.spo2) : null,
  };
}

export function vitalsFromEncounterColumns(enc: Record<string, unknown>): PatientQueueVitals {
  return {
    blood_pressure: enc.blood_pressure != null ? String(enc.blood_pressure) : null,
    pulse: enc.pulse != null ? String(enc.pulse) : null,
    weight: enc.weight != null ? String(enc.weight) : null,
    temperature: enc.temperature != null ? String(enc.temperature) : null,
    spo2: enc.spo2 != null ? String(enc.spo2) : null,
  };
}

export function mergeVitals(
  primary: PatientQueueVitals,
  fallback: PatientQueueVitals,
): PatientQueueVitals {
  const keys = ["blood_pressure", "pulse", "weight", "temperature", "spo2"] as const;
  const out: PatientQueueVitals = {};
  for (const k of keys) {
    const a = primary[k]?.toString().trim();
    const b = fallback[k]?.toString().trim();
    out[k] = a || b || null;
  }
  return out;
}

export function chiefComplaintFromEncounter(enc: Record<string, unknown>): string | undefined {
  const fhir = enc.chief_complaints_fhir;
  if (Array.isArray(fhir) && fhir.length > 0) {
    const parts = fhir
      .map((x: { display?: string }) => (x?.display ? String(x.display).trim() : ""))
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  const legacy = enc.chief_complaint;
  if (legacy != null && String(legacy).trim()) return String(legacy).trim();
  return undefined;
}

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTokenDisplay(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const t = String(raw).trim();
  return t.startsWith("#") ? t : `#${t}`;
}

function vitalsFromReceptionQueue(rq: Record<string, unknown>): PatientQueueVitals {
  return {
    blood_pressure: rq.triage_bp != null ? String(rq.triage_bp) : null,
    pulse: rq.triage_pulse != null ? String(rq.triage_pulse) : null,
    weight: rq.triage_weight != null ? String(rq.triage_weight) : null,
    temperature: rq.triage_temp != null ? String(rq.triage_temp) : null,
    spo2: rq.triage_spo2 != null ? String(rq.triage_spo2) : null,
  };
}

/** `token_prefix` (default OPD) + zero-padded `token_number`, e.g. `OPD-002`. */
function receptionPrimaryToken(row: Record<string, unknown>): string {
  const prefix = String(row.token_prefix ?? "OPD").trim() || "OPD";
  const tn = row.token_number;
  const n =
    typeof tn === "number" && Number.isFinite(tn)
      ? Math.trunc(tn)
      : tn != null && String(tn).trim() !== ""
        ? Math.trunc(Number(tn))
        : 0;
  const v = Number.isFinite(n) ? n : 0;
  return `${prefix}-${String(v).padStart(3, "0")}`;
}

export type WaitingRoomFetchContext = {
  authUserId: string;
  practitionerId: string | null;
};

/**
 * Reception queue for this doctor today (registered → with_doctor) + scheduled `opd_encounters`.
 * Deduplicates by `patient_id` (reception row wins over direct OPD when both exist).
 */
export async function fetchMergedWaitingRoom(
  orgId: string | null,
  ctx: WaitingRoomFetchContext,
): Promise<WaitingPatientRow[]> {
  const id = orgId?.trim() || "";
  if (!id || !ctx.authUserId?.trim()) return [];

  const queueDate = localDateYmd();
  const authUid = ctx.authUserId.trim();
  const practitionerId = ctx.practitionerId?.trim() || null;

  const receptionSelect = `
    id,
    patient_id,
    token_prefix,
    token_number,
    triage_bp,
    triage_pulse,
    triage_temp,
    triage_spo2,
    triage_weight,
    registered_at,
    patients ( full_name, age_years, sex, docpad_id )
  `;

  type RqRow = Record<string, unknown>;
  let receptionData: RqRow[] = [];

  if (practitionerId) {
    let rq = supabase
      .from("reception_queue")
      .select(receptionSelect)
      .eq("hospital_id", id)
      .in("queue_status", ["registered", "triaged", "waiting", "with_doctor"])
      .eq("queue_date", queueDate)
      .eq("assigned_doctor_id", practitionerId)
      .order("token_number", { ascending: true, nullsFirst: false });

    let { data, error } = await rq;
    if (
      error &&
      (error.code === "42703" ||
        error.message.toLowerCase().includes("assigned_doctor") ||
        error.message.toLowerCase().includes("queue_date"))
    ) {
      ({ data, error } = await supabase
        .from("reception_queue")
        .select(receptionSelect)
        .eq("hospital_id", id)
        .in("queue_status", ["registered", "triaged", "waiting", "with_doctor"])
        .eq("doctor_id", practitionerId)
        .order("created_at", { ascending: true }));
    }
    if (error) throw new Error(error.message);
    receptionData = (data ?? []) as RqRow[];
  }

  const opdSelect = `
    id,
    token,
    patient_id,
    chief_complaint,
    chief_complaints_fhir,
    blood_pressure,
    pulse,
    weight,
    temperature,
    spo2,
    created_at,
    patients ( full_name, age_years, sex, docpad_id )
  `;

  const { data: encData, error: encErr } = await supabase
    .from("opd_encounters")
    .select(opdSelect)
    .eq("hospital_id", id)
    .eq("status", "scheduled")
    .eq("encounter_date", queueDate)
    .eq("doctor_id", authUid)
    .order("created_at", { ascending: true });

  if (encErr) throw new Error(encErr.message);

  const receptionRows: WaitingPatientRow[] = [];
  for (const raw of receptionData) {
    const rqId = raw.id != null ? String(raw.id) : "";
    const patientId = raw.patient_id != null ? String(raw.patient_id) : "";
    if (!rqId || !patientId) continue;
    const patient = pickPatient(raw.patients as PatientShape | PatientShape[] | null);
    const name = patient?.full_name?.trim() || "Unknown patient";
    const docpad =
      patient && "docpad_id" in patient && patient.docpad_id != null
        ? String(patient.docpad_id).trim() || null
        : null;
    receptionRows.push({
      rowKey: `reception:${rqId}`,
      source: "reception",
      patientId,
      patientName: name,
      docpadId: docpad,
      ageGender: ageGenderLine(patient),
      vitals: vitalsFromReceptionQueue(raw),
      chiefComplaint: undefined,
      primaryDisplay: receptionPrimaryToken(raw),
      receptionQueueId: rqId,
      scheduledEncounterId: null,
    });
  }

  const opdRows: WaitingPatientRow[] = [];
  for (const raw of encData ?? []) {
    const enc = raw as Record<string, unknown>;
    const encId = enc.id != null ? String(enc.id) : "";
    const patientId = enc.patient_id != null ? String(enc.patient_id) : "";
    if (!encId || !patientId) continue;
    const patient = pickPatient(enc.patients as PatientShape | PatientShape[] | null);
    const name = patient?.full_name?.trim() || "Unknown patient";
    const docpad =
      patient && "docpad_id" in patient && patient.docpad_id != null
        ? String(patient.docpad_id).trim() || null
        : null;
    const rawTok = enc.token;
    const tok =
      rawTok != null && String(rawTok).trim() !== "" ? formatTokenDisplay(String(rawTok).trim()) : "—";
    const cc = chiefComplaintFromEncounter(enc);
    opdRows.push({
      rowKey: `opd:${encId}`,
      source: "opd_direct",
      patientId,
      patientName: name,
      docpadId: docpad,
      ageGender: ageGenderLine(patient),
      vitals: vitalsFromEncounterColumns(enc),
      chiefComplaint: cc,
      primaryDisplay: tok,
      receptionQueueId: null,
      scheduledEncounterId: encId,
    });
  }

  const seen = new Set<string>();
  const merged: WaitingPatientRow[] = [];
  for (const r of receptionRows) {
    if (seen.has(r.patientId)) continue;
    seen.add(r.patientId);
    merged.push(r);
  }
  for (const r of opdRows) {
    if (seen.has(r.patientId)) continue;
    seen.add(r.patientId);
    merged.push(r);
  }

  return merged;
}

/** `appointments.status = waiting` with no `opd_encounters` row for that `appointment_id`. */
export async function fetchWaitingAppointmentsWithoutEncounter(
  orgId: string | null,
): Promise<LegacyWaitingAppointmentRow[]> {
  const id = orgId?.trim() || "";
  if (!id) return [];

  const q = supabase
    .from("appointments")
    .select(
      `
      *,
      patients ( full_name, age_years, sex )
    `,
    )
    .in("status", ["waiting", "registered"])
    .eq("hospital_id", id)
    .order("created_at", { ascending: true });

  const { data: appts, error } = await q;
  if (error) throw new Error(error.message);

  const list = (appts ?? []) as Record<string, unknown>[];
  const apptIds = list.map((a) => a.id).filter((id) => id != null).map(String);

  const linked = new Set<string>();
  if (apptIds.length > 0) {
    const { data: encs, error: e2 } = await supabase
      .from("opd_encounters")
      .select("appointment_id")
      .eq("hospital_id", id)
      .in("appointment_id", apptIds);
    if (e2) throw new Error(e2.message);
    for (const row of encs ?? []) {
      const aid = (row as { appointment_id?: string }).appointment_id;
      if (aid) linked.add(String(aid));
    }
  }

  const rows: LegacyWaitingAppointmentRow[] = [];
  for (const a of list) {
    const appointmentId = a.id != null ? String(a.id) : "";
    const patientId = a.patient_id != null ? String(a.patient_id) : "";
    if (!appointmentId || !patientId) continue;
    if (linked.has(appointmentId)) continue;

    const patient = pickPatient(a.patients as PatientShape | PatientShape[] | null);
    const name =
      patient?.full_name != null && String(patient.full_name).trim() !== ""
        ? String(patient.full_name).trim()
        : "Unknown patient";
    const timeLabel =
      parseTimeShort(a.start_time as string) !== "—"
        ? parseTimeShort(a.start_time as string)
        : parseTimeShort(a.created_at as string);

    rows.push({
      appointmentId,
      patientId,
      patientName: name,
      ageGender: ageGenderLine(patient),
      vitals: vitalsFromJson(a.vitals),
      timeLabel,
    });
  }

  return rows;
}

/** `opd_encounters` in draft or in progress with patient + optional appointment vitals. */
export async function fetchActiveDraftEncounters(
  orgId: string | null,
): Promise<ActiveEncounterRow[]> {
  const id = orgId?.trim() || "";
  if (!id) return [];

  const q = supabase
    .from("opd_encounters")
    .select(
      `
      id,
      token,
      status,
      weight,
      blood_pressure,
      pulse,
      temperature,
      spo2,
      chief_complaint,
      chief_complaints_fhir,
      patients ( full_name, age_years, sex ),
      appointments ( vitals )
    `,
    )
    .eq("hospital_id", id)
    .in("status", ["draft", "in_progress"])
    .order("created_at", { ascending: false });

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const out: ActiveEncounterRow[] = [];
  for (const raw of data ?? []) {
    const enc = raw as Record<string, unknown>;
    const st = String(enc.status ?? "").toLowerCase().replace(/-/g, "_");
    const status: "draft" | "in_progress" =
      st === "draft" ? "draft" : "in_progress";

    const patient = pickPatient(enc.patients as PatientShape | PatientShape[] | null);
    const name = patient?.full_name?.trim() || "Unknown patient";

    const ap = enc.appointments;
    let apptVitals: unknown = null;
    if (ap && typeof ap === "object" && !Array.isArray(ap)) {
      apptVitals = (ap as { vitals?: unknown }).vitals;
    } else if (Array.isArray(ap) && ap[0] && typeof ap[0] === "object") {
      apptVitals = (ap[0] as { vitals?: unknown }).vitals;
    }

    const fromEnc = vitalsFromEncounterColumns(enc);
    const fromAppt = vitalsFromJson(apptVitals);
    const vitals = mergeVitals(fromEnc, fromAppt);

    const cc = chiefComplaintFromEncounter(enc);

    const rawTok = enc.token;
    const encounterToken =
      rawTok != null && String(rawTok).trim() !== "" ? String(rawTok).trim() : null;

    out.push({
      encounterId: String(enc.id),
      encounterToken,
      patientName: name,
      ageGender: ageGenderLine(patient),
      vitals,
      chiefComplaint: cc,
      status,
    });
  }

  return out;
}
