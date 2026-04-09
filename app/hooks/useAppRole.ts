"use client";

import { useEffect, useState } from "react";
import { fetchEffectiveRoleRawFromDb } from "../lib/dashboardRoleRouting";
import { supabase } from "../supabase";
import { normalizePractitionerRole, type AppRole } from "../lib/userRole";

export function useAppRole(): { role: AppRole | null; roleRaw: string | null; loading: boolean } {
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleRaw, setRoleRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  return { role, roleRaw, loading };
}
