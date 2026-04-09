"use client";

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { PatientSummaryRow } from "../hooks/usePatientSummaryHighlights";

function formatUpdated(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClinicalHighlightsCard({
  row,
  loading,
  error,
  onRefreshTimestamp,
}: {
  row: PatientSummaryRow | null;
  loading: boolean;
  error: string | null;
  onRefreshTimestamp: (currentHighlights: string) => Promise<{ error: Error | null }>;
}) {
  const [refreshBusy, setRefreshBusy] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshBusy(true);
    const text = row?.highlights_text?.trim() ?? "";
    await onRefreshTimestamp(text);
    setRefreshBusy(false);
  }, [row?.highlights_text, onRefreshTimestamp]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Clinical highlights</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Last updated:{" "}
            <span className="font-medium text-gray-700">{formatUpdated(row?.updated_at)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshBusy || loading}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
          title="Refresh last updated"
          aria-label="Refresh last updated timestamp"
        >
          <RefreshCw className={`h-4 w-4 ${refreshBusy ? "animate-spin" : ""}`} strokeWidth={2} />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      )}
      {loading && !row ? (
        <div className="mt-4 h-24 animate-pulse rounded-lg bg-gray-100" />
      ) : (
        <div className="mt-4 min-h-[5rem] rounded-lg bg-slate-50/80 p-3 text-sm leading-relaxed text-gray-800">
          {row?.highlights_text?.trim() ? (
            <p className="whitespace-pre-wrap">{row.highlights_text.trim()}</p>
          ) : (
            <p className="text-gray-500">No highlights documented yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
