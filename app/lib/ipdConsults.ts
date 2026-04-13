import type { SupabaseClient } from "@supabase/supabase-js";

/** Normalize RPC return to a plain array (or empty). */
export function unwrapRpcArray<T = Record<string, unknown>>(data: unknown): T[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data === "object" && data !== null && "data" in data) {
    const inner = (data as { data: unknown }).data;
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

export type RequestConsultRpcArgs = {
  p_admission_id: string;
  p_patient_id: string;
  p_consulting_doctor_id: string | null;
  p_consulting_department_id: string | null;
  p_consulting_specialty: string | null;
  p_reason_for_consult: string;
  p_urgency: string;
  p_progress_note_id: string | null;
};

export async function rpcRequestConsult(
  supabase: SupabaseClient,
  args: RequestConsultRpcArgs,
): Promise<{ data: unknown | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("request_consult", args as Record<string, unknown>);
  if (error) return { data: null, error: new Error(error.message) };
  return { data: data ?? null, error: null };
}

export async function rpcGetAdmissionConsults(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ data: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_admission_consults", { p_admission_id: admissionId });
  if (error) return { data: [], error: new Error(error.message) };
  return { data: unwrapRpcArray(data), error: null };
}

export async function rpcGetMyPendingConsults(
  supabase: SupabaseClient,
): Promise<{ data: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_my_pending_consults");
  if (error) return { data: [], error: new Error(error.message) };
  return { data: unwrapRpcArray(data), error: null };
}

export async function rpcRespondToConsult(
  supabase: SupabaseClient,
  args: { p_consult_id: string; p_status: string; p_consult_notes?: string | null },
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc("respond_to_consult", {
    p_consult_id: args.p_consult_id,
    p_status: args.p_status,
    p_consult_notes: args.p_consult_notes ?? null,
  });
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function rpcGetDoctorsByDepartment(
  supabase: SupabaseClient,
  departmentId: string,
): Promise<{ data: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_doctors_by_department", {
    p_department_id: departmentId,
  });
  if (error) return { data: [], error: new Error(error.message) };
  return { data: unwrapRpcArray(data), error: null };
}

export type NotificationRow = {
  id?: string;
  notification_id?: string;
  title?: string;
  body?: string;
  message?: string;
  created_at?: string;
  read_at?: string | null;
  is_read?: boolean;
  type?: string;
  notification_type?: string;
  action_url?: string | null;
};

export async function rpcGetMyNotifications(
  supabase: SupabaseClient,
  limit: number,
): Promise<{ data: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_my_notifications", { p_limit: limit });
  if (error) return { data: [], error: new Error(error.message) };
  return { data: unwrapRpcArray(data), error: null };
}

export async function rpcMarkNotificationRead(
  supabase: SupabaseClient,
  notificationId: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: notificationId });
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

/** Short relative time e.g. "2h ago", "3d ago". */
export function formatRequestedAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return "—";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
