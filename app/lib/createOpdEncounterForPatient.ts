import { supabase } from "../supabase";
import { OPD_ENCOUNTERS_AUTH_USER_COLUMN } from "./tenantSchema";

export type CreateOpdEncounterResult =
  | { ok: true; encounterId: string }
  | { ok: false; error: string };

/**
 * Inserts a new `opd_encounters` row for an existing patient (walk-in / summary quick action).
 * Mirrors `/dashboard/opd/new` Step 3 logic.
 */
export async function createOpdEncounterForPatient(
  patientId: string,
  orgId: string,
  authUserId: string,
  appointmentId?: string | null,
): Promise<CreateOpdEncounterResult> {
  const pid = patientId.trim();
  const org = orgId.trim();
  const uid = authUserId.trim();
  if (!pid) return { ok: false, error: "Patient ID is missing." };
  if (!org) return { ok: false, error: "Organization context is missing." };
  if (!uid) return { ok: false, error: "You must be signed in to start an encounter." };

  const year = new Date().getFullYear();
  const rand = Math.floor(10000 + Math.random() * 90000);
  const encounterNumber = `OPD-${year}-${rand}`;
  const encounterDate = new Date().toISOString().split("T")[0];

  let nextTokenNumber = 1;
  const { count } = await supabase
    .from("opd_encounters")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", org)
    .eq("encounter_date", encounterDate);
  if (count != null) nextTokenNumber = count + 1;
  const nextToken = `#${String(nextTokenNumber).padStart(2, "0")}`;

  const baseInsert = {
    patient_id: pid,
    hospital_id: org,
    [OPD_ENCOUNTERS_AUTH_USER_COLUMN]: uid,
    status: "scheduled" as const,
    token: nextToken,
    encounter_number: encounterNumber,
    encounter_date: encounterDate,
  };
  const insertPayload =
    appointmentId != null && String(appointmentId).trim() !== ""
      ? { ...baseInsert, appointment_id: String(appointmentId).trim() }
      : baseInsert;

  const { data: inserted, error } = await supabase.from("opd_encounters").insert(insertPayload).select("id").single();

  if (error) return { ok: false, error: error.message };
  const id = inserted?.id != null ? String(inserted.id) : "";
  if (!id) return { ok: false, error: "Encounter was created but no id was returned." };
  return { ok: true, encounterId: id };
}
