"use client";

import { useMemo } from "react";
import { abnormalFlagsForIpdNursingVitalsRow } from "@/lib/ipdNursingVitalsRanges";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export type IpdNursingVitalsTimelineRow = Record<string, unknown> & {
  id?: unknown;
  recorded_at?: unknown;
  blood_pressure?: unknown;
  pulse?: unknown;
  temperature?: unknown;
  spo2?: unknown;
  respiratory_rate?: unknown;
  pain_score?: unknown;
  urine_output?: unknown;
  gcs_score?: unknown;
  notes?: unknown;
  recorded_by?: unknown;
  practitioners?: unknown;
};

function recorderNameFromRow(row: IpdNursingVitalsTimelineRow): string {
  const emb = row.practitioners;
  if (emb && typeof emb === "object" && !Array.isArray(emb)) {
    const n = s((emb as Record<string, unknown>).full_name);
    if (n) return n;
  }
  if (Array.isArray(emb) && emb[0] && typeof emb[0] === "object") {
    const n = s((emb[0] as Record<string, unknown>).full_name);
    if (n) return n;
  }
  return "—";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtNum(n: number | null, decimals = 0): string {
  if (n == null) return "—";
  if (decimals > 0) return n.toFixed(decimals);
  return String(Math.round(n));
}

type CellProps = { abnormal: boolean; tone?: "amber" | "red"; children: string };

function VitalCell({ abnormal, tone = "amber", children }: CellProps) {
  return (
    <span
      className={cn(
        "tabular-nums",
        abnormal
          ? tone === "red"
            ? "rounded px-1 font-semibold text-red-800 ring-1 ring-red-200/90"
            : "rounded px-1 font-semibold text-amber-800 ring-1 ring-amber-200/90"
          : "text-gray-900",
      )}
    >
      {children}
    </span>
  );
}

export default function IpdNursingVitalsTimeline({ rows }: { rows: IpdNursingVitalsTimelineRow[] }) {
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ta = Date.parse(s(a.recorded_at));
      const tb = Date.parse(s(b.recorded_at));
      return tb - ta;
    });
  }, [rows]);

  if (sorted.length === 0) {
    return <p className="text-sm text-gray-500">No vitals for this day.</p>;
  }

  return (
    <ul className="space-y-2">
      {sorted.map((row) => {
        const id = s(row.id);
        const recAt = s(row.recorded_at);
        const flags = abnormalFlagsForIpdNursingVitalsRow(row);
        const bpText = s(row.blood_pressure) || "—";
        const pulse = num(row.pulse);
        const temp = num(row.temperature);
        const spo2 = num(row.spo2);
        const rr = num(row.respiratory_rate);
        const pain = num(row.pain_score);
        const urine = num(row.urine_output);
        const gcs = num(row.gcs_score);
        const note = s(row.notes);
        const by = recorderNameFromRow(row);

        return (
          <li key={id || recAt} className="rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] leading-snug">
              <span className="font-semibold text-gray-900 tabular-nums">{fmtTime(recAt)}</span>
              <span className="text-gray-500">
                BP <VitalCell abnormal={flags.bp} tone="red">
                  {bpText}
                </VitalCell>
              </span>
              <span className="text-gray-500">
                Pulse <VitalCell abnormal={flags.pulse}>{fmtNum(pulse)}</VitalCell>
              </span>
              <span className="text-gray-500">
                Temp <VitalCell abnormal={flags.temp}>{temp != null ? `${temp.toFixed(1)}°C` : "—"}</VitalCell>
              </span>
              <span className="text-gray-500">
                SpO₂{" "}
                <VitalCell abnormal={flags.spo2} tone="red">
                  {`${fmtNum(spo2)}%`}
                </VitalCell>
              </span>
              <span className="text-gray-500">
                RR <VitalCell abnormal={flags.rr}>{fmtNum(rr)}</VitalCell>
              </span>
            </div>
            <p className="mt-2 text-[11px] text-gray-600">
              Recorded by: <span className="font-medium text-gray-800">{by}</span>
            </p>
            {(() => {
              const extra: string[] = [];
              if (pain != null) extra.push(`Pain ${Math.round(pain)}/10`);
              if (urine != null) extra.push(`Urine ${Math.round(urine)} ml`);
              if (gcs != null) extra.push(`GCS ${Math.round(gcs)}`);
              if (extra.length === 0) return null;
              return <p className="mt-1 text-[11px] text-gray-500">{extra.join(" · ")}</p>;
            })()}
            {note ? <p className="mt-2 whitespace-pre-wrap text-[11px] text-gray-700">{note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
