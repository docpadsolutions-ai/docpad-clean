"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../supabase";

export type PatientLatestVitalsRow = {
  patient_id: string;
  created_at: string | null;
  weight: string | number | null;
  bp: string | number | null;
  pulse: string | number | null;
  temp: string | number | null;
  spo2: string | number | null;
};

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

/** Prefer °F display; numeric 30–50 treated as °C. */
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

function formatRecordedRelative(iso: string | null): string | null {
  if (!iso?.trim()) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffSec / 3600);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  const diffDay = Math.round(diffSec / 86400);
  if (Math.abs(diffDay) < 7) return rtf.format(diffDay, "day");
  const diffWeek = Math.round(diffSec / (86400 * 7));
  if (Math.abs(diffWeek) < 5) return rtf.format(diffWeek, "week");
  const diffMonth = Math.round(diffSec / (86400 * 30));
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}

const ROWS: { key: keyof Pick<PatientLatestVitalsRow, "bp" | "pulse" | "temp" | "spo2" | "weight">; label: string; fmt: (v: string | number) => string }[] = [
  { key: "bp", label: "BP", fmt: formatBp },
  { key: "pulse", label: "Pulse", fmt: formatPulse },
  { key: "temp", label: "Temp", fmt: formatTemp },
  { key: "spo2", label: "SpO2", fmt: formatSpo2 },
  { key: "weight", label: "Weight", fmt: formatWeight },
];

export default function VitalsWidget({
  patientId,
  reloadToken,
  onNavigate,
}: {
  patientId: string;
  reloadToken?: number | string;
  /** When set, "+ Record Vitals" calls `onNavigate("triage", { patientId })` (e.g. summary shell). */
  onNavigate?: (view: string, params?: Record<string, unknown>) => void;
}) {
  const router = useRouter();
  const [row, setRow] = useState<PatientLatestVitalsRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relativeTick, setRelativeTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setRelativeTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
      setError(qErr.message);
      setRow(null);
      return;
    }
    setRow((data as PatientLatestVitalsRow | null) ?? null);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const hasAnyVital =
    row &&
    ROWS.some(({ key }) => {
      const v = row[key];
      return hasText(v);
    });

  const relative = useMemo(
    () => formatRecordedRelative(row?.created_at ?? null),
    [row?.created_at, relativeTick],
  );

  const goRecordVitals = useCallback(() => {
    const pid = patientId?.trim() ?? "";
    const params = pid ? { patientId: pid } : undefined;
    if (onNavigate) {
      onNavigate("triage", params);
      return;
    }
    router.push(pid ? `/reception?patientId=${encodeURIComponent(pid)}` : "/reception");
  }, [onNavigate, patientId, router]);

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="border-b border-gray-100 pb-3 text-sm font-bold text-gray-900">Latest vitals</h3>

      {error ? (
        <p role="alert" className="mt-4 text-center text-sm text-red-600">
          {error}
        </p>
      ) : loading ? (
        <ul className="mt-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <li key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </ul>
      ) : !row || !hasAnyVital ? (
        <div className="mt-4 py-4 text-center">
          <p className="text-sm text-gray-500">No vitals recorded yet</p>
          <p className="mx-auto mt-1 max-w-[280px] text-xs leading-relaxed text-gray-500">
            Vitals are recorded by nursing during triage
          </p>
          <button
            type="button"
            onClick={goRecordVitals}
            className="mt-3 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
          >
            + Record Vitals
          </button>
        </div>
      ) : (
        <>
          <dl className="mt-4 space-y-2 text-sm">
            {ROWS.map(({ key, label, fmt }) => {
              const raw = row[key];
              const show = hasText(raw);
              return (
                <div
                  key={key}
                  className="flex justify-between gap-3 border-b border-gray-50 pb-2 last:border-0"
                >
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-900">{show ? fmt(raw as string | number) : "—"}</dd>
                </div>
              );
            })}
          </dl>
          {relative ? (
            <p className="mt-3 border-t border-gray-100 pt-3 text-center text-xs text-gray-500">
              Recorded {relative}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
