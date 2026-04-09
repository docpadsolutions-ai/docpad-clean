export type MedicationSource =
  | "registry"
  | "stock"
  | "proposal"
  | "template"
  | "voice"
  | "legacy"
  | "history"
  | "favorite";

export type CatalogEntry = {
  id: string;
  /** Trade / brand name (ABDM: primary display) */
  name: string;
  displayName: string;
  /** Explicit brand when different from legacy `name` */
  brand_name?: string;
  /** Generic / salt (ABDM); mirrors `active_ingredient` when from registry */
  generic_name?: string;
  /** Inventory / formulary row id when sourced from `hospital_inventory` (registry-style SKU key) */
  registry_id?: string | null;
  snomed: string;
  active_ingredient: string;
  active_ingredient_snomed: string;
  form_snomed: string;
  form_name: string;
  defaultDose: string;
  defaultFreq: string;
  defaultDuration: string;
  stock: number;
  pricePerUnit: number;
  category: string;
  isTemplate?: boolean;
  medication_source?: MedicationSource;
  /** From `hospital_inventory` — look-alike / sound-alike flag */
  is_lasa?: boolean;
  /** From `hospital_inventory` */
  is_high_risk?: boolean;
};

/** ABDM-style label: Brand [Generic] when salt differs from brand. */
export function formatAbdmMedicationLabel(c: CatalogEntry): string {
  const brand = (c.brand_name ?? c.displayName ?? c.name).trim();
  const gen = (c.generic_name ?? c.active_ingredient).trim();
  if (!gen || gen.toLowerCase() === brand.toLowerCase()) return brand || "Medication";
  return `${brand} [${gen}]`;
}

export const medicineCatalog: CatalogEntry[] = [
  { id: "1", name: "Tab Paracetamol 500mg", displayName: "Tab Paracetamol 500mg", snomed: "763158003", active_ingredient: "Paracetamol", active_ingredient_snomed: "387517004", form_snomed: "385055001", form_name: "Tablet", defaultDose: "500mg", defaultFreq: "1 tab BD", defaultDuration: "3 days", stock: 1500, pricePerUnit: 2.5, category: "fever" },
  { id: "2", name: "Tab Pantoprazole 40mg", displayName: "Tab Pantoprazole 40mg", snomed: "372525000", active_ingredient: "Pantoprazole", active_ingredient_snomed: "372525000", form_snomed: "385055001", form_name: "Tablet", defaultDose: "40mg", defaultFreq: "1 tab OD", defaultDuration: "7 days", stock: 500, pricePerUnit: 6.0, category: "general" },
  { id: "3", name: "Tab Azithromycin 500mg", displayName: "Tab Azithromycin 500mg", snomed: "372482001", active_ingredient: "Azithromycin", active_ingredient_snomed: "372482001", form_snomed: "385055001", form_name: "Tablet", defaultDose: "500mg", defaultFreq: "1 tab OD", defaultDuration: "5 days", stock: 45, pricePerUnit: 22.5, category: "cough" },
  { id: "4", name: "Tab Cetirizine 10mg", displayName: "Tab Cetirizine 10mg", snomed: "372523002", active_ingredient: "Cetirizine", active_ingredient_snomed: "372523002", form_snomed: "385055001", form_name: "Tablet", defaultDose: "10mg", defaultFreq: "1 tab OD", defaultDuration: "5 days", stock: 800, pricePerUnit: 1.5, category: "cough" },
  { id: "5", name: "URTI Bundle", displayName: "URTI Bundle", snomed: "372523002", active_ingredient: "Combination", active_ingredient_snomed: "372523002", form_snomed: "385055001", form_name: "Template", defaultDose: "—", defaultFreq: "—", defaultDuration: "5 days", stock: 0, pricePerUnit: 0, category: "cough", isTemplate: true },
  { id: "6", name: "Tab Metformin 500mg", displayName: "Tab Metformin 500mg", snomed: "387062002", active_ingredient: "Metformin", active_ingredient_snomed: "372814007", form_snomed: "385055001", form_name: "Tablet", defaultDose: "500mg", defaultFreq: "1 tab BD", defaultDuration: "30 days", stock: 1200, pricePerUnit: 3.0, category: "diabetes" },
  { id: "7", name: "Tab Amlodipine 5mg", displayName: "Tab Amlodipine 5mg", snomed: "386864001", active_ingredient: "Amlodipine", active_ingredient_snomed: "386864001", form_snomed: "385055001", form_name: "Tablet", defaultDose: "5mg", defaultFreq: "1 tab OD", defaultDuration: "30 days", stock: 600, pricePerUnit: 4.5, category: "hypertension" },
  { id: "8", name: "Tab Ibuprofen 400mg", displayName: "Tab Ibuprofen 400mg", snomed: "387207008", active_ingredient: "Ibuprofen", active_ingredient_snomed: "387207008", form_snomed: "385055001", form_name: "Tablet", defaultDose: "400mg", defaultFreq: "1 tab TDS", defaultDuration: "3 days", stock: 900, pricePerUnit: 2.0, category: "fever" },
];
