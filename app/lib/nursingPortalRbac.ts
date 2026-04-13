import { practitionerRoleRawFromRow } from "@/app/lib/practitionerAuthLookup";
import { normalizePractitionerRole, rawRoleHasAdminPrivileges } from "@/app/lib/userRole";

/** Nursing portal: nurses + admins (including privilege-only admin strings). */
export function canAccessNursingPortal(practitionerRow: { role?: unknown; user_role?: unknown } | null): boolean {
  if (!practitionerRow || typeof practitionerRow !== "object") return false;
  const raw = practitionerRoleRawFromRow(practitionerRow as { user_role?: unknown; role?: unknown });
  if (!raw?.trim()) return false;
  const n = normalizePractitionerRole(raw);
  if (n === "nurse" || n === "admin") return true;
  if (rawRoleHasAdminPrivileges(raw)) return true;
  return false;
}
