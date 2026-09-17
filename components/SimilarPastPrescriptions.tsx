"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getSuggestedPrescriptions, type SuggestedPrescription } from "@/app/actions/getSuggestedPrescriptions";

interface Props {
  query: string;
  practitionerId: string;
  onSelect: (contentText: string) => void;
}

const MIN_QUERY_LEN = 8;
const DEBOUNCE_MS = 700;

function isFallbackContent(text: string) {
  return text.startsWith("Encounter ");
}

function FlipCard({
  suggestion,
  onSelect,
}: {
  suggestion: SuggestedPrescription;
  onSelect: (text: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const isFallback = isFallbackContent(suggestion.content_text);

  return (
    <div
      className="w-52 shrink-0"
      style={{ perspective: "800px", height: "110px" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
          transition: "transform 0.42s cubic-bezier(0.4,0.2,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* ── Front face ── */}
        <div
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          className="absolute inset-0 flex cursor-pointer flex-col gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2.5 shadow-sm transition-shadow hover:border-violet-400 hover:shadow-md"
          role="button"
          tabIndex={0}
          aria-label="Flip to see prescription details"
          onClick={() => setFlipped(true)}
          onKeyDown={(e) => e.key === "Enter" && setFlipped(true)}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
              {Math.round(suggestion.similarity * 100)}% match
            </span>
            <span className="ml-auto text-[10px] text-violet-300">tap to preview →</span>
          </div>
          <p className="line-clamp-3 text-[11px] leading-relaxed text-gray-600">
            {isFallback ? (
              <span className="italic text-gray-400">Prescription (no summary saved)</span>
            ) : (
              suggestion.content_text
            )}
          </p>
        </div>

        {/* ── Back face ── */}
        <div
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
          className="absolute inset-0 flex flex-col rounded-xl border border-violet-400 bg-violet-600 px-3 py-2.5 shadow-md"
        >
          <p className="flex-1 overflow-y-auto text-[10.5px] leading-relaxed text-violet-50">
            {isFallback ? (
              <span className="italic text-violet-300">No prescription text was saved for this encounter.</span>
            ) : (
              suggestion.content_text
            )}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFlipped(false);
              }}
              className="rounded-lg border border-violet-400 bg-transparent px-2 py-1 text-[10px] font-semibold text-violet-200 transition hover:bg-violet-500"
            >
              ← Back
            </button>
            {!isFallback && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(suggestion.content_text);
                  setFlipped(false);
                }}
                className="flex-1 rounded-lg bg-white px-2 py-1 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-50"
              >
                Use this ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SimilarPastPrescriptions({ query, practitionerId, onSelect }: Props) {
  const [suggestions, setSuggestions] = useState<SuggestedPrescription[]>([]);
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef("");

  useEffect(() => {
    if (query.trim() !== lastQueryRef.current) {
      setDismissed(false);
    }
  }, [query]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LEN || !practitionerId) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      lastQueryRef.current = trimmed;
      startTransition(async () => {
        const results = await getSuggestedPrescriptions(trimmed, practitionerId);
        setSuggestions(results);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, practitionerId]);

  if (dismissed || (!isPending && suggestions.length === 0)) return null;

  return (
    <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <svg
            className="h-3.5 w-3.5 shrink-0 text-violet-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path
              d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 0 2-2h2a2 2 0 0 0 2 2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">
            Similar past prescriptions
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[10px] text-violet-400 hover:text-violet-600"
          aria-label="Dismiss suggestions"
        >
          Dismiss
        </button>
      </div>

      {isPending ? (
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ height: "110px" }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-full w-52 shrink-0 animate-pulse rounded-xl border border-violet-100 bg-violet-100/60"
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {suggestions.map((s, i) => (
            <FlipCard
              key={s.id ?? `idx-${i}`}
              suggestion={s}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
