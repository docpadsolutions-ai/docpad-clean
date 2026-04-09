"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ActiveProblemRow } from "../hooks/useActiveProblems";

export default function ActiveProblemsAccordion({
  rows,
  loading,
  error,
}: {
  rows: ActiveProblemRow[];
  loading: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3 text-left transition hover:bg-slate-50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={2.5} aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={2.5} aria-hidden />
          )}
          <span className="text-sm font-bold text-gray-900">Active problems</span>
          {!loading && rows.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
              {rows.length}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 py-3">
          {error && (
            <p role="alert" className="mb-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {loading ? (
            <ul className="space-y-2" aria-busy>
              {[1, 2, 3].map((i) => (
                <li key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">No active problems recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1 border-l-4 border-blue-500 pl-3">
                    <p className="text-sm font-semibold text-gray-900">{row.condition_name}</p>
                    {row.snomed_code ? (
                      <p className="mt-0.5 font-mono text-[11px] text-gray-500">SNOMED {row.snomed_code}</p>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-gray-400">No SNOMED code</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-100">
                    {row.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
