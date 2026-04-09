import type { SupabaseClient } from "@supabase/supabase-js";
import { practitionerRoleRawFromRow } from "./practitionerAuthLookup";
import { normalizePractitionerRole, type UserRole } from "./userRole";

export type DoctorAssignmentOption = { id: string; full_name: string | null };

function mentionsMissingColumn(msg: string, col: string): boolean {
  const m = msg.toLowerCase();
  return m.includes(col.toLowerCase());
}

/** OPD assignee: clinical staff only (exclude nurse / pharmacist / receptionist rows). */
function includeInDoctorDropdown(row: { user_role?: unknown; role?: unknown }): boolean {
  const raw = practitionerRoleRawFromRow(row);
  const canonical: UserRole = normalizePractitionerRole(raw);
  if (canonical === "nurse" || canonical === "pharmacist" || canonical === "receptionist") {
    return false;
  }
  return true;
}

/**
 * Practitioners for "assign a doctor" dropdowns (reception → add to queue, etc.).
 *
 * - Selects **`practitioners.id`** (primary key). This is what `appointments.doctor_id` FK expects.
 * - Never uses `user_id` as the option value (that would be `auth.users.id` and can violate FK).
 * - Does **not** rely on `role = 'doctor'` alone; uses `user_role` / `role` via `normalizePractitionerRole`
 *   so values like `Doctor`, `consultant`, or role only in `user_role` still appear.
 */
export async function fetchDoctorAssignmentOptions(
  client: SupabaseClient,
  hospitalId: string,
): Promise<{ options: DoctorAssignmentOption[]; error: Error | null }> {
  const hid = hospitalId.trim();
  if (!hid) {
    return { options: [], error: null };
  }

  async function run(withIsActive: boolean, withUserId: boolean) {
    const projection = withUserId ? "id, user_id, full_name, role, user_role" : "id, full_name, role, user_role";
    let q = client.from("practitioners").select(projection).eq("hospital_id", hid);
    if (withIsActive) q = q.eq("is_active", true);
    return q.order("full_name", { ascending: true, nullsFirst: false });
  }

  let { data, error } = await run(true, true);

  if (error && (error.code === "42703" || mentionsMissingColumn(error.message, "is_active"))) {
    ({ data, error } = await run(false, true));
  }
  if (error && (error.code === "42703" || mentionsMissingColumn(error.message, "user_id"))) {
    ({ data, error } = await run(true, false));
  }
  if (error && (error.code === "42703" || mentionsMissingColumn(error.message, "is_active"))) {
    ({ data, error } = await run(false, false));
  }

  if (error) {
    return { options: [], error: new Error(error.message) };
  }

  const rows = (data ?? []) as {
    id?: unknown;
    user_id?: unknown;
    full_name?: unknown;
    role?: unknown;
    user_role?: unknown;
  }[];

  const options: DoctorAssignmentOption[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!includeInDoctorDropdown(row)) continue;

    const pk =
      row.id != null && String(row.id).trim() !== "" ? String(row.id).trim() : null;
    if (!pk) continue;

    // appointments.doctor_id → practitioners.id (never auth.users id / user_id)
    if (row.user_id != null && String(row.user_id).trim() === pk) {
      // Valid: some rows use practitioners.id = auth uid
    }

    if (seen.has(pk)) continue;
    seen.add(pk);

    options.push({
      id: pk,
      full_name: row.full_name != null ? String(row.full_name) : null,
    });
  }

  return { options, error: null };
}
