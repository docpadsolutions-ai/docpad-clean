"use client";

import { cn } from "@/lib/utils";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function kindTextClass(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("surg"))
    return "font-semibold text-teal-600 dark:text-teal-300";
  return "font-semibold text-violet-600 dark:text-purple-300";
}

function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete"))
    return "border border-gray-300 bg-white px-2.5 py-0.5 text-[10px] font-semibold capitalize text-gray-700 dark:border-white/15 dark:bg-white/10 dark:text-gray-100";
  if (s.includes("plan"))
    return "border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-semibold capitalize text-sky-800 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400";
  if (s.includes("active"))
    return "border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold capitalize text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
  return "border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[10px] font-semibold capitalize text-gray-700 dark:border-white/15 dark:bg-white/10 dark:text-gray-200";
}

export function IpdTreatmentsTable({
  rows,
  filter,
}: {
  rows: Record<string, unknown>[];
  filter: "medical" | "surgical" | "mixed";
}) {
  const filtered = rows.filter((r) => {
    const k = str(r.kind ?? r.treatment_kind ?? r.category).toLowerCase();
    if (filter === "mixed") return true;
    if (filter === "medical") return k.includes("med") || k.includes("drug") || k.includes("medication");
    return k.includes("surg") || k.includes("procedure") || k.includes("op");
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-white/10">
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Date
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Kind
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Name / description
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Dose / details
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Route / frequency
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Days
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Status
            </th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-300">
              Ordering clinician
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-200">
                No treatments for this filter.
              </td>
            </tr>
          ) : (
            filtered.map((r, i) => {
              const kind = str(r.kind ?? r.treatment_kind ?? r.category) || "—";
              const name = str(r.name ?? r.description ?? r.title);
              const isSurg = kind.toLowerCase().includes("surg");
              return (
                <tr
                  key={str(r.id) || i}
                  className="border-b border-gray-100 last:border-b-0 hover:bg-slate-50/80 dark:border-white/10 dark:hover:bg-tscolors-surface-elevated/80"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500 dark:text-gray-300">
                    {str(r.treatment_date ?? r.date ?? r.scheduled_date) || "—"}
                  </td>
                  <td className={cn("px-4 py-3 text-xs capitalize", kindTextClass(kind))}>{kind}</td>
                  <td
                    className={cn(
                      "max-w-[240px] px-4 py-3 text-sm",
                      isSurg
                        ? "font-semibold text-blue-600 dark:text-blue-400"
                        : "font-medium text-gray-900 dark:text-white",
                    )}
                  >
                    {name || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                    {str(r.dose_details ?? r.dose)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                    {str(r.route_frequency ?? r.route)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-800 dark:text-gray-100">
                    {str(r.days ?? r.duration_days)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full", statusPillClass(str(r.status)))}>
                      {str(r.status) || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800 ring-1 ring-violet-200/80 dark:bg-purple-500/25 dark:text-purple-200 dark:ring-purple-500/40">
                        {str(r.ordering_clinician_name ?? r.clinician_name)
                          .split(/\s+/)
                          .map((x) => x[0])
                          .slice(0, 2)
                          .join("") || "Dr"}
                      </span>
                      <span className="text-xs text-gray-800 dark:text-gray-100">
                        {str(r.ordering_clinician_name ?? r.clinician_name) || "—"}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
