"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";

export type ActiveProblemRow = {
  id: string;
  patient_id: string;
  org_id: string;
  condition_name: string;
  snomed_code: string | null;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export function useActiveProblems(patientId: string | null) {
  const [rows, setRows] = useState<ActiveProblemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const pid = patientId?.trim() ?? "";
    if (!pid) {
      setRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("active_problems")
      .select("id, patient_id, org_id, condition_name, snomed_code, status, created_at, updated_at")
      .eq("patient_id", pid)
      .eq("status", "active")
      .order("condition_name", { ascending: true });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as ActiveProblemRow[]);
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, refresh };
}
