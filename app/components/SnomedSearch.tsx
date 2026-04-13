"use client";

import { useEffect, useState } from "react";

export type SnomedConcept = {
  term: string;
  conceptId: string;
  icd10: string | null;
  /** Set when finding + bodySite search had no FSN match for the site — doctor should verify. */
  lowConfidence?: boolean;
};

export type SnomedSearchCacheFilter = "finding_diagnosis" | "procedure";
export type SnomedConceptCacheType = "finding" | "procedure";

/** Build query string for `/api/snomed/search` (voice resolution, tests, etc.). */
export function buildSnomedSearchQueryString(params: {
  q: string;
  hierarchy?: string;
  ecl?: string;
  cacheFilter?: SnomedSearchCacheFilter;
  conceptCacheType?: SnomedConceptCacheType;
  bodySite?: string;
  descendantOfConceptId?: string;
  findingSiteConceptId?: string;
  morphologyConceptId?: string;
  indiaRefset?: string;
  specialty?: string;
  doctorId?: string;
}): string {
  const sp = new URLSearchParams();
  sp.set("q", params.q);
  if (params.hierarchy) sp.set("hierarchy", params.hierarchy);
  if (params.ecl?.trim()) sp.set("ecl", params.ecl.trim());
  if (params.cacheFilter) sp.set("cacheFilter", params.cacheFilter);
  if (params.conceptCacheType) sp.set("conceptCacheType", params.conceptCacheType);
  if (params.bodySite?.trim()) sp.set("bodySite", params.bodySite.trim());
  if (params.descendantOfConceptId?.trim()) sp.set("descendantOf", params.descendantOfConceptId.trim());
  if (params.findingSiteConceptId?.trim()) sp.set("findingSiteConcept", params.findingSiteConceptId.trim());
  if (params.morphologyConceptId?.trim()) sp.set("morphologyConcept", params.morphologyConceptId.trim());
  if (params.indiaRefset?.trim()) sp.set("indiaRefset", params.indiaRefset.trim());
  if (params.specialty?.trim()) sp.set("specialty", params.specialty.trim());
  if (params.doctorId?.trim()) sp.set("doctorId", params.doctorId.trim());
  return sp.toString();
}

async function bumpCacheUsage(concept: SnomedConcept, hierarchy?: string) {
  if (!concept.conceptId?.trim()) return;
  try {
    await fetch("/api/snomed/cache-concept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conceptId: concept.conceptId.trim(),
        term: concept.term.trim(),
        hierarchy: hierarchy ?? "diagnosis",
        icd10: concept.icd10,
      }),
    });
  } catch {
    /* non-blocking */
  }
}

const INPUT_WRAP =
  "flex w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2.5 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500";
const INPUT_FIELD =
  "min-w-0 flex-1 bg-white text-sm text-gray-900 outline-none placeholder:text-gray-400";
const DROPDOWN_PANEL =
  "absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg";

/**
 * Chief complaint / diagnosis / etc. — searches `snomed_cache` first (via API), then CSIRO when the cache has no rows.
 * @param allowFreeTextNoCode When true and there are no matches, offer adding the typed text without a SNOMED code.
 * @param recordSelectionUsage When true (default), POST to `/api/snomed/cache-concept` after picking a coded result to increase `usage_count`.
 * @param descendantOfConceptId Narrow search to `(hierarchy root) AND << this concept` (numeric SCTID).
 * @param findingSiteConceptId Refine clinical hierarchies with finding-site attribute (numeric SCTID).
 * @param morphologyConceptId Refine clinical hierarchies with associated morphology (numeric SCTID).
 * @param indiaRefset Key from `INDIA_SNOMED_REFSET_IDS` (e.g. `orthopedics`) — intersects with India NRC refset via ECL.
 * @param ecl Optional ECL for Ontoserver expansion (tier 3). Use with `cacheFilter` / `conceptCacheType` for tier 1–2 alignment.
 */
export default function SnomedSearch({
  placeholder,
  hierarchy,
  onSelect,
  value,
  onChange,
  allowFreeTextNoCode = false,
  recordSelectionUsage = true,
  /** When set with `hierarchy="finding"`, API searches `q` only and ranks/filters by this body site. */
  bodySite,
  descendantOfConceptId,
  findingSiteConceptId,
  morphologyConceptId,
  indiaRefset,
  ecl,
  cacheFilter,
  conceptCacheType,
  specialty,
  doctorId,
}: {
  placeholder: string;
  hierarchy?: "diagnosis" | "complaint" | "procedure" | "allergy" | "finding";
  onSelect: (concept: SnomedConcept) => void;
  value?: string;
  onChange?: (v: string) => void;
  allowFreeTextNoCode?: boolean;
  recordSelectionUsage?: boolean;
  bodySite?: string;
  descendantOfConceptId?: string;
  findingSiteConceptId?: string;
  morphologyConceptId?: string;
  indiaRefset?: string;
  ecl?: string;
  cacheFilter?: SnomedSearchCacheFilter;
  conceptCacheType?: SnomedConceptCacheType;
  specialty?: string;
  doctorId?: string;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [internalQuery, setInternalQuery] = useState("");
  const [results, setResults] = useState<SnomedConcept[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isControlled = value !== undefined;
  const query = isControlled ? value : internalQuery;

  function setQuery(v: string) {
    if (isControlled) {
      onChange?.(v);
    } else {
      setInternalQuery(v);
      onChange?.(v);
    }
  }

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const q = query.trim();
        const qs = buildSnomedSearchQueryString({
          q: query,
          hierarchy,
          ecl,
          cacheFilter,
          conceptCacheType,
          bodySite: hierarchy === "finding" && bodySite?.trim() ? bodySite : undefined,
          descendantOfConceptId,
          findingSiteConceptId,
          morphologyConceptId,
          indiaRefset,
          specialty,
          doctorId,
        });
        const res = await fetch(`/api/snomed/search?${qs}`);
        const data = (await res.json()) as { results?: SnomedConcept[] };
        const list = Array.isArray(data.results) ? data.results : [];
        setResults(list);
        setIsOpen(list.length > 0 || (allowFreeTextNoCode && q.length >= 2));
      } catch (err) {
        console.error("SNOMED search failed", err);
        setResults([]);
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [
    query,
    hierarchy,
    allowFreeTextNoCode,
    bodySite,
    descendantOfConceptId,
    findingSiteConceptId,
    morphologyConceptId,
    indiaRefset,
    ecl,
    cacheFilter,
    conceptCacheType,
    specialty,
    doctorId,
  ]);

  if (!isMounted) {
    return <div className="h-[42px] w-full animate-pulse rounded-lg border border-gray-200 bg-gray-50" />;
  }

  const trimmedQuery = query.trim();
  const showFreeText =
    allowFreeTextNoCode && trimmedQuery.length >= 2 && !isLoading && results.length === 0;

  return (
    <div className="relative w-full">
      <div className={INPUT_WRAP}>
        {isLoading ? (
          <svg
            className="h-4 w-4 shrink-0 animate-spin text-blue-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            className="h-4 w-4 shrink-0 text-gray-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
        )}
        <input
          type="text"
          className={INPUT_FIELD}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        />
      </div>

      {isOpen && (results.length > 0 || showFreeText) && (
        <ul className={DROPDOWN_PANEL}>
          {results.map((item) => (
            <li
              key={item.conceptId}
              className="cursor-pointer px-3 py-2.5 hover:bg-blue-50"
              onMouseDown={() => {
                setQuery("");
                setIsOpen(false);
                if (recordSelectionUsage) void bumpCacheUsage(item, hierarchy);
                onSelect(item);
              }}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{item.term}</p>
                  <p className="mt-0.5 text-xs text-gray-400">SNOMED {item.conceptId}</p>
                  {item.lowConfidence ? (
                    <p className="mt-0.5 text-xs font-medium text-amber-700">Review match (body site)</p>
                  ) : null}
                </div>
                {item.icd10 ? (
                  <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 bg-blue-50">
                    {item.icd10}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
          {showFreeText && (
            <li className="border-t border-gray-100">
              <button
                type="button"
                className="w-full cursor-pointer px-3 py-2.5 text-left hover:bg-amber-50"
                onMouseDown={() => {
                  const t = trimmedQuery;
                  setQuery("");
                  setIsOpen(false);
                  onSelect({ term: t, conceptId: "", icd10: null });
                }}
              >
                <p className="text-sm font-medium text-amber-900">Add as free text (no SNOMED code)</p>
                <p className="mt-0.5 text-xs text-amber-800/80">&quot;{trimmedQuery}&quot;</p>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
