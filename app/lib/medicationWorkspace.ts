/**
 * Prescription workspace: favorites + prescribing history.
 *
 * ```sql
 * create table user_favorites (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id uuid not null references auth.users(id) on delete cascade,
 *   catalog_medication_id text,
 *   medicine_name text not null,
 *   medicine_display_name text,
 *   active_ingredient text,
 *   active_ingredient_snomed text,
 *   dosage_form_snomed text,
 *   dosage_form_name text,
 *   created_at timestamptz default now(),
 *   unique (user_id, medicine_name)
 * );
 *
 * create table medication_history (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id uuid not null references auth.users(id) on delete cascade,
 *   encounter_id uuid,
 *   medicine_name text not null,
 *   dosage_text text default '',
 *   frequency text default '',
 *   duration text default '',
 *   timing text,
 *   instructions text,
 *   prescribed_at timestamptz default now()
 * );
 * create index medication_history_user_prescribed on medication_history (user_id, prescribed_at desc);
 * ```
 */

import type { CatalogEntry } from "./medicineCatalog";
import { formatAbdmMedicationLabel, medicineCatalog } from "./medicineCatalog";
import type { PrescriptionLine } from "./prescriptionLine";
import { supabase } from "../supabase";

export const USER_FAVORITES_TABLE = "user_favorites";
export const MEDICATION_HISTORY_TABLE = "medication_history";

export type UserFavoriteRow = {
  id: string;
  user_id: string;
  catalog_medication_id: string | null;
  medicine_name: string;
  medicine_display_name: string | null;
  active_ingredient: string | null;
  active_ingredient_snomed: string | null;
  dosage_form_snomed: string | null;
  dosage_form_name: string | null;
  created_at?: string;
};

export type MedicationHistoryRow = {
  id: string;
  user_id: string;
  encounter_id: string | null;
  medicine_name: string;
  dosage_text: string;
  frequency: string;
  duration: string;
  timing: string | null;
  instructions: string | null;
  prescribed_at: string;
};

export function catalogEntryFromFavoriteRow(row: UserFavoriteRow): CatalogEntry {
  if (row.catalog_medication_id) {
    const found = medicineCatalog.find((m) => m.id === row.catalog_medication_id);
    if (found) return { ...found };
  }
  const display = (row.medicine_display_name ?? row.medicine_name).trim() || "Medication";
  const name = row.medicine_name.trim() || display;
  const gen = (row.active_ingredient ?? "Unknown").trim() || "Unknown";
  return {
    id: `fav-${row.id}`,
    name,
    displayName: display,
    brand_name: name,
    generic_name: gen,
    registry_id: row.catalog_medication_id && !medicineCatalog.some((m) => m.id === row.catalog_medication_id)
      ? row.catalog_medication_id
      : null,
    snomed: "",
    active_ingredient: gen,
    active_ingredient_snomed: row.active_ingredient_snomed ?? "",
    form_snomed: row.dosage_form_snomed ?? "385055001",
    form_name: row.dosage_form_name ?? "Tablet",
    defaultDose: "",
    defaultFreq: "",
    defaultDuration: "",
    stock: 0,
    pricePerUnit: 0,
    category: "general",
  };
}

export function catalogEntryFromHistoryRow(row: MedicationHistoryRow): CatalogEntry {
  const match = medicineCatalog.find((m) => m.name === row.medicine_name);
  if (match) return { ...match };
  const name = row.medicine_name.trim() || "Medication";
  return {
    id: `hist-${row.id}`,
    name,
    displayName: name,
    brand_name: name,
    generic_name: "",
    snomed: "",
    active_ingredient: "Unknown",
    active_ingredient_snomed: "",
    form_snomed: "385055001",
    form_name: "Tablet",
    defaultDose: "",
    defaultFreq: "",
    defaultDuration: "",
    stock: 0,
    pricePerUnit: 0,
    category: "general",
  };
}

export type MedicationPrefillFields = {
  dosage: string;
  frequency: string;
  duration: string;
  timing: string;
  instructions: string;
};

export function prefillFromHistoryRow(row: MedicationHistoryRow): MedicationPrefillFields {
  return {
    dosage: (row.dosage_text ?? "").trim(),
    frequency: (row.frequency ?? "").trim(),
    duration: (row.duration ?? "").trim(),
    timing: (row.timing ?? "").trim(),
    instructions: (row.instructions ?? "").trim(),
  };
}

export async function fetchUserFavorites(userId: string): Promise<{ data: UserFavoriteRow[]; error: Error | null }> {
  const { data, error } = await supabase
    .from(USER_FAVORITES_TABLE)
    .select(
      "id, user_id, catalog_medication_id, medicine_name, medicine_display_name, active_ingredient, active_ingredient_snomed, dosage_form_snomed, dosage_form_name, created_at",
    )
    .eq("user_id", userId)
    .order("medicine_display_name", { ascending: true, nullsFirst: false });

  if (error) return { data: [], error: new Error(error.message) };
  return { data: (data ?? []) as UserFavoriteRow[], error: null };
}

export async function addUserFavorite(userId: string, med: CatalogEntry): Promise<{ error: Error | null }> {
  const { error } = await supabase.from(USER_FAVORITES_TABLE).insert({
    user_id: userId,
    catalog_medication_id:
      med.id.startsWith("__") ||
      med.id.startsWith("voice-") ||
      med.id.startsWith("tpl-") ||
      med.id.startsWith("fav-") ||
      med.id.startsWith("hist-") ||
      med.id.startsWith("manual-") ||
      med.id.startsWith("proposal-")
        ? null
        : med.id,
    medicine_name: med.name,
    medicine_display_name: formatAbdmMedicationLabel(med),
    active_ingredient: med.active_ingredient,
    active_ingredient_snomed: med.active_ingredient_snomed,
    dosage_form_snomed: med.form_snomed,
    dosage_form_name: med.form_name,
  });
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function removeUserFavorite(userId: string, favoriteId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from(USER_FAVORITES_TABLE).delete().eq("user_id", userId).eq("id", favoriteId);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

/** Unstar catalog drug: match by catalog_medication_id when present, else medicine_name. */
export async function removeUserFavoriteByMedication(
  userId: string,
  med: CatalogEntry,
): Promise<{ error: Error | null }> {
  const isCatalogId = medicineCatalog.some((m) => m.id === med.id);
  let q = supabase.from(USER_FAVORITES_TABLE).delete().eq("user_id", userId);
  if (isCatalogId) {
    q = q.eq("catalog_medication_id", med.id);
  } else {
    q = q.eq("medicine_name", med.name);
  }
  const { error } = await q;
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function fetchRecentMedications(
  userId: string,
  uniqueLimit = 20,
): Promise<{ data: MedicationHistoryRow[]; error: Error | null }> {
  const { data, error } = await supabase
    .from(MEDICATION_HISTORY_TABLE)
    .select(
      "id, user_id, encounter_id, medicine_name, dosage_text, frequency, duration, timing, instructions, prescribed_at",
    )
    .eq("user_id", userId)
    .order("prescribed_at", { ascending: false })
    .limit(120);

  if (error) return { data: [], error: new Error(error.message) };
  const rows = (data ?? []) as MedicationHistoryRow[];
  const seen = new Set<string>();
  const out: MedicationHistoryRow[] = [];
  for (const r of rows) {
    const key = r.medicine_name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= uniqueLimit) break;
  }
  return { data: out, error: null };
}

export function prescriptionLinesToHistoryInserts(
  lines: PrescriptionLine[],
  userId: string,
  encounterId: string,
): Record<string, unknown>[] {
  return lines.map((line) => ({
    user_id: userId,
    encounter_id: encounterId,
    medicine_name: formatAbdmMedicationLabel(line.catalog),
    dosage_text: line.dosage || "",
    frequency: line.frequency || "",
    duration: line.duration || "",
    timing: line.timing.trim() || null,
    instructions: line.instructions.trim() || null,
  }));
}

export async function insertMedicationHistoryForEncounter(
  lines: PrescriptionLine[],
  userId: string,
  encounterId: string,
): Promise<{ error: Error | null }> {
  if (lines.length === 0) return { error: null };
  const payload = prescriptionLinesToHistoryInserts(lines, userId, encounterId);
  const { error } = await supabase.from(MEDICATION_HISTORY_TABLE).insert(payload);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}
