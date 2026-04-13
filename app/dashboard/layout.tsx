"use client";

import { AppWorkspaceProvider } from "../contexts/AppWorkspaceContext";
import { RoleSidebar } from "../components/RoleSidebar";
import { useAppRole } from "../hooks/useAppRole";
import { rawRoleHasAdminPrivileges } from "../lib/userRole";

function DashboardLayoutShell({ children }: { children: React.ReactNode }) {
  const { role, roleRaw, loading } = useAppRole();
  const r = role ?? "doctor";

  const showAdminConsoleLink =
    role !== "nurse" && rawRoleHasAdminPrivileges(roleRaw) && r === "doctor";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RoleSidebar role={r} showAdminConsoleLink={showAdminConsoleLink} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppWorkspaceProvider>
      <DashboardLayoutShell>{children}</DashboardLayoutShell>
    </AppWorkspaceProvider>
  );
}
