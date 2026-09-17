/**
 * Canonical surgical specialty labels from `practitioners.primary_specialty` / `practitioners.specialty`.
 * Used for UI gates (e.g. OPD Plan → Plan Surgery).
 */
export const SURGICAL_SPECIALTY_LABELS = [
  "Orthopedic Surgery",
  "General Surgery",
  "Cardiothoracic Surgery",
  "Neurosurgery",
  "Plastic Surgery",
  "Urology",
  "Vascular Surgery",
  "ENT",
  "Ophthalmology",
  "Obstetrics and Gynaecology",
  "Paediatric Surgery",
  "Oncosurgery",
] as const;

const NORMALIZED_SURGICAL = new Set(
  SURGICAL_SPECIALTY_LABELS.map((s) => s.trim().toLowerCase()),
);

/** True if either field (trimmed) equals any surgical label, case-insensitive. */
export function practitionerHasSurgicalSpecialty(
  primarySpecialty: string | null | undefined,
  specialty: string | null | undefined,
): boolean {
  const check = (raw: string | null | undefined) => {
    const t = (raw ?? "").trim().toLowerCase();
    return t !== "" && NORMALIZED_SURGICAL.has(t);
  };
  return check(primarySpecialty) || check(specialty);
}
