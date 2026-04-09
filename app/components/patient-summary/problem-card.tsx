"use client";

function formatSinceMonthYear(isoDate: string | null | undefined): string | null {
  if (isoDate == null || String(isoDate).trim() === "") return null;
  const raw = String(isoDate).trim();
  const d = new Date(raw.length <= 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function statusBadgeClass(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === "active") {
    return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  }
  if (s === "controlled") {
    return "bg-amber-50 text-amber-900 ring-1 ring-amber-200";
  }
  if (s === "uncontrolled") {
    return "bg-red-50 text-red-800 ring-1 ring-red-200";
  }
  return "bg-slate-50 text-slate-700 ring-1 ring-slate-200";
}

export type ProblemCardRow = {
  id: string;
  condition_name: string;
  status: string;
  onset_date: string | null;
  snomed_code: string | null;
  created_at?: string | null;
  /** When set (e.g. encounter-derived fallback), shown as subtle italic hint under the title. */
  sourceLabel?: string | null;
};

export default function ProblemCard({ row }: { row: ProblemCardRow }) {
  const since =
    formatSinceMonthYear(row.onset_date) ?? formatSinceMonthYear(row.created_at ?? null);

  return (
    <article className="rounded-lg border border-gray-100 bg-white px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-gray-900">{row.condition_name}</h4>
          {row.sourceLabel ? (
            <p className="mt-0.5 text-[11px] italic text-gray-500">{row.sourceLabel}</p>
          ) : null}
          {since ? (
            <p className="mt-1 text-xs text-gray-500">Since {since}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">Onset date not recorded</p>
          )}
          {row.snomed_code ? (
            <p className="mt-1 font-mono text-[11px] text-gray-500">SNOMED {row.snomed_code}</p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(row.status)}`}
        >
          {row.status}
        </span>
      </div>
    </article>
  );
}
