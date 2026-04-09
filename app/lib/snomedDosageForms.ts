/**
 * SNOMED CT dosage forms ValueSet for ABDM / FHIR `Medication.form` coding.
 *
 * ```sql
 * create table snomed_dosage_forms (
 *   code text primary key,
 *   name text not null
 * );
 * -- Example: insert tablet
 * insert into snomed_dosage_forms (code, name) values ('385055001', 'Tablet');
 * ```
 */

import { supabase } from "../supabase";

export const SNOMED_DOSAGE_FORMS_TABLE = "snomed_dosage_forms";

/** SNOMED: Tablet (oral solid) — default for ortho-style prescribing. */
export const TABLET_DOSAGE_FORM_SNOMED = "385055001";

export type SnomedDosageFormRow = {
  code: string;
  name: string;
};

/** Minimal fallback if the table is empty or unreachable (keeps proposal flow usable). */
export const SNOMED_DOSAGE_FORMS_FALLBACK: SnomedDosageFormRow[] = [
  { code: TABLET_DOSAGE_FORM_SNOMED, name: "Tablet" },
];

export async function fetchSnomedDosageForms(): Promise<{
  data: SnomedDosageFormRow[];
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from(SNOMED_DOSAGE_FORMS_TABLE)
    .select("code, name")
    .order("name", { ascending: true });

  if (error) return { data: [], error: new Error(error.message) };

  const rows = (data ?? []) as SnomedDosageFormRow[];
  const cleaned = rows
    .map((r) => ({
      code: String(r.code ?? "").trim(),
      name: String(r.name ?? "").trim(),
    }))
    .filter((r) => r.code && r.name);

  return { data: cleaned, error: null };
}

export function defaultDosageFormSelection(
  forms: SnomedDosageFormRow[],
): SnomedDosageFormRow {
  const tablet = forms.find((f) => f.code === TABLET_DOSAGE_FORM_SNOMED);
  if (tablet) return tablet;
  return forms[0] ?? SNOMED_DOSAGE_FORMS_FALLBACK[0];
}
