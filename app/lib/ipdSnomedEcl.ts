/**
 * ECL strings for IPD / shared SNOMED search (Snowstorm Ontoserver expansion).
 * Mirrors clinical (`<< 404684003`) and procedure (`<< 71388002`) roots used in `snomedEclBuilder`.
 */
export const SNOMED_ECL_CLINICAL_FINDING = "<<404684003";
/** Musculoskeletal finding — prefer for orthopedics examination search. */
export const SNOMED_ECL_MSK_FINDING = "<<928000";
export const SNOMED_ECL_PROCEDURE = "<<71388002";
/** Procedure ∩ laterality-modelling content (surfaces laterality-aware procedures first). */
export const SNOMED_ECL_PROCEDURE_WITH_LATERALITY = "<<71388002 AND <<272741003";

export function isOrthopedicsSpecialty(specialty: string | null | undefined): boolean {
  const s = (specialty ?? "").toLowerCase();
  return s.includes("orthopedic") || s.includes("orthopaedic");
}
