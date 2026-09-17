import type { SupabaseClient } from "@supabase/supabase-js";

export type ClinicalDepartmentOption = {
  id: string;
  name: string;
};

/**
 * Departments appropriate for clinical selection (consult routing, etc.):
 * `is_active` and a non-null, non-empty `specialty`.
 * Support departments (Administration, Pharmacy, …) typically have no specialty and are excluded.
 *
 * Not used for Admin → Departments management, which must list all rows.
 */
export async function fetchClinicalDepartmentsForHospital(
  supabase: SupabaseClient,
  hospitalId: string,
): Promise<{ data: ClinicalDepartmentOption[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("departments")
    .select("id, name, specialty")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true)
    .not("specialty", "is", null)
    .order("name");

  if (error) {
    return { data: [], error: { message: error.message } };
  }

  const rows = (data ?? []) as { id: unknown; name: unknown; specialty: unknown }[];
  const clinical = rows
    .map((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      specialty: r.specialty != null ? String(r.specialty).trim() : "",
    }))
    .filter((r) => r.id && r.specialty.length > 0)
    .map(({ id, name }) => ({ id, name }));

  return { data: clinical, error: null };
}
