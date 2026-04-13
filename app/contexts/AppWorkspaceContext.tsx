"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/app/supabase";
import { fetchEffectiveRoleRawFromDb } from "@/app/lib/dashboardRoleRouting";
import { normalizePractitionerRole, type AppRole } from "@/app/lib/userRole";

export type AppWorkspaceContextValue = {
  role: AppRole | null;
  roleRaw: string | null;
  loading: boolean;
};

const AppWorkspaceContext = createContext<AppWorkspaceContextValue | undefined>(undefined);

export function AppWorkspaceProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo(() => ({ role, roleRaw, loading }), [role, roleRaw, loading]);

  return <AppWorkspaceContext.Provider value={value}>{children}</AppWorkspaceContext.Provider>;
}

export function useAppWorkspace(): AppWorkspaceContextValue {
  const ctx = useContext(AppWorkspaceContext);
  if (ctx === undefined) {
    throw new Error("useAppWorkspace must be used within AppWorkspaceProvider");
  }
  return ctx;
}

export { AppWorkspaceContext };
