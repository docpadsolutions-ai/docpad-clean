"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { FhirMedicationRequest } from "../lib/fhirMedicationRequest";
import { prescriptionRowToMedicationRequest } from "../lib/prescriptionSummaryMap";

export type PrescriptionDbRow = {
  id: string;
  encounter_id: string;
  medicine_name: string | null;
  dosage_text: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  clinical_indication?: string | null;
  created_at?: string | null;
};

export function useRecentEncounterMedications(patientId: string | null, encounterLimit = 3) {
  const [requests, setRequests] = useState<FhirMedicationRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentEncounterIds, setRecentEncounterIds] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const pid = patientId?.trim() ?? "";
    if (!pid) {
      setRequests([]);
      setRecentEncounterIds([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);

    const { data: encs, error: encErr } = await supabase
      .from("opd_encounters")
      .select("id")
      .eq("patient_id", pid)
      .order("updated_at", { ascending: false })
      .limit(encounterLimit);

    if (encErr) {
      setLoading(false);
      setError(encErr.message);
      setRequests([]);
      setRecentEncounterIds([]);
      return;
    }

    const ids = (encs ?? []).map((e) => String((e as { id: string }).id)).filter(Boolean);
    setRecentEncounterIds(ids);

    if (ids.length === 0) {
      setLoading(false);
      setRequests([]);
      return;
    }

    const { data: rx, error: rxErr } = await supabase
      .from("prescriptions")
      .select(
        "id, encounter_id, medicine_name, dosage_text, frequency, duration, instructions, clinical_indication, created_at",
      )
      .in("encounter_id", ids)
      .order("created_at", { ascending: false });

    setLoading(false);
    if (rxErr) {
      setError(rxErr.message);
      setRequests([]);
      return;
    }

    const rows = (rx ?? []) as PrescriptionDbRow[];
    setRequests(rows.map((r) => prescriptionRowToMedicationRequest(r as Record<string, unknown>)));
  }, [patientId, encounterLimit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { requests, loading, error, refresh, recentEncounterIds };
}
