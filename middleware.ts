import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { DashboardRoleRouting } from "./app/lib/dashboardRoleRouting";
import {
  fetchEffectiveRoleRawFromDb,
  isPathAllowedByPrefixes,
  normalizeDashboardRoleKey,
  nurseDashboardRouting,
  resolveDashboardRoutingFromRoleRaw,
} from "./app/lib/dashboardRoleRouting";
import { rawRoleHasAdminPrivileges } from "./app/lib/userRole";

const PROTECTED_PREFIXES = ["/dashboard", "/pharmacy", "/admin"] as const;

/** Never run RBAC redirects on these (login, OAuth, email confirm). */
function isPublicAuthPath(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (p === "" || p === "/") return true;
  if (p === "/login") return true;
  if (p === "/auth" || p.startsWith("/auth/")) return true;
  return false;
}

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/reception" || pathname.startsWith("/reception/")) return true;
  if (pathname === "/opd" || pathname.startsWith("/opd/")) return true;
  if (pathname === "/billing" || pathname.startsWith("/billing/")) return true;
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (isPublicAuthPath(pathname)) {
    return NextResponse.next({ request });
  }

  if (!isProtectedPath(pathname)) {
    return response;
  }

  if (!user) {
    const login = new URL("/", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  /** Canonical reception URL is `/reception` (see `app/(dashboard)/reception/page.tsx`). */
  if (pathname === "/dashboard/reception" || pathname.startsWith("/dashboard/reception/")) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/reception";
    return NextResponse.redirect(destination);
  }

  /** Standalone triage is deprecated; reception is the unified front-desk + queue workspace. */
  if (pathname === "/dashboard/triage" || pathname.startsWith("/dashboard/triage/")) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/reception";
    return NextResponse.redirect(destination);
  }

  const { effectiveRoleRaw: roleRaw } = await fetchEffectiveRoleRawFromDb(supabase, user.id);
  const roleKeyLower = normalizeDashboardRoleKey(roleRaw);

  let routing: DashboardRoleRouting;
  switch (roleKeyLower) {
    case "nurse":
    case "nursing":
    case "rn":
      routing = nurseDashboardRouting();
      break;
    default:
      routing = resolveDashboardRoutingFromRoleRaw(roleRaw);
      break;
  }

  const isAdminHubPath =
    pathname === "/dashboard/admin" ||
    pathname.startsWith("/dashboard/admin/") ||
    pathname === "/admin/dashboard" ||
    pathname.startsWith("/admin/dashboard/");
  if (isAdminHubPath && !rawRoleHasAdminPrivileges(roleRaw)) {
    const to = new URL(routing.homePath, request.url);
    return NextResponse.redirect(to);
  }

  const isDashboardRoot = pathname === "/dashboard" || pathname === "/dashboard/";

  if (isDashboardRoot) {
    const literalNurse =
      roleKeyLower === "nurse" || roleKeyLower === "nursing" || roleKeyLower === "rn";
    const hubTarget = literalNurse ? "/reception" : routing.homePath;
    if (hubTarget !== "/dashboard") {
      const to = new URL(hubTarget, request.url);
      return NextResponse.redirect(to);
    }
  }

  if (!isPathAllowedByPrefixes(pathname, routing.allowedPrefixes)) {
    const to = new URL(routing.homePath, request.url);
    return NextResponse.redirect(to);
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  /**
   * Public auth routes must be matched so middleware can skip RBAC (otherwise a broad matcher could block them).
   * Protected app areas still run session + role checks below.
   */
  matcher: [
    "/",
    "/login",
    "/auth",
    "/auth/:path*",
    "/dashboard/:path*",
    "/pharmacy/:path*",
    "/admin",
    "/admin/:path*",
    "/billing",
    "/billing/:path*",
  ],
};
