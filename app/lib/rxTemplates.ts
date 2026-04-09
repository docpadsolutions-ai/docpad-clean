/**
 * Clinical Rx bundles — `rx_templates` + `rx_template_items`.
 *
 * Expected Supabase DDL (run in SQL editor if missing):
 *
 * create table rx_templates (
 *   id uuid primary key default gen_random_uuid(),
 *   template_name text not null,
 *   created_at timestamptz default now()
 * );
 *
 * create table rx_template_items (
 *   id uuid primary key default gen_random_uuid(),
 *   template_id uuid not null references rx_templates(id) on delete cascade,
 *   medicine_name text not null,
 *   dosage_text text default '',
 *   frequency text default '',
 *   duration text default '',
 *   timing text,
 *   instructions text,
 *   sort_order int not null default 0
 * );
 */

import type { CatalogEntry } from "./medicineCatalog";
import { formatAbdmMedicationLabel } from "./medicineCatalog";
import { calculateTotalQuantity } from "./medicationUtils";
import {
  matchCatalogForVoiceName,
  newPrescriptionLineId,
  type PrescriptionLine,
} from "./prescriptionLine";
import { supabase } from "../supabase";

export const RX_TEMPLATES_TABLE = "rx_templates";
export const RX_TEMPLATE_ITEMS_TABLE = "rx_template_items";

export type RxTemplateRow = {
  id: string;
  template_name: string;
  created_at?: string;
};

/** Row shape returned from `rx_template_items` (and used for inserts). */
export type RxTemplateItemRow = {
  id: string;
  template_id: string;
  medicine_name: string;
  dosage_text: string;
  frequency: string;
  duration: string;
  timing: string | null;
  instructions: string | null;
  sort_order?: number;
};

export type RxTemplateItemInsert = {
  template_id: string;
  medicine_name: string;
  dosage_text: string;
  frequency: string;
  duration: string;
  timing: string | null;
  instructions: string | null;
  sort_order: number;
};

function catalogForStoredMedicineName(medicineName: string, index: number): CatalogEntry {
  const name = medicineName.trim();
  const match = matchCatalogForVoiceName(name);
  if (match) return { ...match };
  return {
    id: `tpl-${index}-${Date.now()}`,
    name: name || "Medication",
    displayName: name || "Medication",
    brand_name: name || "Medication",
    generic_name: name || "Unknown",
    snomed: "",
    active_ingredient: name || "Unknown",
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

/** Map a DB template item into a new prescription line (fresh React `id` for append). */
export function rxTemplateItemToPrescriptionLine(row: RxTemplateItemRow, index: number): PrescriptionLine {
  const frequency = (row.frequency ?? "").trim();
  const duration = (row.duration ?? "").trim();
  return {
    id: newPrescriptionLineId(),
    catalog: catalogForStoredMedicineName(row.medicine_name, index),
    dosage: (row.dosage_text ?? "").trim(),
    frequency,
    duration,
    timing: (row.timing ?? "").trim(),
    instructions: (row.instructions ?? "").trim(),
    total_quantity: calculateTotalQuantity(frequency, duration),
  };
}

export function prescriptionLineToTemplateItemInsert(
  line: PrescriptionLine,
  templateId: string,
  sortOrder: number,
): RxTemplateItemInsert {
  return {
    template_id: templateId,
    medicine_name: formatAbdmMedicationLabel(line.catalog),
    dosage_text: line.dosage || "",
    frequency: line.frequency || "",
    duration: line.duration || "",
    timing: line.timing.trim() || null,
    instructions: line.instructions.trim() || null,
    sort_order: sortOrder,
  };
}

export async function fetchRxTemplates(): Promise<{ data: RxTemplateRow[]; error: Error | null }> {
  const { data, error } = await supabase
    .from(RX_TEMPLATES_TABLE)
    .select("id, template_name, created_at")
    .order("template_name", { ascending: true });

  if (error) return { data: [], error: new Error(error.message) };
  return { data: (data ?? []) as RxTemplateRow[], error: null };
}

export async function fetchRxTemplateItems(
  templateId: string,
): Promise<{ data: RxTemplateItemRow[]; error: Error | null }> {
  const { data, error } = await supabase
    .from(RX_TEMPLATE_ITEMS_TABLE)
    .select("id, template_id, medicine_name, dosage_text, frequency, duration, timing, instructions, sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) return { data: [], error: new Error(error.message) };
  return { data: (data ?? []) as RxTemplateItemRow[], error: null };
}

export type SaveTemplateResult = { ok: true; templateId: string } | { ok: false; error: string };

/**
 * Insert header row then item rows. If item insert fails, deletes the header (best-effort rollback).
 */
export async function saveRxTemplateBundle(
  templateName: string,
  lines: PrescriptionLine[],
): Promise<SaveTemplateResult> {
  const trimmed = templateName.trim();
  if (!trimmed) return { ok: false, error: "Template name is required." };
  if (lines.length === 0) return { ok: false, error: "Add at least one medication before saving a template." };

  const { data: header, error: hErr } = await supabase
    .from(RX_TEMPLATES_TABLE)
    .insert({ template_name: trimmed })
    .select("id")
    .single();

  if (hErr || !header?.id) {
    return { ok: false, error: hErr?.message ?? "Could not create template." };
  }

  const templateId = String(header.id);
  const payload = lines.map((line, i) => prescriptionLineToTemplateItemInsert(line, templateId, i));

  const { error: iErr } = await supabase.from(RX_TEMPLATE_ITEMS_TABLE).insert(payload);

  if (iErr) {
    await supabase.from(RX_TEMPLATES_TABLE).delete().eq("id", templateId);
    return { ok: false, error: iErr.message };
  }

  return { ok: true, templateId };
}
