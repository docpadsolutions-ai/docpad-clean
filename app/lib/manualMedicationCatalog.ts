import type { CatalogEntry } from "./medicineCatalog";

/** Stub `CatalogEntry` while the dosage modal is in manual-entry mode; real name applied on confirm. */
export const MANUAL_ENTRY_CATALOG_ID = "__manual__";

export const MANUAL_ENTRY_CATALOG_STUB: CatalogEntry = {
  id: MANUAL_ENTRY_CATALOG_ID,
  name: "",
  displayName: "",
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

export function isManualCatalogEntry(c: CatalogEntry): boolean {
  return c.id === MANUAL_ENTRY_CATALOG_ID;
}

export function buildManualCatalogEntry(medicineName: string): CatalogEntry {
  const n = medicineName.trim();
  return {
    ...MANUAL_ENTRY_CATALOG_STUB,
    id: `manual-${Date.now()}`,
    name: n || "Medication",
    displayName: n || "Medication",
  };
}
