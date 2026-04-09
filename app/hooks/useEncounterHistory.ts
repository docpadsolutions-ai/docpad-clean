"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";

/**
 * Logical FHIR Encounter mapping (R4):
 * - Resource: Encounter (backed by `opd_encounters` in DocPad — there is no separate `encounters` table).
 * - status: planned | in-progress | finished (from row.status)
 * - class: ambulatory (AMB / OPD), future IPD → IMP, EMER → EMER
 */

export type FhirEncounterStatusCode = "planned" | "in-progress" | "finished" | "unknown";
export type FhirEncounterClassCode = "AMB" | "IMP" | "EMER";

export type EncounterHistoryRow = {
  id: string;
  hospital_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Raw DB status */
  status: string | null;
  fhirStatus: FhirEncounterStatusCode;
  fhirClass: FhirEncounterClassCode;
  /** UI badge: OPD | IPD | Emergency */
  typeBadge: "OPD" | "IPD" | "Emergency";
  chief_complaint: string | null;
  chief_complaint_term: string | null;
  diagnosis_term: string | null;
  blood_pressure: string | null;
  pulse: string | null;
  weight: string | null;
  temperature: string | null;
  quick_exam: unknown;
  examination_term: string | null;
  plan_details: unknown;
  practitioner: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    specialty: string | null;
  } | null;
  organizationName: string | null;
  prescriptionCount: number;
  investigationSummaries: string[];
};

function mapDbStatusToFhir(status: string | null): FhirEncounterStatusCode {
  const s = (status ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (s === "completed") return "finished";
  if (s === "draft" || s === "scheduled") return "planned";
  if (s === "in_progress" || s === "inprogress") return "in-progress";
  return "unknown";
}

/** DocPad OPD rows map to ambulatory; extend when IPD/ED tables exist. */
function inferClassAndBadge(_row: {
  status: string | null;
}): { fhirClass: FhirEncounterClassCode; typeBadge: "OPD" | "IPD" | "Emergency" } {
  return { fhirClass: "AMB", typeBadge: "OPD" };
}

function pickEmbedded<T extends Record<string, unknown>>(v: unknown): T | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as T;
  return null;
}

function investigationsFromQuickExam(raw: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const s = String(x ?? "").trim();
      if (/^investigation\s*:/i.test(s)) {
        out.push(s.replace(/^investigation\s*:\s*/i, "").trim());
      }
    }
    return out;
  }
  if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(/[;,]/).map((p) => p.trim()).filter(Boolean)) {
      if (/^investigation\s*:/i.test(part)) {
        out.push(part.replace(/^investigation\s*:\s*/i, "").trim());
      }
    }
  }
  return out;
}

function withDrPrefix(displayName: string): string {
  const t = displayName.trim();
  if (!t) return "";
  if (/^dr\.?\s/i.test(t)) return t;
  return `Dr. ${t}`;
}

/** Uses `practitioners.full_name` from the encounter join; falls back to first + last name. */
export function formatDoctorName(
  p: {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null,
): string {
  if (!p) return "Provider not assigned";
  const full = (p.full_name ?? "").trim();
  if (full) return withDrPrefix(full);
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const n = [fn, ln].filter(Boolean).join(" ");
  return n ? withDrPrefix(n) : "Provider not assigned";
}

export function useEncounterHistory(patientId: string | null) {
  const [rows, setRows] = useState<EncounterHistoryRow[]>([]);
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

    const { data: encData, error: encErr } = await supabase
      .from("opd_encounters")
      .select(
        `
        id,
        hospital_id,
        created_at,
        updated_at,
        status,
        chief_complaint,
        chief_complaint_term,
        diagnosis_term,
        blood_pressure,
        pulse,
        weight,
        temperature,
        quick_exam,
        examination_term,
        plan_details,
        practitioner:practitioners!doctor_id(full_name, first_name, last_name, specialty)
      `,
      )
      .eq("patient_id", pid)
      .order("created_at", { ascending: false });

    if (encErr) {
      setLoading(false);
      setError(encErr.message);
      setRows([]);
      return;
    }

    const rawList = (encData ?? []) as Record<string, unknown>[];
    const ids = rawList.map((r) => String(r.id ?? "")).filter(Boolean);
    const orgIds = [
      ...new Set(
        rawList
          .map((r) => (r.hospital_id != null ? String(r.hospital_id).trim() : ""))
          .filter(Boolean),
      ),
    ];

    const orgNameById = new Map<string, string>();
    if (orgIds.length > 0) {
      const { data: orgRows } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      for (const o of orgRows ?? []) {
        const rec = o as { id: string; name: string | null };
        if (rec.id) orgNameById.set(String(rec.id), (rec.name ?? "").trim() || "Facility");
      }
    }

    const rxCountByEncounter = new Map<string, number>();
    if (ids.length > 0) {
      const { data: rxRows } = await supabase.from("prescriptions").select("encounter_id").in("encounter_id", ids);
      for (const r of rxRows ?? []) {
        const eid = String((r as { encounter_id?: string }).encounter_id ?? "");
        if (!eid) continue;
        rxCountByEncounter.set(eid, (rxCountByEncounter.get(eid) ?? 0) + 1);
      }
    }

    const mapped: EncounterHistoryRow[] = rawList.map((r) => {
      const id = String(r.id ?? "");
      const status = r.status != null ? String(r.status) : null;
      const { fhirClass, typeBadge } = inferClassAndBadge({ status });
      const pr = pickEmbedded<{
        full_name?: unknown;
        first_name?: unknown;
        last_name?: unknown;
        specialty?: unknown;
      }>(r.practitioner);
      const practitioner = pr
        ? {
            full_name: pr.full_name != null ? String(pr.full_name) : null,
            first_name: pr.first_name != null ? String(pr.first_name) : null,
            last_name: pr.last_name != null ? String(pr.last_name) : null,
            specialty: pr.specialty != null ? String(pr.specialty) : null,
          }
        : null;
      const oid = r.hospital_id != null ? String(r.hospital_id).trim() : "";
      return {
        id,
        hospital_id: oid || null,
        created_at: r.created_at != null ? String(r.created_at) : null,
        updated_at: r.updated_at != null ? String(r.updated_at) : null,
        status,
        fhirStatus: mapDbStatusToFhir(status),
        fhirClass,
        typeBadge,
        chief_complaint: r.chief_complaint != null ? String(r.chief_complaint) : null,
        chief_complaint_term: r.chief_complaint_term != null ? String(r.chief_complaint_term) : null,
        diagnosis_term: r.diagnosis_term != null ? String(r.diagnosis_term) : null,
        blood_pressure: r.blood_pressure != null ? String(r.blood_pressure) : null,
        pulse: r.pulse != null ? String(r.pulse) : null,
        weight: r.weight != null ? String(r.weight) : null,
        temperature: r.temperature != null ? String(r.temperature) : null,
        quick_exam: r.quick_exam,
        examination_term: r.examination_term != null ? String(r.examination_term) : null,
        plan_details: r.plan_details,
        practitioner,
        organizationName: oid ? orgNameById.get(oid) ?? null : null,
        prescriptionCount: rxCountByEncounter.get(id) ?? 0,
        investigationSummaries: investigationsFromQuickExam(r.quick_exam),
      };
    });

    setLoading(false);
    setRows(mapped);
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, refresh, totalCount: rows.length };
}

export function formatEncounterDateTime(iso: string | null): string {
  if (!iso?.trim()) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 16);
  const d = new Date(t);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function followUpLabel(planDetails: unknown): string | null {
  if (!planDetails || typeof planDetails !== "object" || Array.isArray(planDetails)) return null;
  const fu = (planDetails as { follow_up_date?: unknown }).follow_up_date;
  if (fu == null || String(fu).trim() === "") return null;
  const t = Date.parse(String(fu));
  if (!Number.isFinite(t)) return `Follow-up scheduled: ${String(fu).trim()}`;
  return `Follow-up scheduled: ${new Date(t).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}

export function chiefComplaintDisplay(row: EncounterHistoryRow): string {
  const term = row.chief_complaint_term?.trim();
  const line = row.chief_complaint?.trim();
  return term || line || "—";
}

export function examinationVitalsLine(row: EncounterHistoryRow): string {
  const parts: string[] = [];
  const bp = row.blood_pressure?.trim();
  const pulse = row.pulse?.trim();
  const wt = row.weight?.trim();
  const temp = row.temperature?.trim();
  if (bp) parts.push(`BP: ${bp}`);
  if (pulse) parts.push(`Pulse: ${pulse}/min`);
  if (wt) parts.push(`Weight: ${wt} kg`);
  if (temp) parts.push(`Temp: ${temp}`);
  const extra = row.examination_term?.trim();
  if (extra) parts.push(extra);
  return parts.length > 0 ? parts.join(", ") : "—";
}
