"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertBanner } from "@/src/components/ui/alert-banner";
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

function countSeverities(allergies: string[]): { severe: number; moderate: number } {
  let severe = 0;
  let moderate = 0;
  for (const raw of allergies) {
    const t = raw.toLowerCase();
    if (/\bsevere\b|high risk|anaphylaxis|anaphylactic\b/.test(t)) severe += 1;
    else if (/\bmoderate\b|moderate risk\b/.test(t)) moderate += 1;
    else moderate += 1;
  }
  return { severe, moderate };
}

/**
 * Full-width allergy strip — **only rendered when the patient has documented allergies**.
 * Dismiss state is in-memory only; critical tier requires explicit confirmation to dismiss.
 */
export default function PatientSummaryAllergyBanner({
  patientId,
  onViewDetails,
}: {
  patientId: string;
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

  const counts = useMemo(() => countSeverities(allergies), [allergies]);

  if (dismissed || loading) return null;

  const hasAllergies = allergies.length > 0;
  if (!hasAllergies) return null;

  return (
    <AlertBanner
      severity="critical"
      title="Allergies on record"
      body={`${counts.severe} severe · ${counts.moderate} moderate — review before prescribing, transfusions, or procedures.`}
      onDismiss={() => setDismissed(true)}
      action={
        onViewDetails ? (
          <button
            type="button"
            onClick={onViewDetails}
            className="rounded-lg bg-red-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-900"
          >
            View details
          </button>
        ) : undefined
      }
    />
  );
}
