"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Icd10Suggestion = {
  code: string;
  description: string;
  reasoning: string;
};

interface Props {
  /** Combined clinical note: chief complaint + diagnosis terms */
  clinicalNote: string;
  /** Whether the encounter is read-only */
  readOnly?: boolean;
  /** Called when the doctor applies the suggestion */
  onAccept: (suggestion: Icd10Suggestion) => void;
}

const DEBOUNCE_MS = 2000;
const MIN_NOTE_LEN = 6;

export default function IcdSuggestionBadge({ clinicalNote, readOnly = false, onAccept }: Props) {
  const [suggestion, setSuggestion] = useState<Icd10Suggestion | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNoteRef = useRef("");
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Reset applied state when the clinical note changes meaningfully
  useEffect(() => {
    if (clinicalNote.trim() !== lastNoteRef.current) {
      setApplied(false);
    }
  }, [clinicalNote]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const note = clinicalNote.trim();
    if (note.length < MIN_NOTE_LEN) {
      setSuggestion(null);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      lastNoteRef.current = note;
      setError(null);
      setIsPending(true);

      void (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const { data, error: fnErr } = await supabase.functions.invoke("suggest-icd10", {
            body: { clinical_note: note },
            headers: { Authorization: `Bearer ${session?.access_token}` },
          });

          // #region agent log
          let fnCtx: unknown = null;
          try {
            const ctx = (fnErr as { context?: Response } | null)?.context;
            if (ctx && typeof ctx.json === "function") {
              fnCtx = await ctx.clone().json().catch(() => null);
            } else if (ctx) {
              fnCtx = { status: (ctx as Response).status, statusText: (ctx as Response).statusText };
            }
          } catch {
            fnCtx = "ctx_parse_failed";
          }
          fetch("http://127.0.0.1:7697/ingest/f6453cc0-026a-4d25-9f79-d1bfa1f76227", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "147753" },
            body: JSON.stringify({
              sessionId: "147753",
              runId: "pre-fix",
              hypothesisId: "A-E",
              location: "IcdSuggestionBadge.tsx:invoke",
              message: "suggest-icd10 invoke result",
              data: {
                noteLen: note.length,
                hasSession: Boolean(session?.access_token),
                fnErrName: fnErr ? (fnErr as Error).name : null,
                fnErrMessage: fnErr ? (fnErr as Error).message : null,
                fnCtx,
                dataSuccess: (data as { success?: unknown } | null)?.success ?? null,
                dataError: (data as { error?: unknown } | null)?.error ?? null,
                dataKeys: data && typeof data === "object" ? Object.keys(data as object) : typeof data,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion

          if (fnErr) throw fnErr;

          const d = data as Record<string, unknown> | null;
          if (!d?.success) {
            throw new Error(String(d?.error ?? "edge_error"));
          }

          setSuggestion({
            code: String(d.code ?? ""),
            description: String(d.description ?? ""),
            reasoning: String(d.reasoning ?? ""),
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setSuggestion(null);
        } finally {
          setIsPending(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [clinicalNote]);

  // Close tooltip on outside click
  useEffect(() => {
    if (!tooltipOpen) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setTooltipOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tooltipOpen]);

  if (!isPending && !suggestion && !error) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-blue-100/60 px-3 py-1.5">
        {isPending ? (
          /* Pulsing "thinking" dot */
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
          </span>
        ) : (
          <svg className="h-3 w-3 shrink-0 text-blue-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
          </svg>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
          {isPending ? "AI is thinking…" : "Smart Suggestion · ICD-10"}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5">
        {isPending ? (
          /* Pulsing placeholder rows */
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-6 w-14 animate-pulse rounded-md bg-blue-200/70" />
              <div className="h-4 flex-1 animate-pulse rounded bg-blue-100/80" />
            </div>
            <div className="h-3 w-3/4 animate-pulse rounded bg-blue-100/60" />
          </div>
        ) : error ? (
          <p className="text-[11px] text-red-400">
            Could not suggest a code — {error}. Try adding more clinical detail.
          </p>
        ) : suggestion ? (
          <div className="space-y-2">
            {/* Code + description row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-blue-300 bg-white px-2.5 py-1 font-mono text-[13px] font-bold tracking-wide text-blue-800 shadow-sm">
                {suggestion.code}
              </span>
              <span className="min-w-0 flex-1 text-[12px] font-medium text-gray-800">
                {suggestion.description}
              </span>
            </div>

            {/* Action row */}
            <div className="flex items-center gap-2">
              {/* Why? tooltip */}
              <div className="relative" ref={tooltipRef}>
                <button
                  type="button"
                  onClick={() => setTooltipOpen((o) => !o)}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-blue-500 transition hover:bg-blue-50"
                  aria-label="Show AI reasoning"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                  </svg>
                  Why this code?
                </button>

                {tooltipOpen && (
                  <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-blue-100 bg-white p-3.5 shadow-xl">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-500">
                      AI Clinical Reasoning
                    </p>
                    <p className="text-[11.5px] leading-relaxed text-gray-700">
                      {suggestion.reasoning || "No reasoning provided."}
                    </p>
                    {/* Caret */}
                    <div className="absolute -bottom-1.5 left-5 h-3 w-3 rotate-45 border-b border-r border-blue-100 bg-white" />
                  </div>
                )}
              </div>

              <div className="ml-auto">
                {!readOnly && (
                  applied ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Applied to diagnosis
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onAccept(suggestion);
                        setApplied(true);
                        setTooltipOpen(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Apply
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
