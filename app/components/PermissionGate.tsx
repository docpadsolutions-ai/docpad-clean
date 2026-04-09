"use client";

import type { ReactNode } from "react";
import { usePermission } from "../hooks/usePermission";

const VIEW_ONLY_TITLE = "View-only access for your role.";

export type PermissionSurfaceProps = {
  viewAllowed: boolean;
  editAllowed: boolean;
  loading: boolean;
  children: ReactNode;
  /**
   * When the user may view but not edit: `fieldset` keeps content visible with native disabled controls;
   * `hide` removes the subtree (after load).
   */
  presentationWhenViewOnly?: "fieldset" | "hide";
  deniedTitle?: string;
  /** Shown when the user has neither view nor edit (e.g. access denied message). */
  deniedFallback?: ReactNode;
};

/**
 * Precomputed view/edit flags — use with a single `usePermission()` on the page to avoid duplicate fetches.
 */
export function PermissionSurface({
  viewAllowed,
  editAllowed,
  loading,
  children,
  presentationWhenViewOnly = "hide",
  deniedTitle = VIEW_ONLY_TITLE,
  deniedFallback = null,
}: PermissionSurfaceProps) {
  if (loading) return null;
  if (editAllowed) return <>{children}</>;
  if (viewAllowed && presentationWhenViewOnly === "fieldset") {
    return (
      <div className="relative">
        <span
          className="pointer-events-none absolute right-2 top-2 z-10 select-none text-sm text-gray-400"
          title={deniedTitle}
          aria-hidden
        >
          🔒
        </span>
        <fieldset disabled className="min-w-0 border-0 p-0 disabled:opacity-[0.88]">
          <legend className="sr-only">View-only section</legend>
          {children}
        </fieldset>
      </div>
    );
  }
  if (deniedFallback != null) return <>{deniedFallback}</>;
  return null;
}

export type PermissionGateProps = {
  permission: string;
  children: ReactNode;
  /**
   * `disabled`: view-only fieldset when the user has view but not edit.
   * Otherwise pass a React node to show when access is denied entirely.
   */
  fallback?: ReactNode | "disabled";
  deniedTitle?: string;
};

export function PermissionGate({
  permission,
  children,
  fallback,
  deniedTitle = VIEW_ONLY_TITLE,
}: PermissionGateProps) {
  const { hasPermission, loading } = usePermission();
  const viewAllowed = !loading && hasPermission(permission, "view");
  const editAllowed = !loading && hasPermission(permission, "edit");
  const presentationWhenViewOnly = fallback === "disabled" ? "fieldset" : "hide";
  const deniedFallback =
    fallback !== undefined && fallback !== "disabled" ? fallback : null;

  return (
    <PermissionSurface
      viewAllowed={viewAllowed}
      editAllowed={editAllowed}
      loading={loading}
      presentationWhenViewOnly={presentationWhenViewOnly}
      deniedTitle={deniedTitle}
      deniedFallback={deniedFallback}
    >
      {children}
    </PermissionSurface>
  );
}
