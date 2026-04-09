"use client";

import { useCallback, useMemo } from "react";
import type { PermissionMode } from "../lib/permissions";
import { userHasPermission } from "../lib/permissions";
import { useAppRole } from "./useAppRole";

/**
 * `hasPermission(domain, mode?)` — `mode` defaults to `"edit"` for backward compatibility.
 * Stable across renders unless `role` / `roleRaw` / `loading` change.
 */
export function usePermission() {
  const { role, roleRaw, loading } = useAppRole();

  const hasPermission = useCallback(
    (action: string, mode: PermissionMode = "edit") => {
      if (loading) return false;
      return userHasPermission(action, role, roleRaw, mode);
    },
    [role, roleRaw, loading]
  );

  return useMemo(
    () => ({ hasPermission, loading, role, roleRaw }),
    [hasPermission, loading, role, roleRaw]
  );
}
