"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { FhirMedicationRequest } from "@/lib/fhirMedicationRequest";
import { prescriptionRowToMedicationRequest } from "@/lib/prescriptionSummaryMap";

export type PatientSummaryCareTeam = {
  doctors: unknown[];
  facilities: unknown[];
};

export type PatientSummaryCompleteData = {
  header: unknown;
  medications: FhirMedicationRequest[];
  /** Set when `prescriptions` / fallback query fails (RPC bundle may still succeed). */
  medicationListError: string | null;
  timelineNodes: unknown[];
  careTeam: PatientSummaryCareTeam;
};

const EMPTY_CARE_TEAM: PatientSummaryCareTeam = { doctors: [], facilities: [] };

function getErrorMessage(err: unknown): string {
  if (err == null) return "An unexpected error occurred";
  if (typeof err === "string" && err.trim()) return err.trim();
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return "An unexpected error occurred";
}

function asArray<T = unknown>(v: unknown): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? (v as T[]) : [];
}

function asCareTeam(v: unknown): PatientSummaryCareTeam {
  if (v == null || typeof v !== "object" || Array.isArray(v)) {
    return { ...EMPTY_CARE_TEAM };
  }
  const o = v as Record<string, unknown>;
  return {
    doctors: asArray(o.doctors),
    facilities: asArray(o.facilities),
  };
}

const RX_SELECT_FULL =
  "id, encounter_id, medicine_name, drug_name, medication_name, medication, dosage_text, frequency, duration, instructions, clinical_indication, created_at";

const RX_SELECT_MIN =
  "id, encounter_id, medicine_name, dosage_text, frequency, duration, instructions, clinical_indication, created_at";

async function loadMedicationsForSummaryPatient(patientId: string): Promise<{
  list: FhirMedicationRequest[];
  err: string | null;
}> {
  const encounterLimit = 3;
  const { data: encs, error: encErr } = await supabase
    .from("opd_encounters")
    .select("id")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(encounterLimit);

  if (encErr) {
    return { list: [], err: encErr.message };
  }

  const ids = (encs ?? []).map((e) => String((e as { id: string }).id)).filter(Boolean);
  if (ids.length === 0) {
    return { list: [], err: null };
  }

  const queryTable = async (table: string, select: string) =>
    supabase.from(table).select(select).in("encounter_id", ids).order("created_at", { ascending: false });

  let { data: rxData, error: rxErr } = await queryTable("prescriptions", RX_SELECT_FULL);
  if (rxErr) {
    const retry = await queryTable("prescriptions", RX_SELECT_MIN);
    rxData = retry.data;
    rxErr = retry.error;
  }
  if (rxErr) {
    return { list: [], err: rxErr.message };
  }

  const loadOptionalTable = async (table: string): Promise<Record<string, unknown>[]> => {
    let { data, error } = await queryTable(table, RX_SELECT_FULL);
    if (error) {
      const retry = await queryTable(table, RX_SELECT_MIN);
      data = retry.data;
      error = retry.error;
    }
    if (error) return [];
    return (data ?? []) as unknown as Record<string, unknown>[];
  };

  const fromPrescriptions = (rxData ?? []) as unknown as Record<string, unknown>[];
  const fromOpd = await loadOptionalTable("opd_prescriptions");
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of [...fromPrescriptions, ...fromOpd]) {
    const id = r.id != null ? String(r.id) : "";
    if (id) byId.set(id, r);
  }
  const rows = [...byId.values()];

  rows.sort((a, b) => {
    const tb = Date.parse(String(b.created_at ?? "")) || 0;
    const ta = Date.parse(String(a.created_at ?? "")) || 0;
    return tb - ta;
  });

  return {
    list: rows.map((r) => prescriptionRowToMedicationRequest(r)),
    err: null,
  };
}

export function usePatientSummaryComplete(patientId: string | null) {
  const [data, setData] = useState<PatientSummaryCompleteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!patientId?.trim()) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const pid = patientId.trim();

    try {
      setLoading(true);
      setError(null);

      let headerData: unknown;
      try {
        const headerRes = await supabase.rpc("get_patient_header_data", { p_patient_id: pid });
        if (headerRes.error) {
          throw headerRes.error;
        }
        headerData = headerRes.data;
      } catch (err) {
        console.error("get_patient_header_data failed:", err);
        setError(new Error(getErrorMessage(err)));
        setData(null);
        return;
      }

      const [timelineRes, careTeamRes, medBundle] = await Promise.all([
        supabase.rpc("get_health_timeline_nodes", { p_patient_id: pid }),
        supabase.rpc("get_care_team", { p_patient_id: pid }),
        loadMedicationsForSummaryPatient(pid),
      ]);

      const firstErr = timelineRes.error ?? careTeamRes.error;
      if (firstErr) {
        throw firstErr;
      }

      const timelineData = timelineRes.data;
      const careTeamData = careTeamRes.data;

      setData({
        header: headerData,
        medications: medBundle.list,
        medicationListError: medBundle.err,
        timelineNodes: asArray(timelineData ?? []),
        careTeam: asCareTeam(careTeamData ?? EMPTY_CARE_TEAM),
      });
    } catch (err) {
      console.error("Error in usePatientSummaryComplete:", err);
      setError(new Error(getErrorMessage(err)));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
