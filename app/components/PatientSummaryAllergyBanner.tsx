"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "../supabase";

/** Matches parsing used on the encounter chart for `patients.known_allergies`. */
export function parsePatientKnownAllergies(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Reads `patients.known_allergies` (no `patient_allergies` table in this project).
 * Dismiss state is in-memory only — banner returns after full page reload.
 */
export default function PatientSummaryAllergyBanner({
  patientId,
  onViewDetails,
}: {
  patientId: string;
  /** e.g. switch to Current Encounter where allergies are edited */
  onViewDetails?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [allergies, setAllergies] = useState<string[]>([]);

  useEffect(() => {
    const pid = patientId?.trim();
    if (!pid) {
      setAllergies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    void supabase
      .from("patients")
      .select("known_allergies")
      .eq("id", pid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setAllergies([]);
        } else {
          setAllergies(parsePatientKnownAllergies(data.known_allergies));
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (dismissed || loading) return null;

  const hasAllergies = allergies.length > 0;
  const list = allergies.join(", ");

  return (
    <div
      role="status"
      className={`relative w-full rounded-lg border px-4 py-3 pr-10 text-sm shadow-sm ${
        hasAllergies
          ? "border-orange-400/80 bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 text-red-950"
          : "border-emerald-300/80 bg-emerald-50 text-emerald-900"
      }`}
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-600 hover:bg-black/5"
        aria-label="Dismiss allergy notice"
      >
        <X className="h-4 w-4 shrink-0" strokeWidth={2} />
      </button>

      {hasAllergies ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-1 pr-2">
          <span className="shrink-0 font-bold tracking-wide">⚠️ ALLERGIES:</span>
          <span className="min-w-0 font-medium">{list}</span>
          <span className="shrink-0 text-red-900/80">—</span>
          {onViewDetails ? (
            <button
              type="button"
              onClick={onViewDetails}
              className="shrink-0 font-semibold text-red-800 underline decoration-red-800/60 underline-offset-2 hover:text-red-950"
            >
              View details
            </button>
          ) : (
            <span className="shrink-0 font-semibold text-red-800">View details</span>
          )}
        </div>
      ) : (
        <p className="pr-2 font-medium">✅ No known allergies documented</p>
      )}
    </div>
  );
}
