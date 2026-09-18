import { supabase } from "@/lib/supabase";

/**
 * Booking a patient in for a future date.
 *
 * Distinct from `lib/followUp.ts`, which books the "come back in six weeks"
 * appointment from inside an open encounter. That one knows the encounter and
 * inherits the doctor and the complaint from it. This one is the front desk
 * taking a phone call, where the only thing known is who is calling and when
 * they want to be seen.
 *
 * Both write to `appointments` with a non-walk-in `booking_source`, so a booking
 * made here is picked up unchanged by the doctor's day schedule, the
 * Expected-today panel and the WhatsApp reminder job.
 */

export const VISIT_TYPES = ["new", "follow_up", "review", "procedure"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  new: "New visit",
  follow_up: "Follow-up",
  review: "Review",
  procedure: "Procedure",
};

export type UpcomingAppointment = {
  appointment_id: string;
  appointment_date: string;
  scheduled_time: string | null;
  status: string | null;
  visit_type: VisitType | null;
  booking_source: string | null;
  chief_complaint: string | null;
  patient_id: string;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  parent_encounter_id: string | null;
  already_checked_in: boolean;
  reminder_sent: boolean;
};

export type BookResult = {
  success: true;
  created: boolean;
  appointment_id: string;
  appointment_date: string;
  scheduled_time: string | null;
  visit_type: VisitType;
  doctor_id: string | null;
};

/**
 * `created: false` means the patient already had a live booking that day and it
 * was updated rather than duplicated. Worth telling the person at the desk, since
 * they were probably expecting a second slot.
 */
export async function bookAppointment(params: {
  patientId: string;
  dateYmd: string;
  time?: string | null;
  doctorId?: string | null;
  visitType?: VisitType;
  notes?: string | null;
}): Promise<{ result: BookResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc("book_appointment", {
    p_patient_id: params.patientId,
    p_date: params.dateYmd,
    p_time: params.time?.trim() || null,
    p_doctor_id: params.doctorId?.trim() || null,
    p_visit_type: params.visitType ?? "new",
    p_notes: params.notes?.trim() || null,
  });
  if (error) return { result: null, error: error.message };
  return { result: (data as BookResult) ?? null, error: null };
}

export async function rescheduleAppointment(params: {
  appointmentId: string;
  dateYmd: string;
  time?: string | null;
  doctorId?: string | null;
}): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: params.appointmentId,
    p_date: params.dateYmd,
    p_time: params.time?.trim() || null,
    p_doctor_id: params.doctorId?.trim() || null,
  });
  return { ok: !error, error: error?.message ?? null };
}

/**
 * `noShow` separates "the patient rang to say they are not coming" from "the
 * patient did not turn up". Same row, very different fact.
 */
export async function cancelAppointment(params: {
  appointmentId: string;
  reason?: string | null;
  noShow?: boolean;
}): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc("cancel_appointment", {
    p_appointment_id: params.appointmentId,
    p_reason: params.reason?.trim() || null,
    p_no_show: params.noShow ?? false,
  });
  return { ok: !error, error: error?.message ?? null };
}

export async function fetchUpcomingAppointments(params?: {
  fromYmd?: string | null;
  days?: number;
  doctorId?: string | null;
}): Promise<{ rows: UpcomingAppointment[]; error: string | null }> {
  const { data, error } = await supabase.rpc("upcoming_appointments", {
    p_from: params?.fromYmd?.trim() || null,
    p_days: params?.days ?? 14,
    p_doctor_id: params?.doctorId?.trim() || null,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: Array.isArray(data) ? (data as UpcomingAppointment[]) : [], error: null };
}

/** Local calendar date, not UTC: a booking made at 9pm IST is for today, not tomorrow. */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatApptDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function formatApptTime(hms: string | null): string {
  if (!hms) return "no time set";
  return hms.slice(0, 5);
}
