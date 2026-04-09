/**
 * Hospital formulary search — backed by `hospital_inventory` (per-hospital stock / catalog rows).
 */

import type { CatalogEntry } from "./medicineCatalog";
import { catalogFromStockRow, type HospitalInventoryRow } from "./hospitalInventoryCatalog";
import { TABLET_DOSAGE_FORM_SNOMED } from "./snomedDosageForms";
import { supabase } from "../supabase";

export const HOSPITAL_INVENTORY_TABLE = "hospital_inventory";

/** Columns used for formulary search and mapping to `CatalogEntry`. */
export const HOSPITAL_INVENTORY_SEARCH_SELECT =
  "id, hospital_id, brand_name, generic_name, stock_quantity, dosage_form_name, is_lasa, is_high_risk";

/** Row shape returned from `hospital_inventory` search (same as in-house stock). */
export type MedicationRegistryRow = HospitalInventoryRow & {
  hospital_id?: string | null;
};

function parseInventoryQty(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  const n = parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** @deprecated Prefer summing `stock_quantity` on `hospital_inventory` rows directly. */
export type MedicationRegistryInventoryEmbed = {
  stock_quantity?: number | string | null;
  available_quantity?: number | string | null;
  hospital_id?: string | null;
};

/** @deprecated Embedded inventory is no longer used; kept for any legacy callers. */
export function registryStockForHospital(
  embed: MedicationRegistryInventoryEmbed[] | null | undefined,
  hospitalId: string | null | undefined,
): number {
  const hid = hospitalId?.trim();
  if (!hid || !Array.isArray(embed)) return 0;
  let sum = 0;
  for (const inv of embed) {
    if (!inv || String(inv.hospital_id ?? "").trim() !== hid) continue;
    const q = parseInventoryQty(inv.available_quantity ?? inv.stock_quantity);
    sum += q;
  }
  return sum;
}

/** Sort formulary search: positive on-hand stock first, then higher qty, then name. */
export function compareCatalogEntriesByInventoryStock(a: CatalogEntry, b: CatalogEntry): number {
  const tier = (m: CatalogEntry) => {
    const s = m.stock;
    const n = typeof s === "number" && Number.isFinite(s) ? s : 0;
    return n > 0 ? 1 : 0;
  };
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return tb - ta;
  const na = typeof a.stock === "number" && Number.isFinite(a.stock) ? a.stock : 0;
  const nb = typeof b.stock === "number" && Number.isFinite(b.stock) ? b.stock : 0;
  if (na !== nb) return nb - na;
  const la = (a.displayName || a.name || "").toLowerCase();
  const lb = (b.displayName || b.name || "").toLowerCase();
  return la.localeCompare(lb, undefined, { sensitivity: "base" });
}

function sanitizeIlikeFragment(q: string): string {
  return q.trim().replace(/[%*,]/g, "").slice(0, 80);
}

/**
 * Map a `hospital_inventory` row to a catalog entry tagged as registry-style formulary
 * (distinct SKU key from pure in-house `stock` rows for the same inventory id).
 */
export function catalogFromRegistryRow(
  row: MedicationRegistryRow,
  _hospitalId?: string | null,
): CatalogEntry {
  const base = catalogFromStockRow(row);
  const strength = extractStrengthFromLabel(base.name) ?? base.defaultDose;
  return {
    ...base,
    registry_id: row.id,
    defaultDose: strength,
    medication_source: "registry",
  };
}

/**
 * Search hospital formulary (`hospital_inventory`) by brand or generic name.
 * Requires `hospitalId` — rows are scoped per organization.
 */
export async function searchMedicationRegistry(
  query: string,
  options?: { limit?: number; hospitalId?: string | null },
): Promise<{ data: MedicationRegistryRow[]; error: Error | null }> {
  const frag = sanitizeIlikeFragment(query);
  if (frag.length < 2) return { data: [], error: null };

  const hid = options?.hospitalId?.trim();
  if (!hid) return { data: [], error: null };

  const limit = options?.limit ?? 40;
  const half = Math.ceil(limit / 2);
  const pat = `%${frag}%`;

  const baseSelect = () =>
    supabase.from(HOSPITAL_INVENTORY_TABLE).select(HOSPITAL_INVENTORY_SEARCH_SELECT).eq("hospital_id", hid);

  const [bRes, gRes] = await Promise.all([
    baseSelect().ilike("brand_name", pat).limit(half),
    baseSelect().ilike("generic_name", pat).limit(half),
  ]);

  if (bRes.error) return { data: [], error: new Error(bRes.error.message) };
  if (gRes.error) return { data: [], error: new Error(gRes.error.message) };

  const map = new Map<string, MedicationRegistryRow>();
  for (const r of [...(bRes.data ?? []), ...(gRes.data ?? [])]) {
    const row = r as unknown as MedicationRegistryRow;
    if (row?.id) map.set(row.id, row);
  }

  return { data: Array.from(map.values()).slice(0, limit), error: null };
}

/** Pull a strength token from a product label (e.g. "Paracetamol 650mg" → "650mg"). */
export function extractStrengthFromLabel(label: string): string | null {
  const s = label.trim();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|ml|mL|IU|iu)(?=\s|$|[,;+])/i);
  if (!m) return null;
  return `${m[1]}${m[2]}`;
}

export function catalogFromClinicalProposal(input: {
  brandName: string;
  genericName: string;
  dosageFormCode: string;
  dosageFormName: string;
}): CatalogEntry {
  const brand = input.brandName.trim();
  const gen = input.genericName.trim();
  const formCode = input.dosageFormCode.trim() || TABLET_DOSAGE_FORM_SNOMED;
  const formName = input.dosageFormName.trim() || "Tablet";
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? `proposal-${crypto.randomUUID()}`
      : `proposal-${Date.now()}`;
  return {
    id,
    name: brand || "Medication",
    displayName: brand || "Medication",
    brand_name: brand || "Medication",
    generic_name: gen || "Unknown",
    registry_id: null,
    snomed: "",
    active_ingredient: gen || "Unknown",
    active_ingredient_snomed: "",
    form_snomed: formCode,
    form_name: formName,
    defaultDose: "",
    defaultFreq: "",
    defaultDuration: "",
    stock: 0,
    pricePerUnit: 0,
    category: "general",
    medication_source: "proposal",
  };
}
