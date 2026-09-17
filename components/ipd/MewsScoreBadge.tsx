"use client";

import { useMemo, useState } from "react";
import { Bell, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/utils";
import { mewsLabelFromScore, type MewsComponentRow } from "./mewsTypes";

function levelFromInputs(
  score: number | null | undefined,
  alertLevel: string | null | undefined,
): "normal" | "escalate" | "critical" | "empty" {
  if (score == null || Number.isNaN(score)) return "empty";
  const a = (alertLevel ?? "").toLowerCase().trim();
  if (a === "normal" || a === "escalate" || a === "critical") return a;
  return mewsLabelFromScore(score);
}

export function MewsScoreBadge({
  score,
  alertLevel,
  components,
  expandable = false,
  className,
}: {
  score: number | null | undefined;
  alertLevel: string | null | undefined;
  components?: MewsComponentRow[] | null;
  expandable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const level = levelFromInputs(score, alertLevel);
  const labelText = useMemo(() => {
    if (level === "empty") return "MEWS —";
    const n = score ?? 0;
    if (level === "normal") return `MEWS: ${n} — Normal`;
    if (level === "escalate") return `MEWS: ${n} — Escalate`;
    return `MEWS: ${n} — Call RRT`;
  }, [level, score]);

  const pill = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums",
        level === "empty" && "border-slate-200 bg-slate-50 text-slate-600",
        level === "normal" && "border-emerald-200 bg-emerald-50 text-emerald-900",
        level === "escalate" && "border-amber-300 bg-amber-50 text-amber-950",
        level === "critical" &&
          "animate-pulse border-red-300 bg-red-50 text-red-900 shadow-sm shadow-red-200/60",
        expandable && level !== "empty" && "cursor-pointer select-none hover:opacity-95",
        className,
      )}
      onClick={expandable && level !== "empty" ? () => setOpen((o) => !o) : undefined}
      role={expandable && level !== "empty" ? "button" : undefined}
      tabIndex={expandable && level !== "empty" ? 0 : undefined}
      onKeyDown={
        expandable && level !== "empty"
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen((o) => !o);
              }
            }
          : undefined
      }
    >
      {level === "critical" ? <Bell className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
      <span className="min-w-0 truncate">{labelText}</span>
      {expandable && level !== "empty" ? (
        open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        )
      ) : null}
    </span>
  );

  const table =
    open && expandable && components && components.length > 0 ? (
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm">
        <table className="w-full min-w-[280px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-slate-600">
              <th className="px-2 py-1.5 font-semibold">Parameter</th>
              <th className="px-2 py-1.5 font-semibold">Value</th>
              <th className="w-14 px-2 py-1.5 text-right font-semibold">Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {components.map((c, i) => (
              <tr key={`${c.parameter}-${i}`}>
                <td className="px-2 py-1">{c.parameter}</td>
                <td className="px-2 py-1 tabular-nums">{c.value}</td>
                <td className="px-2 py-1 text-right tabular-nums font-semibold">{c.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : null;

  return (
    <div className="w-full">
      {pill}
      {table}
    </div>
  );
}
