"use client";

import { useCallback, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

const severitySurface: Record<
  AlertSeverity,
  { panel: string; title: string; body: string; ring: string }
> = {
  critical: {
    panel:
      "bg-gradient-to-br from-red-950/[0.12] via-red-50 to-rose-100/95 text-red-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35)]",
    title: "text-red-950",
    body: "text-red-900/90",
    ring: "border-red-600",
  },
  high: {
    panel: "bg-gradient-to-r from-orange-50 to-amber-50 text-orange-950",
    title: "text-orange-950",
    body: "text-orange-900/95",
    ring: "border-orange-400",
  },
  medium: {
    panel: "bg-amber-50 text-amber-950",
    title: "text-amber-950",
    body: "text-amber-900/95",
    ring: "border-amber-400",
  },
  low: {
    panel: "bg-slate-50 text-slate-800",
    title: "text-slate-900",
    body: "text-slate-700",
    ring: "border-slate-300",
  },
};

export function AlertBanner({
  severity,
  title,
  body,
  action,
  onDismiss,
  className,
}: {
  severity: AlertSeverity;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const s = severitySurface[severity];
  const isCritical = severity === "critical";

  const handleDismissClick = useCallback(() => {
    if (!onDismiss) return;
    if (isCritical) {
      setConfirmDismiss((v) => !v);
      return;
    }
    onDismiss();
  }, [isCritical, onDismiss]);

  const cancelDismiss = useCallback(() => setConfirmDismiss(false), []);

  const confirmDismissAction = useCallback(() => {
    onDismiss?.();
    setConfirmDismiss(false);
  }, [onDismiss]);

  return (
    <div
      role="alert"
      className={cn(
        "relative rounded-xl border-2 px-4 py-3 pr-11 shadow-sm",
        s.panel,
        s.ring,
        isCritical && "alert-banner-critical-pulse",
        className,
      )}
    >
      {onDismiss ? (
        <button
          type="button"
          onClick={handleDismissClick}
          className={cn(
            "absolute right-2 top-2 rounded-md p-1.5 opacity-90 transition hover:bg-black/5",
            isCritical && "text-red-900 hover:bg-red-950/10",
            !isCritical && "text-current hover:bg-black/5",
          )}
          aria-expanded={isCritical ? confirmDismiss : undefined}
          aria-label={isCritical && confirmDismiss ? "Close dismiss options" : "Dismiss alert"}
        >
          <X className="h-4 w-4 shrink-0" strokeWidth={2} />
        </button>
      ) : null}

      <div className="min-w-0">
        <p className={cn("text-sm font-bold leading-snug", s.title)}>{title}</p>
        {body != null && body !== "" ? (
          <div className={cn("mt-1 text-sm leading-relaxed", s.body)}>{body}</div>
        ) : null}
        {action ? <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>

      {isCritical && confirmDismiss && onDismiss ? (
        <div
          className="mt-3 border-t border-red-800/20 pt-3"
          role="group"
          aria-label="Confirm dismiss critical alert"
        >
          <p className="text-xs font-semibold text-red-950">
            Critical safety alerts require explicit confirmation before they can be dismissed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={cancelDismiss}
              className="rounded-lg border border-red-900/25 bg-white/80 px-3 py-1.5 text-xs font-semibold text-red-950 shadow-sm hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDismissAction}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-800"
            >
              Yes, dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
