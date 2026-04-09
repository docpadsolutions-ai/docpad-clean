"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { RoleSidebar } from "../components/RoleSidebar";
import { useAppRole } from "../hooks/useAppRole";
import { rawRoleHasAdminPrivileges } from "../lib/userRole";

function isDashboardHubRoot(pathname: string): boolean {
  return pathname === "/dashboard" || pathname === "/dashboard/";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { role, roleRaw, loading } = useAppRole();
  const r = role ?? "doctor";
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const nurseHubRedirectStarted = useRef(false);

  useEffect(() => {
    if (loading || role !== "nurse") {
      nurseHubRedirectStarted.current = false;
      return;
    }
    if (!isDashboardHubRoot(pathname)) {
      nurseHubRedirectStarted.current = false;
      return;
    }
    if (nurseHubRedirectStarted.current) return;
    nurseHubRedirectStarted.current = true;
    router.replace("/reception");
  }, [loading, role, pathname, router]);

  const showAdminConsoleLink =
    role !== "nurse" && rawRoleHasAdminPrivileges(roleRaw) && r === "doctor";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading workspace…
      </div>
    );
  }

  if (role === "nurse" && isDashboardHubRoot(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Opening reception…
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
