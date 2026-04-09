"use client";

import Link from "next/link";
import type { OpdEncounterRow } from "../hooks/usePatientOpdEncounters";

/** `OPD-1775480366385`-style numbers (timestamp / long numeric suffix) — not a human token. */
function isTimestampStyleEncounterNumber(n: string | null | undefined): boolean {
  const t = (n ?? "").trim();
  if (!t) return false;
  const m = /^OPD-(\d+)$/i.exec(t);
  if (!m) return false;
  return m[1].length >= 10;
}

function encounterVisitDateLabel(row: OpdEncounterRow): string {
  const raw = row.encounter_date?.trim() || row.created_at || row.updated_at || "";
  if (!raw) return "—";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function titleForEncounterRow(row: OpdEncounterRow): string {
  const dx = row.diagnosis_term?.trim();
  if (dx) return dx;
  const cc = row.chief_complaint_term?.trim() || row.chief_complaint?.trim();
  if (cc) return cc;
  const num = row.encounter_number?.trim();
  if (num && !isTimestampStyleEncounterNumber(num)) return num;
  const datePart = encounterVisitDateLabel(row);
  return datePart === "—" ? "OPD Visit" : `OPD Visit · ${datePart}`;
}

function normalizeOpdStatus(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function encounterOpenHref(id: string, status: string | null | undefined): string {
  const st = normalizeOpdStatus(status);
  const base = `/opd/encounter/${id}`;
  if (st === "completed") {
    return `${base}?mode=readonly`;
  }
  return base;
}

export default function PatientEncountersList({
  rows,
  loading,
  error,
  currentEncounterId,
  orgName,
}: {
  rows: OpdEncounterRow[];
  loading: boolean;
  error: string | null;
  currentEncounterId: string | null;
  orgName?: string;
}) {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Encounters</p>
        <h2 className="mt-1 text-lg font-bold text-gray-900">All OPD encounters</h2>
        {orgName && <p className="text-sm text-gray-500">{orgName}</p>}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <ul className="space-y-2">
          {[1, 2, 3].map((i) => (
            <li key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No OPD encounters found for this patient.</p>
      ) : (
        <ul className="space-y-3">
          {[...rows].reverse().map((row) => {
            const isCurrent = currentEncounterId != null && row.id === currentEncounterId;
            const when = row.updated_at ?? row.created_at ?? "";
            const dateLabel = when
              ? new Date(when).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—";
            const st = normalizeOpdStatus(row.status);
            const isCompleted = st === "completed";
            const refToken = row.encounter_number?.trim();
            const showRefLine = Boolean(refToken && !isTimestampStyleEncounterNumber(refToken));

            return (
              <li
                key={row.id}
                id={`health-encounter-card-${row.id}`}
                className={`scroll-mt-28 rounded-xl border p-4 shadow-sm transition ${
                  isCurrent
                    ? "border-blue-400 bg-blue-50/60 ring-2 ring-blue-200"
                    : "border-gray-100 bg-white hover:border-gray-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{titleForEncounterRow(row)}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{dateLabel}</p>
                    {showRefLine ? (
                      <p className="mt-1 text-[11px] font-mono text-gray-400">Ref · {refToken}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        isCompleted ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {st ? st.replace(/_/g, " ") : "—"}
                    </span>
                    <Link
                      href={encounterOpenHref(row.id, row.status)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
