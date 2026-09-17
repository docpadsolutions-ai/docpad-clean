"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Heart, Thermometer, Weight, Wind } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PatientLatestVitalsRow } from "@/components/patient-summary/vitals-widget";

function hasText(v: unknown): v is string | number {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.trim() !== "";
  return false;
}

function formatBp(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v.trim();
  if (/mmhg/i.test(s)) return s;
  return `${s} mmHg`;
}

function formatPulse(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v.trim();
  if (/bpm/i.test(s)) return s;
  return `${s} bpm`;
}

function formatTemp(v: string | number): string {
  if (typeof v === "string") {
    const t = v.trim();
    if (/[°CFcf]/.test(t)) return t;
    const n = Number(t);
    if (!Number.isFinite(n)) return t;
    return formatTemp(n);
  }
  if (v > 45) return `${v}°F`;
  const f = (v * 9) / 5 + 32;
  return `${f.toFixed(1)}°F`;
}

function formatSpo2(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v.trim();
  if (s.includes("%")) return s;
  return `${s}%`;
}

function formatWeight(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v.trim();
  if (/kg/i.test(s)) return s;
  return `${s} kg`;
}

function formatRecordedDate(iso: string | null): string {
  if (!iso?.trim()) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 16);
  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const VITAL_ROWS: {
  key: keyof Pick<PatientLatestVitalsRow, "bp" | "pulse" | "temp" | "spo2" | "weight">;
  label: string;
  fmt: (v: string | number) => string;
  icon: typeof Activity;
}[] = [
  { key: "bp", label: "BP", fmt: formatBp, icon: Activity },
  { key: "pulse", label: "Pulse", fmt: formatPulse, icon: Heart },
  { key: "temp", label: "Temp", fmt: formatTemp, icon: Thermometer },
  { key: "spo2", label: "SpO₂", fmt: formatSpo2, icon: Wind },
  { key: "weight", label: "Weight", fmt: formatWeight, icon: Weight },
];

/**
 * Full-width recent vitals strip for Patient Summary (uses `patient_latest_vitals` like {@link VitalsWidget}).
 */
export default function PatientSummaryRecentVitals({
  patientId,
  reloadToken,
}: {
  patientId: string;
  reloadToken?: number | string;
}) {
  const [row, setRow] = useState<PatientLatestVitalsRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const pid = patientId?.trim() ?? "";
    if (!pid) {
      setRow(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("patient_latest_vitals")
      .select("patient_id, created_at, weight, bp, pulse, temp, spo2")
      .eq("patient_id", pid)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    setLoading(false);
    if (qErr) {
      setError(qErr.message ?? "Failed to load vitals");
      setRow(null);
      return;
    }
    setRow((data as PatientLatestVitalsRow | null) ?? null);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const hasAny = useMemo(
    () =>
      row &&
      VITAL_ROWS.some(({ key }) => {
        const v = row[key];
        return hasText(v);
      }),
    [row],
  );

  const recorded = formatRecordedDate(row?.created_at ?? null);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-sm font-bold text-gray-900">Recent Vitals</h2>
      <p className="mt-0.5 text-xs text-gray-500">Latest recorded set for this patient</p>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error?.trim() ? error : "An unexpected error occurred"}
        </p>
      ) : loading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-busy>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : !row || !hasAny ? (
        <p className="mt-6 text-center text-sm text-gray-500">No vitals recorded yet.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {VITAL_ROWS.map(({ key, label, fmt, icon: Icon }) => {
              const raw = row[key];
              const show = hasText(raw);
              return (
                <div
                  key={key}
                  className="flex flex-col rounded-lg border border-gray-100 bg-slate-50/80 px-3 py-3"
                >
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    <Icon className="h-3.5 w-3.5 text-gray-400" strokeWidth={2} />
                    {label}
                  </div>
                  <p className="mt-2 text-lg font-semibold text-gray-900">{show ? fmt(raw as string | number) : "—"}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-center text-xs text-gray-500">Recorded {recorded}</p>
        </>
      )}
    </section>
  );
}
