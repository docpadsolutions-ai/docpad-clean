/**
 * Tier-1 multi-tenant schema: `practitioners.hospital_id` → `organizations.id`.
 * Patients, appointments, `opd_encounters`, and `invitations` use `hospital_id` for isolation.
 * Client code should resolve the active org with `fetchAuthOrgId()` (`auth_org()` RPC), not ad-hoc practitioner selects.
 */

import type { UserRole } from "./userRole";

export type OrganizationRow = {
  id: string;
  name: string | null;
};

/**
 * Legacy name: app profile shape. Persisted rows live in `practitioners` (not a separate `profiles` table).
 * Prefer selecting `practitioners` for staff/doctor identity after login.
 */
export type ProfileRow = {
  id?: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  /** From `practitioners.role` / `user_role` when mapped. */
  role?: UserRole | null;
};

/** Hospital staff / doctor row (`practitioners`) — source of truth for clinical users. */
export type PractitionerRow = {
  id: string;
  hospital_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  specialty?: string | null;
  qualification?: string | null;
  registration_no?: string | null;
  email?: string | null;
  /** Normalized app role once parsed from `practitioners.role` text. */
  role?: UserRole | null;
};

export const ORGANIZATIONS_TABLE = "organizations";
export const PRACTITIONERS_TABLE = "practitioners";

/**
 * `opd_encounters` column that stores `auth.users.id` (`auth.uid()`) for enterprise RLS ownership.
 * Matches `advice_templates.doctor_id` in this app. If your table uses `user_id` instead, change this constant.
 */
export const OPD_ENCOUNTERS_AUTH_USER_COLUMN = "doctor_id" as const;
