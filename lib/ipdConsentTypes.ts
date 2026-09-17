import type { SupabaseClient } from "@supabase/supabase-js";

export type IpdConsentTypeRow = Record<string, unknown>;

/** Slug for `code` column from a human-readable consent name. */
export function consentCodeFromDisplayName(name: string): string {
  const raw = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return raw || "CONSENT";
}

/** Hospital-specific rows first, then system defaults; `sort_order` within each tier. */
export function sortConsentTypesForPicker(rows: IpdConsentTypeRow[]): IpdConsentTypeRow[] {
  return [...rows].sort((a, b) => {
    const ah = a.hospital_id != null && String(a.hospital_id).trim() !== "" ? 0 : 1;
    const bh = b.hospital_id != null && String(b.hospital_id).trim() !== "" ? 0 : 1;
    if (ah !== bh) return ah - bh;
    const ao = Number(a.sort_order ?? 0);
    const bo = Number(b.sort_order ?? 0);
    return ao - bo;
  });
}

export async function fetchActiveConsentTypesForHospital(
  supabase: SupabaseClient,
  hospitalId: string,
): Promise<{ data: IpdConsentTypeRow[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("ipd_consent_types")
    .select("*")
    .eq("is_active", true)
    .or(`hospital_id.eq.${hospitalId},hospital_id.is.null`);

  if (error) return { data: [], error: new Error(error.message) };
  return { data: sortConsentTypesForPicker((data ?? []) as IpdConsentTypeRow[]), error: null };
}
