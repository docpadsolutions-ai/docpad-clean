"use client";

import { useEffect, useState, useTransition } from "react";
import { generateAiSummary, loadCachedAiSummary } from "@/app/actions/generateAiSummary";

interface Props {
  patientId: string;
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M23 4v6h-6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AiSummaryCard({ patientId }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Load cached summary on mount
  useEffect(() => {
    if (!patientId.trim()) return;
    void (async () => {
      const { summary: cached, lastUpdated: ts } = await loadCachedAiSummary(patientId.trim());
      setSummary(cached);
      setLastUpdated(ts);
    })();
  }, [patientId]);

  function handleGenerate() {
    setLoadError(null);
    startTransition(async () => {
      const result = await generateAiSummary(patientId.trim());
      if (result.success) {
        setSummary(result.summary);
        setLastUpdated(new Date().toISOString());
      } else {
        setLoadError(result.error);
      }
    });
  }

  function formatRelativeDate(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 shadow-sm">
      {/* Header row */}
      <div className="flex items-center gap-2 border-b border-indigo-100/60 px-4 py-2.5">
        <SparkleIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
          AI 10-Second Catch-Up
        </span>
        {lastUpdated && (
          <span className="ml-1 text-[10px] text-indigo-300">
            · {formatRelativeDate(lastUpdated)}
          </span>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshIcon className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
            {summary ? "Refresh" : "Generate"} AI Summary
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {isPending ? (
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-indigo-100" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-indigo-100" />
            <div className="h-3 w-4/6 animate-pulse rounded bg-indigo-100" />
          </div>
        ) : loadError ? (
          <p className="text-[11px] text-red-500">
            Could not generate summary — {loadError}. Please try again.
          </p>
        ) : summary ? (
          <p className="text-[12.5px] leading-relaxed text-gray-700">{summary}</p>
        ) : (
          <p className="text-[11px] italic text-indigo-300">
            No AI summary yet. Click "Generate AI Summary" to create a clinical catch-up from this patient's history.
          </p>
        )}
      </div>
    </div>
  );
}
