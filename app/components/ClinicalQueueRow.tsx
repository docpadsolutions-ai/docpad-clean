"use client";

import Link from "next/link";
import type { PatientQueueVitals } from "../lib/patientQueueData";

function formatVitalsLine(v: PatientQueueVitals): string {
  const parts: string[] = [];
  if (v.blood_pressure?.trim()) parts.push(`BP ${v.blood_pressure.trim()}`);
  if (v.pulse?.trim()) parts.push(`P ${v.pulse.trim()}`);
  if (v.weight?.trim()) parts.push(`Wt ${v.weight.trim()} kg`);
  if (v.temperature?.trim()) parts.push(`T ${v.temperature.trim()}°F`);
  if (v.spo2?.trim()) parts.push(`SpO₂ ${v.spo2.trim()}%`);
  return parts.length ? parts.join(" · ") : "—";
}

function displayToken(token: string | null | undefined): string {
  if (token == null || String(token).trim() === "") return "—";
  const t = String(token).trim();
  return t.startsWith("#") ? t : `#${t}`;
}

export type ClinicalQueueRowProps = {
  /** First column: time (waiting) or token (returning) */
  primaryColumn: string;
  patientName: string;
  patientMeta: string;
  vitals: PatientQueueVitals;
  chiefComplaint?: string;
  statusLabel: string;
  statusBadgeClassName: string;
  /** Optional e.g. Reception vs Direct OPD */
  sourceBadge?: { label: string; className: string };
  actionLabel: string;
  onClick: () => void;
  disabled?: boolean;
  /** Stops row click propagation (e.g. insurance card flow). */
  secondaryLink?: { href: string; label: string };
};

/**
 * Single queue table row — encapsulates all `<tr>` / `<td>` markup.
 */
export default function ClinicalQueueRow({
  primaryColumn,
  patientName,
  patientMeta,
  vitals,
  chiefComplaint,
  statusLabel,
  statusBadgeClassName,
  sourceBadge,
  actionLabel,
  onClick,
  disabled,
  secondaryLink,
}: ClinicalQueueRowProps) {
  const vitalsLine = formatVitalsLine(vitals);
  const cc = chiefComplaint?.trim() || "—";

  return (
    <tr
      className={`transition ${disabled ? "opacity-60" : "cursor-pointer hover:bg-slate-50/90"}`}
      onClick={disabled ? undefined : onClick}
      onKeyDown={
        disabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
      }
      tabIndex={disabled ? undefined : 0}
      role="button"
      aria-disabled={disabled || undefined}
    >
      <td className="whitespace-nowrap px-5 py-4 font-mono text-sm font-semibold text-slate-900 lg:px-6">
        {primaryColumn}
      </td>
      <td className="min-w-[160px] px-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900">{patientName}</p>
          {sourceBadge ? (
            <span
              className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${sourceBadge.className}`}
            >
              {sourceBadge.label}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">{patientMeta}</p>
        {secondaryLink ? (
          <Link
            href={secondaryLink.href}
            className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
            onClick={(e) => e.stopPropagation()}
          >
            {secondaryLink.label}
          </Link>
        ) : null}
      </td>
      <td className="max-w-[220px] px-3 py-4 text-sm text-slate-600">
        <span className="line-clamp-2">{vitalsLine}</span>
      </td>
      <td className="max-w-[200px] px-3 py-4 text-sm text-slate-600">
        <span className="line-clamp-2">{cc}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-4">
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusBadgeClassName}`}
        >
          {statusLabel}
        </span>
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-right lg:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm">
          {actionLabel}
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path
              d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </td>
    </tr>
  );
}

export { displayToken };
