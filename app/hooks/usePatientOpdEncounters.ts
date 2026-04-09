"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { HealthTimelineNode } from "../lib/fhirEncounterTimeline";

export type OpdEncounterRow = {
  id: string;
  updated_at: string | null;
  created_at: string | null;
  encounter_date: string | null;
  status: string | null;
  chief_complaint: string | null;
  chief_complaint_term: string | null;
  diagnosis_term: string | null;
  encounter_number: string | null;
};

/** Timeline headline: readable at a glance (no encounter / OPD id). */
function rowToDisplayLabel(row: OpdEncounterRow): string {
  const ccTerm = row.chief_complaint_term?.trim();
  if (ccTerm) return ccTerm;
  const cc = row.chief_complaint?.trim();
  if (cc) return cc.length > 48 ? `${cc.slice(0, 45)}…` : cc;
  const dx = row.diagnosis_term?.trim();
  if (dx) return dx;
  return "Routine OPD Visit";
}

function mapRowToTimelineNode(row: OpdEncounterRow): HealthTimelineNode {
  const start = row.created_at ?? row.updated_at ?? new Date().toISOString();
  return {
    resourceType: "Encounter",
    id: row.id,
    status: row.status === "completed" ? "finished" : row.status === "draft" ? "planned" : "in-progress",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    period: { start, end: row.status === "completed" ? start : undefined },
    reasonCode: [
      {
        text: rowToDisplayLabel(row),
        coding: row.chief_complaint_term
          ? [{ system: "http://snomed.info/sct", display: row.chief_complaint_term }]
          : undefined,
      },
    ],
    _source: "live",
    _kind: "opd",
    _displayLabel: rowToDisplayLabel(row),
    _opdEncounterId: row.id,
  };
}

export function usePatientOpdEncounters(patientId: string | null) {
  const [rows, setRows] = useState<OpdEncounterRow[]>([]);
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
      .from("opd_encounters")
      .select(
        "id, updated_at, created_at, encounter_date, status, chief_complaint, chief_complaint_term, diagnosis_term, encounter_number",
      )
      .eq("patient_id", pid)
      .order("created_at", { ascending: true });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as OpdEncounterRow[]);
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const timelineNodes: HealthTimelineNode[] = rows.map(mapRowToTimelineNode);

  return { rows, timelineNodes, loading, error, refresh };
}
