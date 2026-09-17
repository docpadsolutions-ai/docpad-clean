import type { SupabaseClient } from "@supabase/supabase-js";

export type PractitionerSearchRow = {
  id: string;
  full_name: string | null;
  specialty: string | null;
  role: string | null;
  user_role: string | null;
};

function sanitizeIlike(q: string): string {
  return q.trim().replace(/[%_]/g, "").slice(0, 120);
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseRows(data: unknown): PractitionerSearchRow[] {
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: str(row.id),
    full_name: row.full_name != null ? String(row.full_name) : null,
    specialty: row.specialty != null ? String(row.specialty) : null,
    role: row.role != null ? String(row.role) : null,
    user_role: row.user_role != null ? String(row.user_role) : null,
  }));
}

/** `filter`: narrow by specialty/role substring (e.g. `anaes`, `nurs`) via PostgREST `.or()` on top of name search. */
export type PractitionerRoleFilter = "anaes" | "nurs";

/**
 * Search practitioners: hospital scope, name ILIKE, optional specialty/role OR filter.
 */
export async function searchPractitioners(
  supabase: SupabaseClient,
  hospitalId: string,
  query: string,
  filter?: PractitionerRoleFilter,
): Promise<PractitionerSearchRow[]> {
  const q = sanitizeIlike(query);
  if (q.length < 1) return [];

  let qb = supabase
    .from("practitioners")
    .select("id, full_name, specialty, role, user_role")
    .eq("hospital_id", hospitalId)
    .ilike("full_name", `%${q}%`)
    .limit(8);

  if (filter === "anaes") {
    qb = qb.or("specialty.ilike.%anaes%,role.ilike.%anaes%,user_role.ilike.%anaes%");
  } else if (filter === "nurs") {
    qb = qb.or("specialty.ilike.%nurs%,role.ilike.%nurs%,user_role.ilike.%nurs%");
  }

  const { data, error } = await qb;
  if (error) {
    console.error("[searchPractitioners]", error.message);
    return [];
  }

  return parseRows(data).filter((r) => r.id);
}

/** Primary line: full_name · specialty */
export function practitionerPrimaryLine(r: PractitionerSearchRow): string {
  const name = str(r.full_name) || "—";
  const spec = str(r.specialty);
  return spec ? `${name} · ${spec}` : name;
}

/** @deprecated use searchPractitioners */
export async function searchPractitionersForSurgery(
  supabase: SupabaseClient,
  hospitalId: string,
  query: string,
  mode: "all" | "anaesthetist" | "nurse",
): Promise<PractitionerSearchRow[]> {
  const f = mode === "anaesthetist" ? "anaes" : mode === "nurse" ? "nurs" : undefined;
  return searchPractitioners(supabase, hospitalId, query, f);
}

export function practitionerLine(r: PractitionerSearchRow): string {
  return practitionerPrimaryLine(r);
}
