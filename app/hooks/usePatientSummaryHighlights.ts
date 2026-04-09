"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";

export type PatientSummaryRow = {
  id?: string;
  patient_id: string;
  hospital_id: string | null;
  highlights_text: string | null;
  updated_at: string | null;
};

export function usePatientSummaryHighlights(patientId: string | null, orgId: string | null) {
  const [row, setRow] = useState<PatientSummaryRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const pid = patientId?.trim() ?? "";
    if (!pid) {
      setRow(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("patient_summaries")
      .select("id, patient_id, hospital_id, highlights_text, updated_at")
      .eq("patient_id", pid)
      .maybeSingle();

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setRow(null);
      return;
    }
    setRow((data as PatientSummaryRow | null) ?? null);
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Touch `updated_at` (and optionally persist current highlights text). */
  const touchUpdatedAt = useCallback(
    async (highlightsText: string) => {
      const pid = patientId?.trim() ?? "";
      if (!pid) return { error: new Error("No patient") };
      const oid = orgId?.trim() || null;
      const now = new Date().toISOString();
      const payload = {
        patient_id: pid,
        hospital_id: oid,
        highlights_text: highlightsText,
        updated_at: now,
      };
      const { data, error: upErr } = await supabase
        .from("patient_summaries")
        .upsert(payload, { onConflict: "patient_id" })
        .select("id, patient_id, hospital_id, highlights_text, updated_at")
        .single();
      if (upErr) return { error: new Error(upErr.message) };
      setRow(data as PatientSummaryRow);
      return { error: null };
    },
    [patientId, orgId],
  );

  return { row, loading, error, refresh, touchUpdatedAt };
}
