import { supabase } from "@/lib/supabase";

/**
 * Follow-up on an OPD encounter.
 *
 * A follow-up used to be a date written onto `opd_encounters.follow_up_date`
 * and nothing else: no booking existed, so the patient never appeared on the
 * doctor's day and nothing could remind them. Saving one now books a real
 * appointment (`schedule_follow_up`), which is idempotent per encounter -
 * changing the date moves the existing booking instead of stacking a new one.
 */

export type FollowUpBooking = {
  appointment_id: string;
  appointment_date: string;
  scheduled_time: string | null;
  status: string | null;
  visit_type: string | null;
  booking_source: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  /** Set once the patient actually came back and an encounter was opened. */
  fulfilled_by_encounter_id: string | null;
};

/** `plan_details.follow_up_date` is kept in step so existing readers stay correct. */
async function mergeFollowUpIntoPlan(eid: string, dateYmd: string | null): Promise<string | null> {
  const { data: row, error: selErr } = await supabase
    .from("opd_encounters")
    .select("plan_details")
    .eq("id", eid)
    .maybeSingle();
  if (selErr) return selErr.message;

  const prev =
    row?.plan_details != null && typeof row.plan_details === "object" && !Array.isArray(row.plan_details)
      ? { ...(row.plan_details as Record<string, unknown>) }
      : {};

  const { error: upErr } = await supabase
    .from("opd_encounters")
    .update({
      follow_up_date: dateYmd,
      plan_details: { ...prev, follow_up_date: dateYmd },
      updated_at: new Date().toISOString(),
    })
    .eq("id", eid);

  return upErr?.message ?? null;
}

/**
 * Books, moves or cancels the follow-up appointment only. Use this where the
 * encounter row (and its `follow_up_date`) has already been written by the
 * caller's own save; `saveEncounterFollowUp` does both.
 */
export async function bookEncounterFollowUp(
  eid: string,
  dateYmd: string | null | undefined,
  opts?: { time?: string | null; doctorId?: string | null; notes?: string | null },
): Promise<string | null> {
  const trimmed = dateYmd?.trim() || null;

  if (!trimmed) {
    const { error } = await supabase.rpc("cancel_follow_up", { p_encounter_id: eid });
    return error?.message ?? null;
  }

  const { error } = await supabase.rpc("schedule_follow_up", {
    p_encounter_id: eid,
    p_date: trimmed,
    p_time: opts?.time?.trim() || null,
    p_doctor_id: opts?.doctorId ?? null,
    p_notes: opts?.notes?.trim() || null,
  });
  return error?.message ?? null;
}

/**
 * Saves the follow-up for an encounter and books (or moves, or cancels) the
 * matching appointment. Returns an error message, or null on success.
 *
 * A booking failure is reported but does not undo the date on the encounter:
 * the clinical note is the record, the appointment is the convenience.
 */
export async function saveEncounterFollowUp(
  eid: string,
  dateYmd: string | null | undefined,
  opts?: { time?: string | null; doctorId?: string | null; notes?: string | null },
): Promise<string | null> {
  const trimmed = dateYmd?.trim() || null;

  const planErr = await mergeFollowUpIntoPlan(eid, trimmed);
  if (planErr) return planErr;

  if (!trimmed) {
    const { error } = await supabase.rpc("cancel_follow_up", { p_encounter_id: eid });
    return error?.message ?? null;
  }

  const { error } = await supabase.rpc("schedule_follow_up", {
    p_encounter_id: eid,
    p_date: trimmed,
    p_time: opts?.time?.trim() || null,
    p_doctor_id: opts?.doctorId ?? null,
    p_notes: opts?.notes?.trim() || null,
  });

  if (error) {
    // The date is saved; only the booking failed. Say which, so the user can retry.
    return `Follow-up date saved, but the appointment could not be booked: ${error.message}`;
  }
  return null;
}

/** The live follow-up booking for an encounter, or null if none is scheduled. */
export async function getFollowUpForEncounter(eid: string): Promise<FollowUpBooking | null> {
  const { data, error } = await supabase.rpc("get_follow_up_for_encounter", { p_encounter_id: eid });
  if (error || !data) return null;
  return data as FollowUpBooking;
}
