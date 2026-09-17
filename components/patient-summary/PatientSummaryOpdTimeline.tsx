"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type EncounterDotKind = "opd" | "ipd" | "surgery" | "emergency" | "followup" | "external";

const KIND_META: Record<
  EncounterDotKind,
  { label: string; fill: string; ring: string }
> = {
  opd: { label: "OPD", fill: "#2563eb", ring: "#93c5fd" },
  ipd: { label: "IPD", fill: "#9333ea", ring: "#d8b4fe" },
  surgery: { label: "Surgery", fill: "#dc2626", ring: "#fecaca" },
  emergency: { label: "Emergency", fill: "#ea580c", ring: "#fdba74" },
  followup: { label: "Followup", fill: "#16a34a", ring: "#bbf7d0" },
  external: { label: "External", fill: "#9ca3af", ring: "#e5e7eb" },
};

type OpdEncRow = {
  id: string;
  encounter_date: string | null;
  created_at: string | null;
  chief_complaint: string | null;
  diagnosis_term: string | null;
  status: string | null;
};

function encounterTimestamp(r: OpdEncRow): number {
  const raw = (r.encounter_date ?? r.created_at ?? "").trim();
  const t = Date.parse(raw.length <= 10 ? `${raw}T12:00:00` : raw);
  return Number.isFinite(t) ? t : 0;
}

/** Heuristic — all rows are `opd_encounters`; kinds inferred from text until a dedicated column exists. */
export function inferEncounterDotKind(r: OpdEncRow): EncounterDotKind {
  const blob = `${r.chief_complaint ?? ""} ${r.diagnosis_term ?? ""} ${r.status ?? ""}`.toLowerCase();
  if (/\bexternal\b|outside hospital|referred from|other facility/.test(blob)) return "external";
  if (/\bfollow|f\/u\b|follow-up|review visit|routine review/.test(blob)) return "followup";
  if (/\bemergency|er\b|\bed\b|casualty/.test(blob)) return "emergency";
  if (/\bsurg|operat|post[\s-]?op|pre[\s-]?op|ot\b/.test(blob)) return "surgery";
  if (/\bipd|inpatient|admitted to ward|ward\b/.test(blob)) return "ipd";
  return "opd";
}

function formatAxisLabel(t: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function formatTooltipDate(t: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const HIT_R = 12;
const DOT_R = 5.5;

export default function PatientSummaryOpdTimeline({
  patientId,
  onSelectEncounterId,
}: {
  patientId: string;
  /** Scroll Encounter History to this encounter row */
  onSelectEncounterId?: (encounterId: string) => void;
}) {
  const [rows, setRows] = useState<OpdEncRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Scales horizontal chart width (wider = more spread for the same date span) */
  const [windowDays, setWindowDays] = useState(365);

  const [tooltip, setTooltip] = useState<{
    row: OpdEncRow;
    kind: EncounterDotKind;
    clientX: number;
    clientY: number;
  } | null>(null);

  const load = useCallback(async () => {
    const pid = patientId?.trim();
    if (!pid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("opd_encounters")
      .select("id, encounter_date, created_at, chief_complaint, diagnosis_term, status")
      .eq("patient_id", pid)
      .order("created_at", { ascending: false });

    setLoading(false);
    if (qErr) {
      setError(qErr.message ?? "Failed to load encounters");
      setRows([]);
      return;
    }
    setRows((data ?? []) as OpdEncRow[]);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const validRows = useMemo(() => rows.filter((r) => encounterTimestamp(r) > 0), [rows]);

  const sortedAsc = useMemo(() => {
    return [...validRows].sort((a, b) => encounterTimestamp(a) - encounterTimestamp(b));
  }, [validRows]);

  const { rangeStart, rangeEnd, span } = useMemo(() => {
    const endNow = Date.now();
    if (sortedAsc.length === 0) {
      return { rangeStart: endNow - 86400000, rangeEnd: endNow, span: 86400000 };
    }
    const times = sortedAsc.map(encounterTimestamp);
    const minT = Math.min(...times);
    const maxT = Math.max(endNow, ...times);
    return {
      rangeStart: minT,
      rangeEnd: maxT,
      span: Math.max(maxT - minT, 86400000),
    };
  }, [sortedAsc]);

  const padX = 32;
  const axisY = 22;
  const labelRow1Y = 48;
  const labelRow2Y = 62;
  const lineY = 84;
  const height = 132;
  const innerW = Math.max(480, Math.min(1200, 320 + Math.round((windowDays / 365) * 280)));
  const w = innerW;

  const zoomIn = () => setWindowDays((d) => Math.max(30, Math.round(d / 2)));
  const zoomOut = () => setWindowDays((d) => Math.min(1825, Math.round(d * 2)));
  const resetZoom = () => setWindowDays(365);

  const handleDotClick = (id: string) => {
    onSelectEncounterId?.(id);
    const el = document.getElementById(`encounter-history-row-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const moveTooltip = (e: ReactMouseEvent, row: OpdEncRow, kind: EncounterDotKind) => {
    setTooltip({ row, kind, clientX: e.clientX, clientY: e.clientY });
  };

  const hideTooltip = () => setTooltip(null);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Health Timeline</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {sortedAsc.length} encounter{sortedAsc.length === 1 ? "" : "s"} • Use zoom to spread the chart horizontally
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={zoomOut}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50"
            title="Zoom out (wider chart)"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
            title="Reset chart width"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50"
            title="Zoom in (narrower chart)"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : loading ? (
        <div className="h-36 animate-pulse rounded-lg bg-gray-100" aria-busy />
      ) : sortedAsc.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center text-sm text-gray-500">
          No OPD encounters with a valid date on record.
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-gray-100 bg-gradient-to-b from-slate-50 to-white pb-1 pt-1">
          <svg width={w} height={height} className="min-w-full" role="img" aria-label="Encounter timeline">
            <defs>
              <linearGradient id="ps-tl-line" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            </defs>
            <text x={padX} y={axisY} className="fill-gray-600" style={{ fontSize: 11 }}>
              {formatAxisLabel(rangeStart)}
            </text>
            <text x={w - padX} y={axisY} textAnchor="end" className="fill-gray-600" style={{ fontSize: 11 }}>
              {formatAxisLabel(rangeEnd)}
            </text>
            <line
              x1={padX}
              y1={lineY}
              x2={w - padX}
              y2={lineY}
              stroke="url(#ps-tl-line)"
              strokeWidth={3}
              strokeLinecap="round"
            />
            {sortedAsc.map((r) => {
              const t = encounterTimestamp(r);
              const frac = (t - rangeStart) / span;
              const cx = padX + frac * (w - padX * 2);
              const kind = inferEncounterDotKind(r);
              const colors = KIND_META[kind];
              const shortLabel =
                (r.chief_complaint ?? "").trim().slice(0, 22) ||
                (r.diagnosis_term ?? "").trim().slice(0, 22) ||
                "Visit";
              const displayShort = shortLabel.length >= 22 ? `${shortLabel.slice(0, 20)}…` : shortLabel;
              return (
                <g
                  key={r.id}
                  onMouseLeave={hideTooltip}
                  onBlur={hideTooltip}
                  style={{ outline: "none" }}
                >
                  <text
                    x={cx}
                    y={labelRow1Y}
                    textAnchor="middle"
                    className="fill-gray-800"
                    style={{ fontSize: 10, fontWeight: 600 }}
                  >
                    {displayShort}
                  </text>
                  <text
                    x={cx}
                    y={labelRow2Y}
                    textAnchor="middle"
                    className="fill-gray-400"
                    style={{ fontSize: 9 }}
                  >
                    {new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </text>
                  <circle
                    cx={cx}
                    cy={lineY}
                    r={HIT_R}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={(e) => moveTooltip(e, r, kind)}
                    onMouseMove={(e) => moveTooltip(e, r, kind)}
                    onClick={() => handleDotClick(r.id)}
                  />
                  <circle
                    cx={cx}
                    cy={lineY}
                    r={DOT_R + 2}
                    fill="white"
                    stroke={colors.ring}
                    strokeWidth={2}
                    className="pointer-events-none"
                  />
                  <circle cx={cx} cy={lineY} r={DOT_R} fill={colors.fill} className="pointer-events-none" />
                </g>
              );
            })}
          </svg>

          {tooltip ? (
            <div
              className="pointer-events-none fixed z-[100] max-w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left shadow-lg"
              style={{
                left: Math.min(
                  Math.max(8, tooltip.clientX + 14),
                  typeof window !== "undefined" ? window.innerWidth - 300 : tooltip.clientX + 14
                ),
                top: Math.min(
                  Math.max(8, tooltip.clientY + 18),
                  typeof window !== "undefined" ? window.innerHeight - 120 : tooltip.clientY + 18
                ),
              }}
              role="tooltip"
            >
              <p className="text-sm font-semibold leading-snug text-gray-900">
                {(tooltip.row.chief_complaint ?? "").trim() ||
                  (tooltip.row.diagnosis_term ?? "").trim() ||
                  "Visit"}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                <span style={{ color: KIND_META[tooltip.kind].fill }} className="font-semibold">
                  {KIND_META[tooltip.kind].label}
                </span>
                <span className="text-gray-400"> · </span>
                {formatTooltipDate(encounterTimestamp(tooltip.row))}
              </p>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-[10px] font-medium text-gray-600">
        {(Object.keys(KIND_META) as EncounterDotKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: KIND_META[k].fill }} />
            {KIND_META[k].label}
          </span>
        ))}
      </div>
    </section>
  );
}
