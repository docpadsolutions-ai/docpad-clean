/**
 * Display labels for canonical `practitioners.role` DB values (snake_case / lowercase).
 */
const DB_ROLE_LABEL: Record<string, string> = {
  doctor: "Doctor",
  nurse: "Nurse",
  receptionist: "Receptionist",
  pharmacist: "Pharmacist",
  admin: "Admin",
  lab_technician: "Lab Tech",
  "lab tech": "Lab Tech",
  lab_tech: "Lab Tech",
};

/**
 * Human-readable role for staff lists (directory, badges).
 */
export function formatPractitionerRoleDisplay(raw: string | null | undefined): string {
  if (raw == null || raw === "" || raw === "—") return "—";
  const k = raw.trim().toLowerCase();
  if (DB_ROLE_LABEL[k]) return DB_ROLE_LABEL[k];
  const s = raw.trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
