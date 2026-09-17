"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  cellAccentForScore,
  chipClassesForScore,
  componentsToColumnCells,
  statusLabelFromScore,
  type MewsColumnKey,
} from "./mewsVitalsCardUtils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type VitalRow = {
  recorded_at: string;
  mews_score: number;
  mews_alert_level: string | null;
  mews_components: unknown;
};

const COL_ORDER: MewsColumnKey[] = ["rr", "spo2", "temp", "sbp", "hr", "avpu"];

function dotBgForAlert(level: string | null | undefined): string {
  const x = (level ?? "").toLowerCase();
  if (x === "critical") return "bg-rose-800";
  if (x === "escalate") return "bg-amber-600";
  if (x === "normal") return "bg-emerald-700";
  return "bg-slate-500";
}

function formatRecordedSubtitle(iso: string): string {
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return format(d, "HH:mm, dd MMM");
  } catch {
    return "—";
  }
}

function formatDotTooltip(iso: string, score: number): string {
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return `MEWS ${score}`;
    const t = format(d, "HH:mm");
    return `MEWS ${score} · ${t}`;
  } catch {
    return `MEWS ${score}`;
  }
}

function VitalReadingDots({
  vitals,
  selectedVitalIndex,
  onSelect,
}: {
  vitals: VitalRow[];
  selectedVitalIndex: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div
      className="mt-2 flex flex-wrap justify-center gap-1.5"
      role="group"
      aria-label="Select recorded reading"
    >
      {vitals.map((r, i) => {
        const selected = i === selectedVitalIndex;
        const base = dotBgForAlert(r.mews_alert_level);
        const size = selected ? "h-3.5 w-3.5" : "h-2.5 w-2.5";
        const ring = selected
          ? "ring-2 ring-white ring-offset-2 ring-offset-white"
          : "ring-1 ring-slate-300";
        return (
          <button
            key={`${r.recorded_at}-${i}`}
            type="button"
            title={formatDotTooltip(r.recorded_at, r.mews_score)}
            aria-pressed={selected}
            aria-label={`Reading ${i + 1} of ${vitals.length}, MEWS ${r.mews_score}`}
            onClick={() => onSelect(i)}
            className={`inline-block shrink-0 rounded-full transition-transform ${base} ${size} ${ring} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400`}
          />
        );
      })}
    </div>
  );
}

export default function MewsVitalsCard({ admissionId }: { admissionId: string }) {
  const [vitals, setVitals] = useState<VitalRow[]>([]);
  const [selectedVitalIndex, setSelectedVitalIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = s(admissionId);
    if (!id) {
      setVitals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("ipd_nursing_vitals")
      .select("recorded_at, mews_score, mews_alert_level, mews_components")
      .eq("admission_id", id)
      .not("mews_score", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(5);

    setLoading(false);
    if (error) {
      setErr(error.message);
      setVitals([]);
      return;
    }
    const list = Array.isArray(data) ? data : [];
    const parsed: VitalRow[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const ra = s(o.recorded_at);
      const ms = o.mews_score;
      const score = typeof ms === "number" ? ms : ms != null ? Number(ms) : NaN;
      if (!ra || !Number.isFinite(score)) continue;
      parsed.push({
        recorded_at: ra,
        mews_score: score,
        mews_alert_level: o.mews_alert_level != null ? String(o.mews_alert_level) : null,
        mews_components: o.mews_components ?? [],
      });
    }
    setVitals(parsed);
  }, [admissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedVitalIndex(0);
  }, [admissionId]);

  useEffect(() => {
    setSelectedVitalIndex((i) => {
      if (vitals.length === 0) return 0;
      return Math.min(i, vitals.length - 1);
    });
  }, [vitals.length]);

  const selectedRow = vitals[selectedVitalIndex] ?? null;

  const cells = useMemo(() => {
    if (!selectedRow) return null;
    return componentsToColumnCells(selectedRow.mews_components);
  }, [selectedRow]);

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-md dark:border-slate-300 dark:bg-white">
        <div className="h-28 w-full animate-pulse bg-slate-200" />
        <div className="overflow-x-auto border-t border-slate-200">
          <div className="grid min-w-[720px] grid-cols-6 gap-px bg-slate-200 p-0">
            {COL_ORDER.map((k) => (
              <div key={k} className="h-24 animate-pulse bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-2xl border border-red-600 bg-white px-4 py-3 text-sm font-medium text-red-800 dark:border-red-600 dark:bg-white dark:text-red-800">
        {err}
      </div>
    );
  }

  if (!selectedRow || !cells) {
    return (
      <div className="rounded-2xl border border-slate-300 bg-white px-4 py-8 text-center text-sm font-medium text-slate-600 dark:border-slate-300 dark:bg-white dark:text-slate-600">
        No vitals recorded yet
      </div>
    );
  }

  const score = selectedRow.mews_score;
  const { title: statusTitle, band } = statusLabelFromScore(score);
  const timeStr = formatRecordedSubtitle(selectedRow.recorded_at);

  const bannerClass =
    band === "critical"
      ? "border-b border-rose-900/80 bg-rose-800 text-white"
      : band === "escalate"
        ? "border-b border-amber-800/80 bg-amber-700 text-white"
        : "border-b border-emerald-800/80 bg-emerald-700 text-white";

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-md dark:border-slate-300 dark:bg-white">
      {/* Score banner — solid fills, light-mode readable in both themes */}
      <div className={`flex w-full items-start gap-4 px-4 py-4 ${bannerClass}`}>
        <span className="text-5xl font-bold tabular-nums leading-none tracking-tight text-white">{score}</span>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-white">{statusTitle}</span>
            {band === "critical" ? (
              <span className="relative flex h-3 w-3" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-90" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-white ring-2 ring-rose-950" />
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-medium text-white/90">
            MEWS score · recorded {timeStr || "—"}
          </p>
        </div>
      </div>

      {/* Parameter row — six fixed columns; scroll on narrow viewports */}
      <div className="overflow-x-auto border-b border-slate-200">
        <div className="grid min-w-[720px] grid-cols-6 gap-px bg-slate-200">
          {COL_ORDER.map((key) => {
            const c = cells[key];
            return (
              <div
                key={key}
                className={`flex min-h-[5.5rem] flex-col justify-between bg-white p-2 dark:bg-white ${cellAccentForScore(c.score)}`}
              >
                <p className="text-[12px] font-medium text-slate-600">{c.label}</p>
                <p className="text-base font-bold leading-tight text-slate-900">{c.value}</p>
                <div className="mt-1 flex justify-end">
                  <span
                    className={`inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${chipClassesForScore(c.score)}`}
                  >
                    {c.score}
                  </span>
                </div>
                <VitalReadingDots
                  vitals={vitals}
                  selectedVitalIndex={selectedVitalIndex}
                  onSelect={setSelectedVitalIndex}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
