import { supabase } from "@/lib/supabase";
import { isSupabaseAbortError, sx } from "@/lib/supabaseAbort";

export type OpdDashboardStats = {
  scheduledToday: number;
  active: number;
  completed: number;
  noShow: number;
};

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function countOpdEncounters(
  orgId: string,
  today: string,
  filter: { status: string } | { statuses: string[] },
  signal?: AbortSignal,
): Promise<number> {
  let q = supabase
    .from("opd_encounters")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", orgId)
    .eq("encounter_date", today);
  if ("status" in filter) {
    q = q.eq("status", filter.status);
  } else {
    q = q.in("status", filter.statuses);
  }
  const { count, error } = await sx(q, signal);
  if (error) {
    if (isSupabaseAbortError(error)) return 0;
    return 0;
  }
  return count ?? 0;
}

async function countReceptionNoShowToday(orgId: string, today: string, signal?: AbortSignal): Promise<number> {
  const { count, error } = await sx(
    supabase
      .from("reception_queue")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", orgId)
      .eq("queue_date", today)
      .eq("queue_status", "no_show"),
    signal,
  );
  if (error) {
    if (isSupabaseAbortError(error)) return 0;
    return 0;
  }
  return count ?? 0;
}

/**
 * Reception pipeline today (nursing): registered / triaged / waiting — not yet with doctor.
 */
async function countReceptionPreDoctorToday(orgId: string, today: string, signal?: AbortSignal): Promise<number> {
  const { count, error } = await sx(
    supabase
      .from("reception_queue")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", orgId)
      .eq("queue_date", today)
      .in("queue_status", ["registered", "triaged", "waiting"]),
    signal,
  );
  if (error) {
    if (isSupabaseAbortError(error)) return 0;
    return 0;
  }
  return count ?? 0;
}

/**
 * OPD dashboard KPIs for the signed-in user's hospital (`auth_org`).
 * Any failed count query returns 0 for that metric so the UI never shows stale mocks.
 */
export async function fetchOpdDashboardStats(orgId: string | null, signal?: AbortSignal): Promise<OpdDashboardStats> {
  const id = orgId?.trim() ?? "";
  if (!id) {
    return { scheduledToday: 0, active: 0, completed: 0, noShow: 0 };
  }

  const today = localDateYmd();

  const [encScheduled, receptionPipeline, active, completed, noShow] = await Promise.all([
    countOpdEncounters(id, today, { status: "scheduled" }, signal),
    countReceptionPreDoctorToday(id, today, signal),
    countOpdEncounters(id, today, { statuses: ["in_progress", "draft"] }, signal),
    countOpdEncounters(id, today, { status: "completed" }, signal),
    countReceptionNoShowToday(id, today, signal),
  ]);

  return {
    scheduledToday: encScheduled + receptionPipeline,
    active,
    completed,
    noShow,
  };
}
