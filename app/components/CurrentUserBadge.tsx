"use client";

import { useEffect, useState } from "react";
import {
  practitionerDisplayNameFromRow,
  practitionerRoleRawFromRow,
  practitionersOrFilterForAuthUid,
} from "@/app/lib/practitionerAuthLookup";
import { personInitialsDisplay } from "@/app/lib/personInitialsDisplay";
import { formatPractitionerRoleDisplay } from "@/app/lib/practitionerRoleDisplay";
import { supabase } from "@/app/supabase";
import { cn } from "@/lib/utils";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function initialsFromName(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0].match(/[A-Za-z0-9]/);
    const b = parts[parts.length - 1].match(/[A-Za-z0-9]/);
    if (a && b) return personInitialsDisplay(a[0] + b[0]);
  }
  const m = t.match(/[A-Za-z0-9]/g);
  if (m && m.length >= 2) return personInitialsDisplay(m[0] + m[1]);
  return personInitialsDisplay(t.slice(0, 2));
}

type BadgeTone = "default" | "onDark";

type State =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; displayName: string; roleLabel: string };

/** Colored pill for formatted role label (default / light UI). */
function rolePillClass(roleLabel: string, tone: BadgeTone): string {
  const k = roleLabel.toLowerCase();
  const base =
    "inline-flex max-w-full shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ring-1";
  if (tone === "onDark") {
    if (k.includes("admin"))
      return cn(base, "bg-violet-500/25 text-violet-100 ring-violet-400/35");
    if (k.includes("doctor")) return cn(base, "bg-sky-500/25 text-sky-100 ring-sky-400/35");
    if (k.includes("nurse")) return cn(base, "bg-emerald-500/25 text-emerald-100 ring-emerald-400/35");
    if (k.includes("reception")) return cn(base, "bg-amber-500/25 text-amber-100 ring-amber-400/35");
    if (k.includes("pharmac")) return cn(base, "bg-cyan-500/25 text-cyan-100 ring-cyan-400/35");
    if (k.includes("lab")) return cn(base, "bg-orange-500/25 text-orange-100 ring-orange-400/35");
    return cn(base, "bg-slate-500/30 text-slate-100 ring-slate-400/35");
  }
  if (k.includes("admin"))
    return cn(base, "bg-violet-100 text-violet-900 ring-violet-200/90");
  if (k.includes("doctor")) return cn(base, "bg-sky-100 text-sky-900 ring-sky-200/90");
  if (k.includes("nurse")) return cn(base, "bg-emerald-100 text-emerald-900 ring-emerald-200/90");
  if (k.includes("reception")) return cn(base, "bg-amber-100 text-amber-950 ring-amber-200/90");
  if (k.includes("pharmac")) return cn(base, "bg-cyan-100 text-cyan-900 ring-cyan-200/90");
  if (k.includes("lab")) return cn(base, "bg-orange-100 text-orange-900 ring-orange-200/90");
  return cn(base, "bg-slate-100 text-slate-800 ring-slate-200/90");
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    const t = str(v);
    if (t) return t;
  }
  return "";
}

export function CurrentUserBadge({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: BadgeTone;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        if (!cancelled) setState({ status: "empty" });
        return;
      }
      const uid = user.id;

      const profRes = await supabase
        .from("profiles")
        .select("full_name, display_name, role")
        .eq("id", uid)
        .maybeSingle();

      if (!cancelled && !profRes.error && profRes.data) {
        const r = profRes.data as Record<string, unknown>;
        const displayName =
          str(r.display_name) ||
          str(r.full_name) ||
          str(user.user_metadata?.full_name) ||
          user.email?.split("@")[0] ||
          "User";
        const meta = user.user_metadata as { role?: unknown; app_role?: unknown } | undefined;
        const rawRole = firstNonEmpty(r.role, meta?.role, meta?.app_role);
        const roleLabel = rawRole
          ? formatPractitionerRoleDisplay(rawRole)
          : formatPractitionerRoleDisplay(
              str((user.user_metadata as { app_role?: unknown })?.app_role) || "staff",
            );
        setState({ status: "ready", displayName, roleLabel });
        return;
      }

      const { data: pr, error: prErr } = await supabase
        .from("practitioners")
        .select("full_name, first_name, last_name, role, user_role, sub_role")
        .or(practitionersOrFilterForAuthUid(uid))
        .maybeSingle();

      if (cancelled) return;

      if (prErr || !pr) {
        const metaName = str(user.user_metadata?.full_name);
        const displayName = metaName || user.email?.split("@")[0] || "User";
        const meta = user.user_metadata as { role?: unknown; app_role?: unknown } | undefined;
        const rawRole = firstNonEmpty(meta?.role, meta?.app_role);
        const roleLabel = rawRole
          ? formatPractitionerRoleDisplay(rawRole)
          : formatPractitionerRoleDisplay("staff");
        setState({ status: "ready", displayName, roleLabel });
        return;
      }

      const displayName =
        practitionerDisplayNameFromRow(
          pr as { full_name?: unknown; first_name?: unknown; last_name?: unknown },
        ) ||
        str(user.user_metadata?.full_name) ||
        user.email?.split("@")[0] ||
        "User";

      const raw =
        practitionerRoleRawFromRow(pr as { user_role?: unknown; role?: unknown }) ||
        firstNonEmpty(
          (user.user_metadata as { role?: unknown })?.role,
          (user.user_metadata as { app_role?: unknown })?.app_role,
        );
      const roleLabel = raw
        ? formatPractitionerRoleDisplay(raw)
        : formatPractitionerRoleDisplay("staff");

      setState({ status: "ready", displayName, roleLabel });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toneCls =
    tone === "onDark"
      ? {
          circle: "bg-slate-700 text-slate-100",
          name: "text-slate-100",
          skeleton: "bg-slate-700",
        }
      : {
          circle: "bg-slate-200 text-slate-800",
          name: "text-slate-900",
          skeleton: "bg-slate-200",
        };

  if (state.status === "loading") {
    return (
      <div className={cn("flex items-center gap-2.5", className)} aria-hidden>
        <div className={cn("h-8 w-8 animate-pulse rounded-full", toneCls.skeleton)} />
        <div className="hidden min-w-[10rem] space-y-1 sm:block">
          <div className={cn("h-3.5 w-32 animate-pulse rounded", toneCls.skeleton)} />
        </div>
      </div>
    );
  }

  if (state.status === "empty") {
    return null;
  }

  const { displayName, roleLabel } = state;
  const initial = initialsFromName(displayName);
  const title = `${displayName} · ${roleLabel}`;

  return (
    <div
      className={cn("flex max-w-[min(100%,26rem)] items-center gap-2.5", className)}
      title={title}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          toneCls.circle,
        )}
        aria-hidden
      >
        {initial}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <span className={cn("truncate text-sm font-medium", toneCls.name)}>{displayName}</span>
        <span className={rolePillClass(roleLabel, tone)}>{roleLabel}</span>
      </div>
    </div>
  );
}
