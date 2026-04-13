import type { SupabaseClient } from "@supabase/supabase-js";
import { practitionerRoleRawFromRow, practitionersOrFilterForAuthUid } from "./practitionerAuthLookup";
import {
  rawRoleHasAdminPrivileges,
  roleLooksLikeClinicalStaff,
} from "./userRole";

export type PractitionerRoleFetchResult = {
  /** Value used for routing (`user_role` if non-empty, else legacy `role`). */
  effectiveRoleRaw: string | null;
  /** Raw `practitioners.user_role` from the matched row (undefined if no row). */
  user_role: unknown;
  /** Raw legacy `practitioners.role` from the matched row (undefined if no row). */
  legacy_role: unknown;
  fetchError: string | null;
};

/**
 * Reads role from `practitioners`: prefers non-empty `user_role`, then legacy `role`.
 * One row per auth user: `WHERE id = auth.uid() OR user_id = auth.uid()` (limit 1).
 */
export async function fetchEffectiveRoleRawFromDb(
  supabase: SupabaseClient,
  userId: string
): Promise<PractitionerRoleFetchResult> {
  const { data: pr, error } = await supabase
    .from("practitioners")
    .select("user_role, role, id, user_id")
    .or(practitionersOrFilterForAuthUid(userId))
    .limit(1)
    .maybeSingle();

  if (error || !pr || typeof pr !== "object") {
    return {
      effectiveRoleRaw: null,
      user_role: undefined,
      legacy_role: undefined,
      fetchError: error?.message ?? null,
    };
  }

  const row = pr as { user_role?: unknown; role?: unknown };

  return {
    effectiveRoleRaw: practitionerRoleRawFromRow(row),
    user_role: row.user_role,
    legacy_role: row.role,
    fetchError: null,
  };
}

export type DashboardRoleRouting = {
  homePath: string;
  allowedPrefixes: string[];
};

/** Lowercase + trim; all dashboard role routing compares using this form (e.g. `Nurse` → `nurse`). */
export function normalizeDashboardRoleKey(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export function nurseDashboardRouting(): DashboardRoleRouting {
  return {
    homePath: "/dashboard",
    allowedPrefixes: [
      "/nursing",
      "/dashboard/settings",
      "/dashboard/opd",
      "/dashboard/opd/patients",
      "/dashboard/patients",
      "/dashboard",
      "/opd",
    ],
  };
}

/** True for composite DB labels: Staff Nurse, Charge Nurse, etc. (exact keys handled in switch first). */
function isNurseRoleNormalized(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return false;
  if (/\bnurse\b/.test(t) || /\bnursing\b/.test(t)) return true;
  if (/\brn\b/.test(t) || t === "rn") return true;
  return false;
}

/** Prefixes for users who may use `/admin`, in-app admin dashboard, and clinical OPD. */
const ADMIN_WORKSPACE_PREFIXES: string[] = [
  "/admin",
  "/billing",
  "/dashboard/admin",
  "/dashboard/opd",
  "/dashboard/opd/patients",
  "/dashboard/opd/new",
  "/dashboard/opd/encounter",
  "/dashboard/patients",
  "/dashboard/settings",
  "/dashboard",
  "/lab",
  "/nursing",
  "/reception",
  "/opd",
  "/pharmacy",
];

/**
 * Maps `practitioners.user_role` / legacy `role` (trim + lowercase) to home URL and allowed prefixes.
 * Explicit `switch` for known `user_role` values runs before admin heuristics so nurse never lands on `/dashboard/admin`.
 */
export function resolveDashboardRoutingFromRoleRaw(raw: string | null | undefined): DashboardRoleRouting {
  const s = normalizeDashboardRoleKey(raw);
  if (!s) {
    return {
      homePath: "/dashboard/opd",
      allowedPrefixes: [
        "/dashboard/opd",
        "/dashboard/settings",
        "/dashboard/patients",
        "/dashboard",
        "/reception",
        "/opd",
      ],
    };
  }

  switch (s) {
    case "nurse":
    case "nursing":
    case "rn":
      return nurseDashboardRouting();
    default:
      break;
  }

  if (isNurseRoleNormalized(s)) {
    return nurseDashboardRouting();
  }

  if (s.includes("pharm")) {
    return {
      homePath: "/dashboard/pharmacy",
      allowedPrefixes: [
        "/dashboard/pharmacy",
        "/pharmacy",
        "/dashboard/opd",
        "/dashboard/patients",
        "/dashboard/settings",
        "/opd",
      ],
    };
  }
  if (s.includes("reception")) {
    return {
      homePath: "/reception",
      allowedPrefixes: [
        "/reception",
        "/billing",
        "/dashboard",
        "/dashboard/opd/patients",
        "/dashboard/settings",
      ],
    };
  }

  if (/\blab\b/i.test(s) && (s.includes("tech") || s.includes("technician") || s.includes("scientist"))) {
    return {
      homePath: "/lab",
      allowedPrefixes: [
        "/lab",
        "/dashboard",
        "/dashboard/opd/patients",
        "/dashboard/patients",
        "/dashboard/settings",
        "/opd",
      ],
    };
  }

  const adminCapable = rawRoleHasAdminPrivileges(raw);
  const clinical = roleLooksLikeClinicalStaff(raw);

  if (adminCapable && clinical) {
    return {
      homePath: "/dashboard/opd",
      allowedPrefixes: ADMIN_WORKSPACE_PREFIXES,
    };
  }
  if (adminCapable) {
    return {
      homePath: "/dashboard/admin",
      allowedPrefixes: ADMIN_WORKSPACE_PREFIXES,
    };
  }

  return {
    homePath: "/dashboard/opd",
    allowedPrefixes: [
      "/dashboard/opd",
      "/dashboard/settings",
      "/dashboard/patients",
      "/dashboard",
      "/reception",
      "/opd",
    ],
  };
}

export function isPathAllowedByPrefixes(pathname: string, allowedPrefixes: string[]): boolean {
  const path =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  for (const prefix of allowedPrefixes) {
    const p = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    if (path === p || path.startsWith(`${p}/`)) return true;
  }
  return false;
}
