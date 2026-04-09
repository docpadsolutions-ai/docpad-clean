"use client";

import { useEffect, useState } from "react";

export type SnomedConcept = {
  term: string;
  conceptId: string;
  icd10: string | null;
  /** Set when finding + bodySite search had no FSN match for the site — doctor should verify. */
  lowConfidence?: boolean;
};

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

/**
 * Chief complaint / diagnosis / etc. — searches `snomed_cache` first (via API), then CSIRO when the cache has no rows.
 * @param allowFreeTextNoCode When true and there are no matches, offer adding the typed text without a SNOMED code.
 * @param recordSelectionUsage When true (default), POST to `/api/snomed/cache-concept` after picking a coded result to increase `usage_count`.
 * @param descendantOfConceptId Narrow search to `(hierarchy root) AND << this concept` (numeric SCTID).
 * @param findingSiteConceptId Refine clinical hierarchies with finding-site attribute (numeric SCTID).
 * @param morphologyConceptId Refine clinical hierarchies with associated morphology (numeric SCTID).
 * @param indiaRefset Key from `INDIA_SNOMED_REFSET_IDS` (e.g. `orthopedics`) — intersects with India NRC refset via ECL.
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
}) {
  // ALL HOOKS MUST BE AT THE TOP
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
        const siteQ =
          hierarchy === "finding" && bodySite?.trim()
            ? `&bodySite=${encodeURIComponent(bodySite.trim())}`
            : "";
        const d = descendantOfConceptId?.trim()
          ? `&descendantOf=${encodeURIComponent(descendantOfConceptId.trim())}`
          : "";
        const fs = findingSiteConceptId?.trim()
          ? `&findingSiteConcept=${encodeURIComponent(findingSiteConceptId.trim())}`
          : "";
        const mo = morphologyConceptId?.trim()
          ? `&morphologyConcept=${encodeURIComponent(morphologyConceptId.trim())}`
          : "";
        const ir = indiaRefset?.trim() ? `&indiaRefset=${encodeURIComponent(indiaRefset.trim())}` : "";
        const url = `/api/snomed/search?q=${encodeURIComponent(query)}${hierarchy ? `&hierarchy=${hierarchy}` : ""}${siteQ}${d}${fs}${mo}${ir}`;
        const res = await fetch(url);
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
  ]);


  // --- HYDRATION SAFETY RENDER MUST BE PLACED *AFTER* ALL HOOKS ---
  if (!isMounted) {
    return <div className="h-[42px] w-full rounded-xl border border-gray-200 bg-gray-50 animate-pulse"></div>;
  }

  const trimmedQuery = query.trim();
  const showFreeText =
    allowFreeTextNoCode && trimmedQuery.length >= 2 && !isLoading && results.length === 0;

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
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
          className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        />
      </div>

      {isOpen && (results.length > 0 || showFreeText) && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
          {results.map((item) => (
            <li
              key={item.conceptId}
              className="cursor-pointer px-4 py-2.5 hover:bg-blue-50"
              onMouseDown={() => {
                setQuery("");
                setIsOpen(false);
                if (recordSelectionUsage) void bumpCacheUsage(item, hierarchy);
                onSelect(item);
              }}
            >
              <p className="text-sm font-medium text-gray-900">{item.term}</p>
              <p className="mt-0.5 text-xs text-gray-400">
                SNOMED: {item.conceptId}
                {item.icd10 && <> · ICD-10: {item.icd10}</>}
                {item.lowConfidence && (
                  <span className="ml-1.5 font-medium text-amber-700"> · Review match (body site)</span>
                )}
              </p>
            </li>
          ))}
          {showFreeText && (
            <li className="border-t border-gray-100">
              <button
                type="button"
                className="w-full cursor-pointer px-4 py-2.5 text-left hover:bg-amber-50"
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