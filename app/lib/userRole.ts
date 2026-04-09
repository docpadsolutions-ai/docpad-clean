/**
 * Canonical app role (normalized from `practitioners.role` / profile text).
 * Held in client state after fetch — no routing enforced here.
 */
export type UserRole = "admin" | "doctor" | "pharmacist" | "nurse" | "receptionist";

/** @deprecated Use `UserRole`; kept for sidebar/nav call sites. */
export type AppRole = UserRole;

/**
 * True when the stored role text grants admin-console access (middleware + nav).
 * Uses word-boundary checks so arbitrary substrings like inside "Doctor" do not match.
 */
export function rawRoleHasAdminPrivileges(raw: string | null | undefined): boolean {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return false;
  if (/\badministrator\b/.test(t)) return true;
  if (/\badmin\b/.test(t)) return true;
  if (t.includes("superuser") || t.includes("sysadmin") || t.includes("superadmin")) return true;
  return false;
}

/** Clinical staff cues in free-text roles (used with admin for dual-hat routing). */
export function roleLooksLikeClinicalStaff(raw: string | null | undefined): boolean {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return false;
  return (
    t.includes("doctor") ||
    t.includes("physician") ||
    t.includes("consultant") ||
    t.includes("resident") ||
    t.includes("surgeon")
  );
}

/**
 * Map free-text / legacy `practitioners.role` values to a canonical role (default doctor).
 * Doctor + admin in the same string → `doctor` for sidebar defaults, with an explicit Admin link.
 */
function roleLooksLikeNurse(raw: string | null | undefined): boolean {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return false;
  if (/\bnurse\b/.test(t) || /\bnursing\b/.test(t)) return true;
  if (t === "rn" || /\brn\b/.test(t)) return true;
  return false;
}

export function normalizePractitionerRole(raw: string | null | undefined): UserRole {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "doctor";
  if (roleLooksLikeNurse(raw)) return "nurse";
  if (s.includes("pharm")) return "pharmacist";
  if (s.includes("reception")) return "receptionist";
  if (rawRoleHasAdminPrivileges(raw) && roleLooksLikeClinicalStaff(raw)) return "doctor";
  if (rawRoleHasAdminPrivileges(raw)) return "admin";
  return "doctor";
}

/**
 * Parse DB `role` column for optional state: `null` if absent or blank; otherwise normalized.
 */
export function parsePractitionerRoleColumn(raw: unknown): UserRole | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return normalizePractitionerRole(s);
}
