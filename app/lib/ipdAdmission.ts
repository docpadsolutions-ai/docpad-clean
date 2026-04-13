import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrapRpcArray } from "@/app/lib/ipdConsults";

export function unwrapRpcRecord<T = Record<string, unknown>>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data) && data.length > 0) return data[0] as T;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) return data as T;
  return null;
}

export type BedAvailabilityRow = {
  ward_id?: string;
  ward_name?: string;
  ward_type?: string;
  bed_id?: string;
  bed_number?: string;
  bed_type?: string;
  status?: string;
  is_available?: boolean;
  available?: boolean;
  /** When set, bed auto-releases from maintenance after this time (turnover cleaning). */
  maintenance_until?: string | null;
  [key: string]: unknown;
};

export async function fetchBedAvailability(
  supabase: SupabaseClient,
  hospitalId: string,
): Promise<BedAvailabilityRow[]> {
  const { data, error } = await supabase.rpc("get_bed_availability", {
    p_hospital_id: hospitalId,
  });
  if (error) throw error;
  return normalizeBedAvailabilityPayload(data);
}

export type WardCensusRow = {
  ward_id?: string;
  ward_name?: string;
  admission_id?: string;
  admission_number?: string;
  patient_id?: string;
  patient_name?: string;
  bed_number?: string;
  bed_id?: string;
  primary_diagnosis_display?: string;
  length_of_stay_days?: number;
  los_days?: number;
  admitted_at?: string;
  admitting_doctor_name?: string;
  doctor_name?: string;
  bp_systolic?: number;
  bp_diastolic?: number;
  heart_rate?: number;
  age_years?: number;
  sex?: string;
  gender?: string;
  ward_occupied?: number;
  ward_capacity?: number;
  [key: string]: unknown;
};

export async function fetchWardCensus(
  supabase: SupabaseClient,
  hospitalId: string,
): Promise<WardCensusRow[]> {
  const { data, error } = await supabase.rpc("get_ward_census", {
    p_hospital_id: hospitalId,
  });
  if (error) throw error;
  return unwrapRpcArray<WardCensusRow>(data);
}

/** Group flat bed rows by ward_id for accordion UI. */
export function groupBedsByWard(rows: BedAvailabilityRow[]): Map<
  string,
  { wardId: string; wardName: string; wardType: string; beds: BedAvailabilityRow[] }
> {
  const map = new Map<
    string,
    { wardId: string; wardName: string; wardType: string; beds: BedAvailabilityRow[] }
  >();
  for (const r of rows) {
    const wid = String(r.ward_id ?? "");
    if (!wid) continue;
    if (!map.has(wid)) {
      map.set(wid, {
        wardId: wid,
        wardName: String(r.ward_name ?? "Ward"),
        wardType: String(r.ward_type ?? ""),
        beds: [],
      });
    }
    map.get(wid)!.beds.push(r);
  }
  return map;
}

/** Alternative: RPC returns nested wards with beds array */
export function normalizeBedAvailabilityPayload(data: unknown): BedAvailabilityRow[] {
  const arr = unwrapRpcArray<unknown>(data);
  const flat: BedAvailabilityRow[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (Array.isArray(o.beds)) {
      const wid = String(o.ward_id ?? "");
      const wname = String(o.ward_name ?? "");
      const wtype = String(o.ward_type ?? "");
      for (const b of o.beds) {
        if (!b || typeof b !== "object") continue;
        const br = b as Record<string, unknown>;
        flat.push({
          ...br,
          ward_id: br.ward_id ?? wid,
          ward_name: br.ward_name ?? wname,
          ward_type: br.ward_type ?? wtype,
        } as BedAvailabilityRow);
      }
    } else {
      flat.push(o as BedAvailabilityRow);
    }
  }
  return flat;
}
