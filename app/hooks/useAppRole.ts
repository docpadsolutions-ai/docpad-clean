"use client";

import { useContext, useEffect, useState } from "react";
import { AppWorkspaceContext } from "../contexts/AppWorkspaceContext";
import { fetchEffectiveRoleRawFromDb } from "../lib/dashboardRoleRouting";
import { supabase } from "../supabase";
import { normalizePractitionerRole, type AppRole } from "../lib/userRole";

/**
 * Effective app role for the signed-in user.
 * When wrapped in `AppWorkspaceProvider` (dashboard shell), reads from context (single fetch).
 * Otherwise fetches once (e.g. pharmacy layout).
 */
export function useAppRole(): { role: AppRole | null; roleRaw: string | null; loading: boolean } {
  const ctx = useContext(AppWorkspaceContext);

  const [role, setRole] = useState<AppRole | null>(null);
  const [roleRaw, setRoleRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ctx !== undefined) return;

    let cancelled = false;

    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (!cancelled) {
          setRole(null);
          setRoleRaw(null);
          setLoading(false);
        }
        return;
      }

      const { effectiveRoleRaw } = await fetchEffectiveRoleRawFromDb(supabase, uid);

      if (cancelled) return;
      setRoleRaw(effectiveRoleRaw);
      setRole(normalizePractitionerRole(effectiveRoleRaw));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [ctx]);

  if (ctx !== undefined) {
    return { role: ctx.role, roleRaw: ctx.roleRaw, loading: ctx.loading };
  }

  return { role, roleRaw, loading };
}
