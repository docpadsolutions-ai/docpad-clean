/**
 * `investigations.test_category` CHECK allows only these values (Postgres constraint
 * `investigations_test_category_check`). Catalogue rows use free-text groupings
 * (e.g. BIOCHEMISTRY, CARDIAC) — map them here before insert.
 */
export type InvestigationTestCategory =
  | "lab"
  | "imaging"
  | "cardiac"
  | "advanced"
  | "microbiology"
  | "serology";

const ALLOWED = new Set<string>([
  "lab",
  "imaging",
  "cardiac",
  "advanced",
  "microbiology",
  "serology",
]);

/**
 * Map `test_catalogue.category` (or similar) to a value accepted by `investigations.test_category`.
 */
export function mapCatalogCategoryToInvestigationTestCategory(
  raw: string | null | undefined,
): InvestigationTestCategory {
  const trimmed = (raw ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (ALLOWED.has(lower)) return lower as InvestigationTestCategory;

  const u = trimmed.toUpperCase().replace(/\s+/g, "_");

  if (u.includes("MICRO") || u === "MICROBIOLOGY") return "microbiology";
  if (u.includes("SEROLOGY") || u.includes("IMMUNOLOGY")) return "serology";

  if (
    u.includes("ECHO") ||
    u.includes("ECG") ||
    u.includes("EKG") ||
    u.includes("CARDIAC") ||
    u.includes("CARDIO") ||
    u === "CARDIOLOGY"
  ) {
    return "cardiac";
  }

  if (
    u.includes("CT") ||
    u.includes("MRI") ||
    u.includes("XRAY") ||
    u.includes("X_RAY") ||
    u.includes("ULTRASOUND") ||
    u.includes("RADIO") ||
    u.includes("IMAGING") ||
    u === "RADIOLOGY" ||
    u.includes("MAMMO")
  ) {
    return "imaging";
  }

  if (
    u.includes("PATHO") ||
    u.includes("HISTO") ||
    u === "ADVANCED" ||
    u.includes("MOLECULAR") ||
    u.includes("GENETIC")
  ) {
    return "advanced";
  }

  // Biochemistry, hematology, coagulation, chemistry, endocrine, urine, etc.
  return "lab";
}
