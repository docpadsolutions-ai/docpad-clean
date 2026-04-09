"use client";

import { RoleSidebar } from "../components/RoleSidebar";
import { useAppRole } from "../hooks/useAppRole";

export default function PharmacyLayout({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAppRole();
  const r = role ?? "doctor";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RoleSidebar role={r} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
