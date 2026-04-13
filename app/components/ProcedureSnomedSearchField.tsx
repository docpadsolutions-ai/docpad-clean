"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { supabase } from "../supabase";
import { cn } from "@/lib/utils";
import {
  SNOMED_ECL_PROCEDURE,
  SNOMED_ECL_PROCEDURE_WITH_LATERALITY,
} from "@/app/lib/ipdSnomedEcl";
import { buildSnomedSearchQueryString, type SnomedConcept } from "./SnomedSearch";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function sanitizeIlikeFragment(q: string): string {
  return q.trim().replace(/[%_,]/g, "").slice(0, 80);
}

export type ProcedureSnomedHit = {
  conceptId: string;
  displayTerm: string;
  icd10: string | null;
  source: "api";
};

function dedupeByConceptId(rows: ProcedureSnomedHit[]): ProcedureSnomedHit[] {
  const seen = new Set<string>();
  const out: ProcedureSnomedHit[] = [];
  for (const r of rows) {
    const id = r.conceptId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

function hitFromApiRow(r: SnomedConcept): ProcedureSnomedHit | null {
  const conceptId = s(r.conceptId);
  const displayTerm = s(r.term);
  if (!conceptId || !displayTerm) return null;
  return { conceptId, displayTerm, icd10: r.icd10 ?? null, source: "api" };
}

async function incrementSnomedCacheUsage(conceptId: string) {
  const id = conceptId.trim();
  if (!id) return;
  const { data: row, error: fetchErr } = await supabase
    .from("snomed_cache")
    .select("usage_count")
    .eq("concept_id", id)
    .maybeSingle();
  if (fetchErr) {
    console.warn("[ProcedureSnomed] usage fetch:", fetchErr.message);
    return;
  }
  const prev = Number(row?.usage_count ?? 0);
  const { error: upErr } = await supabase
    .from("snomed_cache")
    .update({ usage_count: Number.isFinite(prev) ? prev + 1 : 1 })
    .eq("concept_id", id);
  if (upErr) console.warn("[ProcedureSnomed] usage update:", upErr.message);
}

function procedureEclForLaterality(laterality: string | undefined): string {
  const lat = laterality?.trim();
  const hasLat = lat === "Left" || lat === "Right" || lat === "Bilateral";
  return hasLat ? SNOMED_ECL_PROCEDURE_WITH_LATERALITY : SNOMED_ECL_PROCEDURE;
}

/**
 * SNOMED procedure search via `/api/snomed/search` (tiered cache + ECL-filtered Ontoserver expansion).
 */
export default function ProcedureSnomedSearchField({
  disabled,
  procedureName,
  procedureSnomed,
  procedureIcd10,
  onProcedureChange,
  laterality,
}: {
  disabled?: boolean;
  procedureName: string;
  procedureSnomed: string;
  procedureIcd10: string | null;
  onProcedureChange: (next: {
    procedureName: string;
    procedureSnomed: string;
    procedureIcd10: string | null;
  }) => void;
  /** When Left / Right / Bilateral, search uses procedure ∩ laterality-aware ECL. */
  laterality?: string;
}) {
  const searchId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProcedureSnomedHit[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasCodedSelection = Boolean(procedureName.trim() && procedureSnomed.trim());
  const isManualOnly = Boolean(procedureName.trim() && !procedureSnomed.trim());

  const ecl = procedureEclForLaterality(laterality);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const runSearch = useCallback(
    async (raw: string) => {
      const frag = sanitizeIlikeFragment(raw);
      if (frag.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const qs = buildSnomedSearchQueryString({
          q: raw,
          hierarchy: "procedure",
          ecl,
          cacheFilter: "procedure",
          conceptCacheType: "procedure",
        });
        const res = await fetch(`/api/snomed/search?${qs}`);
        const data = (await res.json()) as { results?: SnomedConcept[] };
        const list = Array.isArray(data.results) ? data.results : [];
        const hits = dedupeByConceptId(
          list.map((r) => hitFromApiRow(r)).filter(Boolean) as ProcedureSnomedHit[],
        ).slice(0, 10);
        setResults(hits);
      } catch (e) {
        console.warn("[ProcedureSnomed] API search:", e);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [ecl],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const fragActive = sanitizeIlikeFragment(query).length >= 2;
  const showManualInDropdown = fragActive && !loading && results.length === 0;

  const clearProcedure = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    onProcedureChange({ procedureName: "", procedureSnomed: "", procedureIcd10: null });
  };

  const selectHit = async (hit: ProcedureSnomedHit) => {
    await incrementSnomedCacheUsage(hit.conceptId);
    onProcedureChange({
      procedureName: hit.displayTerm,
      procedureSnomed: hit.conceptId,
      procedureIcd10: hit.icd10,
    });
    setQuery("");
    setOpen(false);
    setResults([]);
  };

  const selectManualEntry = () => {
    const label = sanitizeIlikeFragment(query);
    if (label.length < 2) return;
    onProcedureChange({
      procedureName: label,
      procedureSnomed: "",
      procedureIcd10: null,
    });
    setQuery("");
    setOpen(false);
    setResults([]);
  };

  const listOpen = open && fragActive && (loading || results.length > 0 || showManualInDropdown);

  const inputClass =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  return (
    <div ref={wrapRef} className="space-y-2">
      <div className="relative">
        <label htmlFor={searchId} className="mb-1 block text-[10px] font-medium text-gray-600">
          Search procedure
        </label>
        <input
          id={searchId}
          type="text"
          disabled={disabled}
          autoComplete="off"
          placeholder="Search procedure…"
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            setOpen(sanitizeIlikeFragment(v).length >= 2);
          }}
          onFocus={() => {
            if (sanitizeIlikeFragment(query).length >= 2) setOpen(true);
          }}
          className={inputClass}
        />
        {loading ? (
          <p className="mt-1 text-[11px] text-gray-500">Searching…</p>
        ) : null}
        {listOpen ? (
          <div
            className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: "100%" }}
          >
            {results.map((hit) => (
              <button
                key={hit.conceptId}
                type="button"
                className="flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left hover:bg-blue-50"
                onClick={() => void selectHit(hit)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">{hit.displayTerm}</span>
                  <span className="mt-0.5 block text-xs text-gray-400">{hit.conceptId}</span>
                </span>
                {hit.icd10 ? (
                  <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 bg-blue-50">
                    {hit.icd10}
                  </span>
                ) : null}
              </button>
            ))}
            {showManualInDropdown ? (
              <button
                type="button"
                className={cn(
                  "w-full cursor-pointer px-3 py-2.5 text-left text-sm text-gray-900 hover:bg-blue-50",
                  results.length > 0 && "border-t border-gray-100",
                )}
                onClick={selectManualEntry}
              >
                Use as manual entry: &quot;{sanitizeIlikeFragment(query)}&quot;
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasCodedSelection || isManualOnly ? (
        <div className="flex flex-wrap gap-1.5">
          {(() => {
            const coded = hasCodedSelection;
            const chipBorder = coded
              ? "border-emerald-200/90 bg-emerald-50/50"
              : "border-gray-200 bg-gray-50";
            const dotClass = coded ? "bg-emerald-400" : "bg-gray-400";
            const icd = s(procedureIcd10);
            const snomedLine = coded ? `SNOMED: ${procedureSnomed.trim()}` : "SNOMED: —";
            const tooltipLines = [snomedLine];
            if (icd) tooltipLines.push(`ICD-10: ${icd}`);
            const fsn = procedureName.trim();
            if (fsn) tooltipLines.push(`FSN: ${fsn}`);
            const titleTooltip = tooltipLines.join("\n");
            return (
              <span className="relative inline-flex max-w-full flex-col">
                <span
                  className={`inline-flex max-w-full items-stretch overflow-hidden rounded-full border shadow-sm ${chipBorder}`}
                >
                  <span
                    className="inline-flex min-w-0 flex-1 cursor-default items-center gap-1.5 border-0 bg-transparent px-2.5 py-1.5 text-left"
                    title={titleTooltip}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
                    <span className="min-w-0 text-[12px] font-medium text-gray-900">{procedureName.trim()}</span>
                    {isManualOnly ? <span className="shrink-0 text-[11px] text-gray-500">Manual</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={clearProcedure}
                    className="shrink-0 border-0 border-l border-gray-200/80 bg-transparent px-2 py-1.5 text-gray-300 transition hover:bg-red-50 hover:text-red-400"
                    aria-label={`Remove ${procedureName.trim()}`}
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              </span>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
