import type { UserRole } from "./userRole";

export type PermissionMode = "view" | "edit";

/** Domains for `hasPermission(domain, mode)`. Legacy `can_*` strings are mapped internally. */
export type PermissionDomain =
  | "prescriptions"
  | "diagnosis"
  | "examination"
  | "vitals"
  | "triage_notes"
  | "dispensing"
  | "encounter_save"
  | "invite_staff"
  | "billing";

const COORDINATION_VIEW_ROLES: UserRole[] = ["doctor", "nurse", "pharmacist", "admin", "receptionist"];

/** Clinical edit surfaces (OPD encounter, etc.): doctors and hospital admins get full access. */
function isDoctorOrAdmin(role: UserRole): boolean {
  return role === "doctor" || role === "admin";
}

function triageLike(role: UserRole, rawLower: string): boolean {
  return role === "receptionist" || rawLower.includes("triage");
}

function mapLegacyDomain(domain: string): string {
  switch (domain) {
    case "can_prescribe":
      return "prescriptions";
    case "can_edit_vitals":
      return "vitals";
    case "can_invite_staff":
      return "invite_staff";
    case "can_view_billing":
      return "billing";
    case "can_dispense_meds":
      return "dispensing";
    default:
      return domain;
  }
}

/**
 * View vs edit by clinical domain. Roles come from `practitioners.role` + `normalizePractitionerRole`.
 */
export function userHasPermission(
  domain: string,
  role: UserRole | null,
  roleRaw: string | null,
  mode: PermissionMode
): boolean {
  if (!role) return false;
  const raw = (roleRaw ?? "").trim().toLowerCase();
  const d = mapLegacyDomain(domain);

  switch (d) {
    case "prescriptions":
      if (mode === "view") {
        return COORDINATION_VIEW_ROLES.includes(role) || triageLike(role, raw);
      }
      return isDoctorOrAdmin(role);
    case "diagnosis":
      if (mode === "view") {
        return COORDINATION_VIEW_ROLES.includes(role) || triageLike(role, raw);
      }
      return isDoctorOrAdmin(role);
    case "examination":
      if (mode === "view") {
        return COORDINATION_VIEW_ROLES.includes(role) || triageLike(role, raw);
      }
      return isDoctorOrAdmin(role);
    case "vitals":
      if (mode === "view") {
        return COORDINATION_VIEW_ROLES.includes(role) || triageLike(role, raw);
      }
      return isDoctorOrAdmin(role) || triageLike(role, raw);
    case "triage_notes":
      if (mode === "view") {
        return role === "doctor" || triageLike(role, raw) || role === "admin";
      }
      return isDoctorOrAdmin(role) || triageLike(role, raw);
    case "dispensing":
      if (mode === "view") {
        return role === "pharmacist" || role === "doctor" || role === "admin" || triageLike(role, raw);
      }
      return role === "pharmacist" || role === "admin";
    case "encounter_save":
      if (mode === "view") {
        return COORDINATION_VIEW_ROLES.includes(role) || triageLike(role, raw);
      }
      return role === "doctor" || role === "admin" || triageLike(role, raw);
    case "invite_staff":
      return mode === "edit" && role === "admin";
    case "billing":
      if (mode === "view") {
        return role === "admin" || role === "receptionist";
      }
      return role === "admin";
    default:
      return false;
  }
}
