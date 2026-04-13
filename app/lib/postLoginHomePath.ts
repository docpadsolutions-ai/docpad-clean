import type { SupabaseClient } from "@supabase/supabase-js";
import { practitionersOrFilterForAuthUid } from "./practitionerAuthLookup";

/**
 * Reads `practitioners.role` for the session user (`id = auth.uid()` OR `user_id = auth.uid()`), at most one row.
 */
export async function fetchPractitionerRoleColumnForAuth(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("practitioners")
    .select("role")
    .or(practitionersOrFilterForAuthUid(userId))
    .limit(1)
    .maybeSingle();

  if (error || !data || typeof data !== "object") return null;
  const r = (data as { role?: unknown }).role;
  if (r == null || r === "") return null;
  const t = String(r).trim();
  return t || null;
}

/**
 * Default landing path after sign-in from `practitioners.role` (trim + lowercase).
 * Unknown / empty → `/opd` (same hub as doctor).
 */
export function resolveDefaultHomePathFromPractitionerRole(roleRaw: string | null | undefined): string {
  const s = (roleRaw ?? "").trim().toLowerCase();
  if (!s) return "/opd";
  if (s === "doctor") return "/opd";
  if (s === "nurse") return "/nursing";
  if (s === "receptionist") return "/reception";
  if (s === "lab_technician" || s === "lab_tech" || s === "lab tech") return "/lab";
  if (s === "pharmacist") return "/pharmacy";
  return "/opd";
}
