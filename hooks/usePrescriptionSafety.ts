"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type ActiveMedication = {
  prescription_id: string;
  encounter_id: string | null;
  medicine_name: string;
  generic_name: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  status: string | null;
  prescribed_at: string;
  expected_end: string | null;
  encounter_number: string | null;
  last_action: ReconciliationAction | null;
};

export type ReconciliationAction = "continue" | "stop" | "modify";

export type InteractionWarning = {
  drug_a: string;
  drug_b: string;
  severity: "contraindicated" | "severe" | "moderate" | "mild" | string;
  description: string | null;
  description_hi: string | null;
  clinical_effect: string | null;
  management: string | null;
  severity_rank: number | null;
  /** True when one side of the pair is a medication the patient is already on. */
  involves_active: boolean;
};

export type DuplicateWarning = {
  medicine_name: string;
  generic_name: string | null;
  active_medicine_name: string;
  active_prescription_id: string;
  active_since: string | null;
};

export type SafetyMedicineInput = { medicine_name: string; generic_name: string | null };

/** Two tiers only (SOW §3.2): hard stop, and passive advisory. */
export function isHardStopSeverity(severity: string | null | undefined): boolean {
  const s = (severity ?? "").toLowerCase();
  return s === "contraindicated" || s === "severe";
}

/**
 * An allergy the prescribed drug touches, graded.
 *
 * This used to be a substring match computed here, which meant (a) every match was a
 * hard stop, including "Peanuts", and (b) "penicillin" on file did not catch
 * amoxicillin. Both are now decided by `patient_allergy_matches` in the database, in
 * the same place the write is blocked, so the banner and the enforcement cannot
 * disagree with each other.
 */
export type AllergyMatch = {
  drug: string;
  allergen: string;
  category: "drug" | "food" | "environment" | "other" | "unknown" | string;
  severity: "mild" | "moderate" | "severe" | "anaphylaxis" | "unknown" | string;
  /** direct: the names overlap. same_group / related: curated cross-reactivity. */
  match: "direct" | "same_group" | "related" | string;
  /** Which curated group produced a cross-reactive match, if any. */
  via: string | null;
  note: string | null;
  /** The hard stop. An ungraded drug allergy blocks; `related` never blocks. */
  blocking: boolean;
};

type SafetyPayload = {
  active_medications: ActiveMedication[];
  interactions: InteractionWarning[];
  duplicates: DuplicateWarning[];
};

/**
 * SOW §2.2 — the patient's active medications, the interaction check run across those plus the
 * drugs being written now, and duplicate-therapy detection. One RPC, debounced on the medicine list.
 */
export function usePrescriptionSafety({
  patientId,
  encounterId,
  medicines,
  enabled = true,
}: {
  patientId: string | null | undefined;
  encounterId: string | null | undefined;
  medicines: SafetyMedicineInput[];
  enabled?: boolean;
}) {
  const [activeMedications, setActiveMedications] = useState<ActiveMedication[]>([]);
  const [interactions, setInteractions] = useState<InteractionWarning[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);
  const [allergyMatches, setAllergyMatches] = useState<AllergyMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const medicinesKey = useMemo(
    () => medicines.map((m) => `${m.medicine_name}|${m.generic_name ?? ""}`).join("~"),
    [medicines],
  );

  const run = useCallback(async () => {
    const pid = patientId?.trim();
    if (!enabled || !pid) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    const [safety, allergy] = await Promise.all([
      supabase.rpc("check_prescription_safety", {
        p_patient_id: pid,
        p_new_medicines: medicines,
        p_exclude_encounter: encounterId?.trim() || null,
      }),
      supabase.rpc("patient_allergy_matches", {
        p_patient_id: pid,
        p_medicines: medicines,
      }),
    ]);
    if (requestId !== requestIdRef.current) return; // a newer request already answered

    if (safety.error) {
      setError(safety.error.message);
      setLoading(false);
      return;
    }

    const payload = (safety.data ?? {}) as Partial<SafetyPayload>;
    setActiveMedications(payload.active_medications ?? []);
    setInteractions(payload.interactions ?? []);
    setDuplicates(payload.duplicates ?? []);
    // An allergy lookup that fails is reported but does not blank the rest of the
    // panel. The database blocks the write either way, so the banner going quiet
    // cannot turn into a prescription going through.
    setAllergyMatches(allergy.error ? [] : ((allergy.data ?? []) as AllergyMatch[]));
    setError(allergy.error ? allergy.error.message : null);
    setLoading(false);
    // medicines is represented by medicinesKey to keep the debounce stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, patientId, encounterId, medicinesKey]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      void run();
    }, 300);
    return () => clearTimeout(timer);
  }, [enabled, run]);

  return { activeMedications, interactions, duplicates, allergyMatches, loading, error, refresh: run };
}
