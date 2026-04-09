"use client";

import type { PatientQueueVitals } from "../lib/patientQueueData";

export type PatientQueueCardStatus = "waiting" | "draft" | "in_progress";

function formatVitalsLine(v: PatientQueueVitals): string {
  const parts: string[] = [];
  if (v.blood_pressure?.trim()) parts.push(`BP ${v.blood_pressure.trim()}`);
  if (v.pulse?.trim()) parts.push(`P ${v.pulse.trim()}`);
  if (v.weight?.trim()) parts.push(`Wt ${v.weight.trim()} kg`);
  if (v.temperature?.trim()) parts.push(`T ${v.temperature.trim()}°F`);
  if (v.spo2?.trim()) parts.push(`SpO₂ ${v.spo2.trim()}%`);
  return parts.length ? parts.join(" · ") : "—";
}

function statusBadge(status: PatientQueueCardStatus): { label: string; className: string } {
  switch (status) {
    case "waiting":
      return { label: "Waiting", className: "bg-amber-100 text-amber-900 ring-amber-200/80" };
    case "draft":
      return { label: "Draft", className: "bg-slate-200 text-slate-800 ring-slate-300/80" };
    case "in_progress":
      return {
        label: "In progress",
        className: "bg-violet-100 text-violet-900 ring-violet-200/80",
      };
    default:
      return { label: status, className: "bg-slate-100 text-slate-700" };
  }
}

export type PatientQueueCardProps = {
  patientName: string;
  vitals: PatientQueueVitals;
  chiefComplaint?: string;
  status: PatientQueueCardStatus;
  onClick: () => void;
  disabled?: boolean;
  /** Shown under the name (e.g. age/sex or time). */
  meta?: string;
  /** Footer CTA line */
  actionHint?: string;
};

export default function PatientQueueCard({
  patientName,
  vitals,
  chiefComplaint,
  status,
  onClick,
  disabled,
  meta,
  actionHint,
}: PatientQueueCardProps) {
  const badge = statusBadge(status);
  const vitalsLine = formatVitalsLine(vitals);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{patientName}</p>
          {meta ? <p className="mt-0.5 text-xs text-slate-500">{meta}</p> : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-700">
        <span className="font-medium text-slate-800">Vitals:</span>{" "}
        <span className="text-slate-600">{vitalsLine}</span>
      </p>

      {chiefComplaint?.trim() ? (
        <p className="mt-2 line-clamp-2 text-sm text-slate-700">
          <span className="font-medium text-slate-800">Chief complaint:</span> {chiefComplaint.trim()}
        </p>
      ) : null}

      {actionHint ? (
        <p className="mt-3 text-xs font-semibold text-blue-600">{actionHint}</p>
      ) : null}
    </button>
  );
}
