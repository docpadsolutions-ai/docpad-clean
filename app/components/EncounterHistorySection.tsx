"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Eye, Filter } from "lucide-react";
import {
  chiefComplaintDisplay,
  examinationVitalsLine,
  followUpLabel,
  formatEncounterDateTime,
  formatDoctorName,
  useEncounterHistory,
  type EncounterHistoryRow,
} from "../hooks/useEncounterHistory";

function badgeStyles(type: EncounterHistoryRow["typeBadge"]): string {
  switch (type) {
    case "IPD":
      return "bg-violet-600 text-white";
    case "Emergency":
      return "bg-red-600 text-white";
    default:
      return "bg-blue-600 text-white";
  }
}

function isWithinLastDays(iso: string | null, days: number): boolean {
  if (!iso?.trim()) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const cutoff = Date.now() - days * 86400000;
  return t >= cutoff;
}

export default function EncounterHistorySection({
  patientId,
  currentEncounterId,
  onNavigate,
}: {
  patientId: string;
  currentEncounterId?: string | null;
  /** When set, used to switch to Current Encounter tab for the open visit (same URL — Link alone would no-op). */
  onNavigate?: (view: string, params?: Record<string, unknown>) => void;
}) {
  const { rows, loading, error, totalCount } = useEncounterHistory(patientId.trim() || null);
  const [recentOnly, setRecentOnly] = useState(true);
  const [sortMode, setSortMode] = useState<"smart" | "chronological">("smart");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    let list = recentOnly ? rows.filter((r) => isWithinLastDays(r.created_at, 30)) : [...rows];
    if (sortMode === "chronological") {
      list = [...list].sort((a, b) => {
        const ta = Date.parse(a.created_at ?? "") || 0;
        const tb = Date.parse(b.created_at ?? "") || 0;
        return tb - ta;
      });
    } else {
      // "Smart": finished first, then in-progress, then planned; tie-break by date desc
      const rank = (s: EncounterHistoryRow["fhirStatus"]) =>
        s === "finished" ? 0 : s === "in-progress" ? 1 : 2;
      list = [...list].sort((a, b) => {
        const ra = rank(a.fhirStatus);
        const rb = rank(b.fhirStatus);
        if (ra !== rb) return ra - rb;
        return (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0);
      });
    }
    return list;
  }, [rows, recentOnly, sortMode]);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setExpandedId(null);
      return;
    }
    setExpandedId((prev) => {
      if (prev && filteredRows.some((r) => r.id === prev)) return prev;
      return filteredRows[0]?.id ?? null;
    });
  }, [filteredRows]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const providerLine = (row: EncounterHistoryRow) => {
    const doc = formatDoctorName(row.practitioner);
    const org = row.organizationName?.trim() || "—";
    return `${doc} • ${org}`;
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
          <button
            type="button"
            onClick={() => setRecentOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              recentOnly
                ? "border-blue-200 bg-blue-50 text-blue-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            title={recentOnly ? "Showing last 30 days — click for all" : "Showing all — click for last 30 days"}
          >
            <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Filter
          </button>
          <div className="relative">
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as "smart" | "chronological")}
              className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              aria-label="Encounter sort (Smart or chronological)"
            >
              <option value="smart">Smart</option>
              <option value="chronological">Chronological</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          </div>
        </div>
      </div>

      <div className="relative my-5">
        <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200" aria-hidden />
        <div className="relative mx-auto w-max bg-white px-3 text-center">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Recent</p>
          <p className="text-[11px] text-slate-500">{recentOnly ? "Last 30 days" : "All time"}</p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-3" aria-busy>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
          {recentOnly
            ? "No encounters in the last 30 days. Turn off Filter to see older visits."
            : "No encounters on file for this patient."}
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredRows.map((row) => {
            const open = expandedId === row.id;
            const fu = followUpLabel(row.plan_details);
            const inv = row.investigationSummaries;
            const invLine = inv.length > 0 ? `Investigations ordered (${inv.join(", ")})` : null;
            const rxLine =
              row.prescriptionCount > 0
                ? `Prescription given (${row.prescriptionCount} medication${row.prescriptionCount === 1 ? "" : "s"})`
                : null;

            return (
              <li
                key={row.id}
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
                    className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeStyles(row.typeBadge)}`}
                  >
                    {row.typeBadge}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{formatEncounterDateTime(row.created_at)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{providerLine(row)}</p>
                    <p className="sr-only">
                      FHIR Encounter status {row.fhirStatus}, class {row.fhirClass}
                    </p>
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
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Actions taken</p>
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
          })}
        </ul>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-slate-400">
        Encounters are loaded from <code className="rounded bg-slate-100 px-1">opd_encounters</code> (FHIR Encounter
        equivalent: ambulatory OPD). Status codes map to planned / in-progress / finished.
      </p>
    </section>
  );
}
