import type { CatalogEntry } from "./medicineCatalog";
import { TABLET_DOSAGE_FORM_SNOMED } from "./snomedDosageForms";
import { supabase } from "../supabase";

function sanitizeIlikeFragment(q: string): string {
  return q.trim().replace(/[%*,]/g, "").slice(0, 80);
}

function coerceInventoryBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "number") return v !== 0;
  const s = String(v).toLowerCase();
  return s === "true" || s === "t" || s === "1" || s === "yes";
}

export type HospitalInventoryRow = {
  id: string;
  brand_name: string;
  generic_name: string | null;
  stock_quantity: number | null;
  dosage_form_name?: string | null;
  is_lasa?: boolean | null;
  is_high_risk?: boolean | null;
};

export function catalogFromStockRow(row: HospitalInventoryRow): CatalogEntry {
  const brand = (row.brand_name ?? "").trim() || "Medication";
  const gen = (row.generic_name ?? "").trim() || "Unknown";
  const qtyRaw = row.stock_quantity != null ? Number(row.stock_quantity) : 0;
  const qty = Number.isFinite(qtyRaw) ? qtyRaw : 0;
  const formName = (row.dosage_form_name ?? "").trim() || "Tablet";
  return {
    id: row.id,
    registry_id: null,
    name: brand,
    displayName: brand,
    brand_name: brand,
    generic_name: gen,
    snomed: "",
    active_ingredient: gen,
    active_ingredient_snomed: "",
    form_snomed: TABLET_DOSAGE_FORM_SNOMED,
    form_name: formName,
    defaultDose: "",
    defaultFreq: "",
    defaultDuration: "",
    stock: qty,
    pricePerUnit: 0,
    category: "general",
    medication_source: "stock",
    is_lasa: coerceInventoryBool(row.is_lasa),
    is_high_risk: coerceInventoryBool(row.is_high_risk),
  };
}

/** In-house formulary: match `brand_name` or `generic_name` (deduped by row id). */
export async function searchHospitalInventoryMedicines(
  hospitalId: string,
  query: string,
  options?: { limit?: number },
): Promise<{ data: CatalogEntry[]; error: Error | null }> {
  const frag = sanitizeIlikeFragment(query);
  if (frag.length < 2) return { data: [], error: null };

  const limit = options?.limit ?? 60;
  const half = Math.ceil(limit / 2);
  const pat = `%${frag}%`;

  const [bRes, gRes] = await Promise.all([
    supabase.from("hospital_inventory").select("*").eq("hospital_id", hospitalId).ilike("brand_name", pat).limit(half),
    supabase.from("hospital_inventory").select("*").eq("hospital_id", hospitalId).ilike("generic_name", pat).limit(half),
  ]);

  if (bRes.error) return { data: [], error: new Error(bRes.error.message) };
  if (gRes.error) return { data: [], error: new Error(gRes.error.message) };

  const map = new Map<string, CatalogEntry>();
  for (const r of [...(bRes.data ?? []), ...(gRes.data ?? [])]) {
    const row = r as HospitalInventoryRow;
    if (row?.id) map.set(row.id, catalogFromStockRow(row));
  }

  return { data: Array.from(map.values()).slice(0, limit), error: null };
}
