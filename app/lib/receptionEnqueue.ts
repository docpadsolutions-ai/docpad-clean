import { supabase } from "../supabase";

export type EnqueueReceptionWalkInResult =
  | { ok: true; appointmentId: string; receptionQueueId: string; tokenDisplay: string; tokenNumber: number }
  | { ok: false; error: string };

/**
 * Walk-in: create `appointments` + `reception_queue` for the same OPD token.
 * If `reception_queue` insert fails, deletes the appointment row to avoid a dangling booking.
 */
export async function enqueueReceptionWalkIn(params: {
  hospitalId: string;
  patientId: string;
  doctorPractitionerId: string;
  queueDateYmd: string;
  tokenNumber: number;
}): Promise<EnqueueReceptionWalkInResult> {
  const hid = params.hospitalId.trim();
  const pid = params.patientId.trim();
  const docId = params.doctorPractitionerId.trim();
  const qd = params.queueDateYmd.trim();
  const tokenDisplay = `OPD-${String(params.tokenNumber).padStart(3, "0")}`;
  const nowIso = new Date().toISOString();

  if (!hid || !pid || !docId || !qd) {
    return { ok: false, error: "Missing hospital, patient, doctor, or date." };
  }

  const appointmentBase: Record<string, unknown> = {
    hospital_id: hid,
    patient_id: pid,
    doctor_id: docId,
    appointment_date: qd,
    status: "registered",
    token: tokenDisplay,
    updated_at: nowIso,
  };

  async function insertAppointment(payload: Record<string, unknown>) {
    return supabase.from("appointments").insert(payload).select("id").single();
  }

  let apptPayload: Record<string, unknown> = { ...appointmentBase, assigned_doctor_id: docId };
  let { data: appt, error: apptErr } = await insertAppointment(apptPayload);

  if (apptErr) {
    const m = apptErr.message.toLowerCase();
    if (m.includes("assigned_doctor") || m.includes("schema cache") || m.includes("column")) {
      apptPayload = { ...appointmentBase };
      ({ data: appt, error: apptErr } = await insertAppointment(apptPayload));
    }
  }

  if (apptErr) {
    const m = apptErr.message.toLowerCase();
    if (m.includes("updated_at") || m.includes("column")) {
      const { updated_at: _u, ...noUpdated } = apptPayload;
      ({ data: appt, error: apptErr } = await insertAppointment(noUpdated));
    }
  }

  if (apptErr || !appt?.id) {
    return { ok: false, error: apptErr?.message ?? "Appointment insert returned no id." };
  }

  const appointmentId = String(appt.id);

  const queueVariants: Record<string, unknown>[] = [
    {
      patient_id: pid,
      hospital_id: hid,
      token_number: params.tokenNumber,
      token_prefix: "OPD",
      assigned_doctor_id: docId,
      queue_date: qd,
      queue_status: "registered",
      registered_at: nowIso,
      updated_at: nowIso,
      appointment_id: appointmentId,
    },
    {
      patient_id: pid,
      hospital_id: hid,
      token_number: params.tokenNumber,
      token_prefix: "OPD",
      assigned_doctor_id: docId,
      queue_date: qd,
      queue_status: "registered",
      registered_at: nowIso,
      updated_at: nowIso,
    },
    {
      patient_id: pid,
      hospital_id: hid,
      token_number: params.tokenNumber,
      token_prefix: "OPD",
      doctor_id: docId,
      queue_date: qd,
      queue_status: "registered",
      registered_at: nowIso,
      updated_at: nowIso,
      appointment_id: appointmentId,
    },
    {
      patient_id: pid,
      hospital_id: hid,
      token_number: params.tokenNumber,
      token_prefix: "OPD",
      doctor_id: docId,
      queue_date: qd,
      queue_status: "registered",
      registered_at: nowIso,
      updated_at: nowIso,
    },
  ];

  let rq: { id?: string } | null = null;
  let rqErr: { message: string } | null = null;

  for (const payload of queueVariants) {
    const res = await supabase.from("reception_queue").insert(payload).select("id").single();
    if (!res.error && res.data?.id) {
      rq = res.data;
      rqErr = null;
      break;
    }
    rqErr = res.error ?? { message: "Unknown error" };
  }

  if (rqErr || !rq?.id) {
    await supabase.from("appointments").delete().eq("id", appointmentId);
    return { ok: false, error: rqErr?.message ?? "Could not insert reception queue row." };
  }

  return {
    ok: true,
    appointmentId,
    receptionQueueId: String(rq.id),
    tokenDisplay,
    tokenNumber: params.tokenNumber,
  };
}
