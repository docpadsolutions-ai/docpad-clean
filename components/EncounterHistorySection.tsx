"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Eye, Filter } from "lucide-react";
import {
  chiefComplaintDisplay,
  examinationVitalsLine,
  followUpLabel,
  formatEncounterDateTime,
  formatDoctorName,
  useEncounterHistory,
  type EncounterHistoryRow,
} from "@/hooks/useEncounterHistory";
import ErrorBanner from "@/components/ErrorBanner";

function rowTime(r: EncounterHistoryRow): number {
  const t = Date.parse(r.created_at ?? "");
  return Number.isFinite(t) ? t : 0;
}

function isWithinLastDays(iso: string | null, days: number): boolean {
  if (!iso?.trim()) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const cutoff = Date.now() - days * 86400000;
  return t >= cutoff;
}

function themeKey(term: string | null | undefined): string | null {
  const t = term?.trim();
  if (!t) return null;
  const first = t.split(/[;,]/)[0]?.trim() ?? t;
  return first.length > 56 ? `${first.slice(0, 53)}…` : first;
}

function formatRangeShort(rows: EncounterHistoryRow[]): string {
  const times = rows.map(rowTime).filter((t) => t > 0);
  if (times.length === 0) return "";
  const min = Math.min(...times);
  const max = Math.max(...times);
  const a = new Date(min);
  const b = new Date(max);
  const opt: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return a.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  return `${a.toLocaleDateString("en-IN", opt)} – ${b.toLocaleDateString("en-IN", opt)}`;
}

type FilterPreset = "all" | "365" | "90" | "30";

function inferDisplayBadge(row: EncounterHistoryRow): string {
  const t = `${row.chief_complaint ?? ""} ${row.diagnosis_term ?? ""}`.toLowerCase();
  if (/\bfollow|f\/u|follow-up|review visit\b/.test(t)) return "Followup";
  return row.typeBadge;
}

function badgeStyles(badge: string): string {
  switch (badge) {
    case "IPD":
      return "bg-violet-600 text-white";
    case "Emergency":
      return "bg-red-600 text-white";
    case "Followup":
      return "bg-teal-600 text-white";
    default:
      return "bg-blue-600 text-white";
  }
}

type GroupBlock =
  | { kind: "recent"; title: string; rows: EncounterHistoryRow[] }
  | { kind: "theme"; title: string; subtitle: string; rows: EncounterHistoryRow[] }
  | { kind: "year"; title: string; rows: EncounterHistoryRow[] };

function buildGroupedBlocks(rows: EncounterHistoryRow[]): GroupBlock[] {
  const sorted = [...rows].sort((a, b) => rowTime(b) - rowTime(a));
  const cutoff30 = Date.now() - 30 * 86400000;
  const recent = sorted.filter((r) => rowTime(r) >= cutoff30);
  const older = sorted.filter((r) => rowTime(r) < cutoff30);

  const blocks: GroupBlock[] = [];
  if (recent.length > 0) {
    blocks.push({
      kind: "recent",
      title: "RECENT — Last 30 days",
      rows: recent,
    });
  }

  const themeMap = new Map<string, EncounterHistoryRow[]>();
  for (const r of older) {
    const k = themeKey(r.diagnosis_term);
    if (!k) continue;
    const list = themeMap.get(k) ?? [];
    list.push(r);
    themeMap.set(k, list);
  }

  const themedIds = new Set<string>();
  for (const [key, list] of themeMap) {
    if (list.length < 2) continue;
    const subtitle = `${formatRangeShort(list)} · ${list.length} encounter${list.length === 1 ? "" : "s"}`;
    blocks.push({
      kind: "theme",
      title: key.toUpperCase(),
      subtitle,
      rows: [...list].sort((a, b) => rowTime(b) - rowTime(a)),
    });
    for (const r of list) themedIds.add(r.id);
  }

  const remainder = older.filter((r) => !themedIds.has(r.id));
  const byYear = new Map<number, EncounterHistoryRow[]>();
  for (const r of remainder) {
    const y = new Date(rowTime(r)).getFullYear();
    if (!Number.isFinite(y)) continue;
    const list = byYear.get(y) ?? [];
    list.push(r);
    byYear.set(y, list);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  for (const y of years) {
    const list = byYear.get(y) ?? [];
    blocks.push({
      kind: "year",
      title: `EARLIER IN ${y}`,
      rows: [...list].sort((a, b) => rowTime(b) - rowTime(a)),
    });
  }

  return blocks;
}

const INITIAL_SECTION_LIMIT = 8;

export default function EncounterHistorySection({
  patientId,
  currentEncounterId,
  onNavigate,
}: {
  patientId: string;
  currentEncounterId?: string | null;
  onNavigate?: (view: string, params?: Record<string, unknown>) => void;
}) {
  const { rows, loading, error, totalCount } = useEncounterHistory(patientId.trim() || null);
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all");
  const [layoutMode, setLayoutMode] = useState<"grouped" | "chronological">("grouped");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sectionCaps, setSectionCaps] = useState<Record<string, number>>({});

  const dateFiltered = useMemo(() => {
    if (filterPreset === "all") return rows;
    const days = filterPreset === "365" ? 365 : filterPreset === "90" ? 90 : 30;
    return rows.filter((r) => isWithinLastDays(r.created_at, days));
  }, [rows, filterPreset]);

  const displayRows = useMemo(() => {
    let list = [...dateFiltered];
    list.sort((a, b) => rowTime(b) - rowTime(a));
    if (layoutMode === "chronological") {
      return list;
    }
    const rank = (s: EncounterHistoryRow["fhirStatus"]) =>
      s === "finished" ? 0 : s === "in-progress" ? 1 : 2;
    list.sort((a, b) => {
      const ra = rank(a.fhirStatus);
      const rb = rank(b.fhirStatus);
      if (ra !== rb) return ra - rb;
      return rowTime(b) - rowTime(a);
    });
    return list;
  }, [dateFiltered, layoutMode]);

  const blocks = useMemo(() => {
    if (layoutMode === "chronological") return [];
    return buildGroupedBlocks(dateFiltered);
  }, [dateFiltered, layoutMode]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const providerLine = (row: EncounterHistoryRow) => {
    const doc = formatDoctorName(row.practitioner);
    const org = row.organizationName?.trim() || "—";
    return `${doc} • ${org}`;
  };

  const errMsg = error?.trim() ? error : null;

  const renderRow = (row: EncounterHistoryRow) => {
    const open = expandedId === row.id;
    const fu = followUpLabel(row.plan_details);
    const inv = row.investigationSummaries;
    const invLine = inv.length > 0 ? `Investigations ordered (${inv.join(", ")})` : null;
    const rxLine =
      row.prescriptionCount > 0
        ? `Prescription given (${row.prescriptionCount} medication${row.prescriptionCount === 1 ? "" : "s"})`
        : null;
    const badge = inferDisplayBadge(row);

    return (
      <li
        key={row.id}
        id={`encounter-history-row-${row.id}`}
        className={`overflow-hidden rounded-xl border transition ${
          currentEncounterId === row.id
            ? "border-blue-300 bg-blue-50/30 ring-1 ring-blue-200"
            : "border-slate-200 bg-white"
        }`}
      >
        <button
          type="button"
          onClick={() => toggleExpand(row.id)}
          className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-slate-50/80"
        >
          <span
            className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeStyles(badge)}`}
          >
            {badge}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{formatEncounterDateTime(row.created_at)}</p>
            <p className="mt-0.5 text-xs text-slate-500">{providerLine(row)}</p>
          </div>
          {open ? (
            <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          ) : (
            <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          )}
        </button>

        {open ? (
          <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Chief complaint</p>
              <p className="mt-1 text-sm text-slate-800">{chiefComplaintDisplay(row)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Diagnosis</p>
              <p className="mt-1 text-sm text-slate-800">{row.diagnosis_term?.trim() || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Examination</p>
              <p className="mt-1 text-sm text-slate-800">{examinationVitalsLine(row)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Actions</p>
              <ul className="mt-2 space-y-1.5">
                {rxLine ? (
                  <li className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                    <span>{rxLine}</span>
                  </li>
                ) : null}
                {inv.length > 0 ? (
                  <li className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                    <span>{invLine}</span>
                  </li>
                ) : null}
                {fu ? (
                  <li className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                    <span>{fu}</span>
                  </li>
                ) : null}
                {!rxLine && inv.length === 0 && !fu ? (
                  <li className="text-sm text-slate-500">No documented actions for this visit.</li>
                ) : null}
              </ul>
            </div>
            {currentEncounterId?.trim() === row.id.trim() && onNavigate ? (
              <button
                type="button"
                onClick={() => onNavigate("current-encounter")}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Eye className="h-4 w-4" aria-hidden />
                View Full Encounter
              </button>
            ) : (
              <Link
                href={`/dashboard/opd/encounter/${row.id}`}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Eye className="h-4 w-4" aria-hidden />
                View Full Encounter
              </Link>
            )}
          </div>
        ) : null}
      </li>
    );
  };

  const renderSection = (block: GroupBlock, idx: number) => {
    const key = `${block.kind}-${idx}`;
    const cap = sectionCaps[key] ?? INITIAL_SECTION_LIMIT;
    const visible = block.rows.slice(0, cap);
    const hidden = Math.max(0, block.rows.length - visible.length);

    return (
      <div key={key} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-800">{block.title}</p>
            {block.kind === "theme" ? (
              <p className="mt-0.5 text-[11px] text-slate-500">{block.subtitle}</p>
            ) : null}
          </div>
        </div>
        <ul className="space-y-3">
          {visible.map((row) => renderRow(row))}
        </ul>
        {hidden > 0 ? (
          <button
            type="button"
            className="w-full rounded-lg border border-dashed border-slate-200 bg-slate-50/80 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100"
            onClick={() => setSectionCaps((prev) => ({ ...prev, [key]: (prev[key] ?? INITIAL_SECTION_LIMIT) + 25 }))}
          >
            Show {hidden} more encounter{hidden === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-start gap-2">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Encounter History</h3>
            <p className="mt-0.5 text-sm text-slate-500">{totalCount} total encounters</p>
          </div>
          {!loading && totalCount === 0 ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
              First visit
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <select
              value={filterPreset}
              onChange={(e) => setFilterPreset(e.target.value as FilterPreset)}
              className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-xs font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              aria-label="Filter encounters by date range"
            >
              <option value="all">All time</option>
              <option value="365">Last year</option>
              <option value="90">Last 90 days</option>
              <option value="30">Last 30 days</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          </div>
          <div className="relative">
            <select
              value={layoutMode}
              onChange={(e) => setLayoutMode(e.target.value as "grouped" | "chronological")}
              className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              aria-label="Grouped or chronological list"
            >
              <option value="grouped">Smart / Grouped</option>
              <option value="chronological">Chronological</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          </div>
        </div>
      </div>

      {errMsg ? <ErrorBanner message={errMsg} className="mt-4" /> : null}

      {loading ? (
        <div className="mt-4 space-y-3" aria-busy>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : displayRows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
          No encounters match this filter.
        </p>
      ) : layoutMode === "grouped" && blocks.length > 0 ? (
        <div className="mt-6 space-y-8">{blocks.map((b, i) => renderSection(b, i))}</div>
      ) : (
        <ul className="mt-6 space-y-3">
          {displayRows.map((row) => renderRow(row))}
        </ul>
      )}
    </section>
  );
}
