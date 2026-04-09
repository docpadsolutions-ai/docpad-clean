import { supabase } from "../supabase";
import { OPD_ENCOUNTERS_AUTH_USER_COLUMN } from "./tenantSchema";

/**
 * Silent chart creation from a waiting `appointments` row (triage / queue handoff).
 * Returns new `opd_encounters.id`, or `null` on failure.
 */
export async function createEncounterFromAppointment(
  patientId: string,
  appointmentId: string,
  orgId?: string | null,
): Promise<string | null> {
  const org = orgId?.trim() || "";
  if (!org) {
    console.error("createEncounterFromAppointment: missing hospital_id (required for RLS)");
    return null;
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const uid = authData.user?.id?.trim() ?? "";
  if (!uid) {
    console.error("createEncounterFromAppointment: no authenticated user", authErr?.message);
    return null;
  }

  const encounterDate = new Date().toISOString().split("T")[0];

  const { count } = await supabase
    .from("opd_encounters")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", org)
    .eq("encounter_date", encounterDate);
  const token = `#${String((count ?? 0) + 1).padStart(2, "0")}`;

  const payload: Record<string, unknown> = {
    patient_id: patientId,
    appointment_id: appointmentId,
    encounter_number: `OPD-${Date.now()}`,
    status: "in_progress",
    token,
    encounter_date: encounterDate,
    hospital_id: org,
    [OPD_ENCOUNTERS_AUTH_USER_COLUMN]: uid,
  };

  try {
    const { data, error } = await supabase.from("opd_encounters").insert(payload).select("id").single();

    if (error) {
      console.error("Silent Create Failed:", error);
      return null;
    }

    const newId = data?.id != null ? String(data.id) : null;
    return newId;
  } catch (e) {
    console.error("Silent Create Failed:", e);
    return null;
  }
}

/**
 * Creates an in-progress encounter from reception “with doctor” handoff; optionally marks the queue row completed.
 */
export async function startInProgressEncounterFromReceptionHandoff(
  patientId: string,
  orgId?: string | null,
  opts?: { receptionQueueId?: string | null },
): Promise<string | null> {
  const org = orgId?.trim() ?? "";
  if (!org) {
    console.error("startInProgressEncounterFromReceptionHandoff: missing hospital_id");
    return null;
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const uid = authData.user?.id?.trim() ?? "";
  if (!uid) {
    console.error("startInProgressEncounterFromReceptionHandoff: no authenticated user", authErr?.message);
    return null;
  }

  const encounterDate = new Date().toISOString().split("T")[0];

  const { count } = await supabase
    .from("opd_encounters")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", org)
    .eq("encounter_date", encounterDate);
  const token = `#${String((count ?? 0) + 1).padStart(2, "0")}`;

  const payload: Record<string, unknown> = {
    patient_id: patientId.trim(),
    encounter_number: `OPD-${Date.now()}`,
    status: "in_progress",
    token,
    encounter_date: encounterDate,
    hospital_id: org,
    [OPD_ENCOUNTERS_AUTH_USER_COLUMN]: uid,
  };

  try {
    const { data, error } = await supabase.from("opd_encounters").insert(payload).select("id").single();

    if (error) {
      console.error("startInProgressEncounterFromReceptionHandoff insert failed:", error);
      return null;
    }

    const newId = data?.id != null ? String(data.id) : null;
    const rqId = opts?.receptionQueueId?.trim();
    if (newId && rqId) {
      const { error: upErr } = await supabase
        .from("reception_queue")
        .update({
          queue_status: "completed",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", rqId);
      if (upErr) {
        console.warn("startInProgressEncounterFromReceptionHandoff: queue update failed", upErr.message);
      }
    }
    return newId;
  } catch (e) {
    console.error("startInProgressEncounterFromReceptionHandoff:", e);
    return null;
  }
}
