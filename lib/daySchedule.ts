import { supabase } from "@/lib/supabase";
import type { VisitType } from "@/lib/appointments";

/**
 * The doctor's day: patients who are here (reception queue) and patients who
 * are booked but have not arrived. Both come from one server-side view so the
 * two halves cannot drift apart.
 */
export type DayScheduleRow = {
  source: "queue" | "appointment";
  queue_id: string | null;
  appointment_id: string | null;
  encounter_id: string | null;
  patient_id: string;
  patient_name: string | null;
  token_number: number | null;
  token_display: string | null;
  scheduled_time: string | null;
  visit_type: VisitType | null;
  status: string | null;
  arrived: boolean;
};

export type CheckInResult = {
  success: boolean;
  already_checked_in: boolean;
  queue_id: string;
  token_number: number;
  token_display: string;
  visit_type?: string | null;
  booking_source?: string | null;
};

export async function fetchDoctorDaySchedule(
  doctorPractitionerId?: string | null,
  dateYmd?: string | null,
): Promise<{ rows: DayScheduleRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("get_doctor_day_schedule", {
    p_doctor_id: doctorPractitionerId?.trim() || null,
    p_date: dateYmd?.trim() || null,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: Array.isArray(data) ? (data as DayScheduleRow[]) : [], error: null };
}

/**
 * Turns a booking into a waiting-room entry. The token is allocated inside the
 * database under a per-hospital-per-day lock, so two desks checking patients in
 * at the same moment cannot hand out the same number. Calling it twice for one
 * appointment returns the existing token rather than creating a second row.
 */
export async function checkInAppointment(
  appointmentId: string,
  opts?: { doctorId?: string | null; room?: string | null },
): Promise<{ result: CheckInResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc("check_in_appointment", {
    p_appointment_id: appointmentId,
    p_doctor_id: opts?.doctorId ?? null,
    p_room: opts?.room?.trim() || null,
  });
  if (error) return { result: null, error: error.message };
  return { result: (data as CheckInResult) ?? null, error: null };
}

/** Today's live bookings for a patient — what reception checks before opening a walk-in. */
export type PatientAppointment = {
  appointment_id: string;
  appointment_date: string;
  scheduled_time: string | null;
  status: string | null;
  visit_type: string | null;
  booking_source: string | null;
  chief_complaint: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  parent_encounter_id: string | null;
  already_checked_in: boolean;
};

export async function findAppointmentForPatient(
  patientId: string,
  dateYmd?: string | null,
): Promise<PatientAppointment[]> {
  const { data, error } = await supabase.rpc("find_appointment_for_patient", {
    p_patient_id: patientId,
    p_date: dateYmd?.trim() || null,
  });
  if (error || !Array.isArray(data)) return [];
  return data as PatientAppointment[];
}
