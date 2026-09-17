"use client";

import { cn } from "@/lib/utils";
import type { InvestigationResultPill } from "@/app/lib/investigationsUi";

const PILL: Record<
  InvestigationResultPill,
  { label: string; className: string }
> = {
  critical: {
    label: "CRITICAL",
    className: "border-red-400 bg-red-600 text-white shadow-sm",
  },
  high: {
    label: "HIGH",
    className: "border-orange-400 bg-orange-500 text-white shadow-sm",
  },
  abnormal: {
    label: "ABNORMAL",
    className: "border-amber-400 bg-amber-100 text-amber-950",
  },
  normal: {
    label: "NORMAL",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
};

export default function InvestigationResultSeverityBadge({
  pill,
  className,
}: {
  pill: InvestigationResultPill;
  className?: string;
}) {
  const cfg = PILL[pill];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
        cfg.className,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}
