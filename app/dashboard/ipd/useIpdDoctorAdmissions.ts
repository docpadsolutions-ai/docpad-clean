"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { unwrapRpcArray } from "../../lib/ipdConsults";
import { supabase } from "../../supabase";

export type IpdDoctorAdmissionSummaryRow = {
  admission_id: string;
  /** Human-readable ref e.g. IPD-2026-000001 */
  admission_number?: string | null;
  /** Admit date/time for display (tooltip on HD badge) */
  admission_date?: string | null;
  bed_number?: string | null;
  ward_name?: string | null;
  patient_name?: string | null;
  age_years?: number | null;
  sex?: string | null;
  computed_hospital_day?: number | null;
  post_op_day?: number | null;
  known_allergies?: string | null;
  heart_rate?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  spo2?: number | null;
  temperature_c?: number | null;
  pain_score?: number | null;
  primary_diagnosis_display?: string | null;
  /** stable | guarded | critical (view may expose under another key; see normalizeRow) */
  clinical_status?: string | null;
  pending_investigations?: number | null;
  pending_treatments?: number | null;
  expected_discharge_date?: string | null;
  surgery_status?: string | null;
};

export type IpdCommandTab = "all" | "post_op" | "discharge" | "pending_admission";

/** Row shape from `get_pending_admissions` RPC (hospital-scoped). */
export type PendingIpdAdmissionRow = {
  admission_id: string;
  admission_number?: string | null;
  admission_type?: string | null;
  admitted_at?: string | null;
  primary_diagnosis?: string | null;
  patient_name?: string | null;
  patient_age?: number | null;
  patient_sex?: string | null;
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  doctor_name?: string | null;
};

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Normalize Supabase row keys and coerce numbers. */
export function normalizeIpdSummaryRow(raw: Record<string, unknown>): IpdDoctorAdmissionSummaryRow {
  const id =
    toStr(raw.admission_id) ??
    toStr(raw.id) ??
    (raw.admission_id != null ? String(raw.admission_id) : "");
  const clinical =
    toStr(raw.clinical_status) ??
    toStr(raw.acuity_status) ??
    toStr(raw.ward_acuity) ??
    toStr(raw.patient_acuity) ??
    toStr(raw.acute_status);

  return {
    admission_id: id,
    admission_number:
      toStr(raw.admission_number) ??
      toStr(raw.ipd_admission_number) ??
      toStr(raw.admission_ref) ??
      toStr(raw.reference_number),
    admission_date:
      toStr(raw.admission_date) ??
      toStr(raw.admit_date) ??
      toStr(raw.admitted_at) ??
      toStr(raw.admission_datetime),
    bed_number: toStr(raw.bed_number),
    ward_name: toStr(raw.ward_name),
    patient_name: toStr(raw.patient_name),
    age_years: toNum(raw.age_years),
    sex: toStr(raw.sex),
    computed_hospital_day: toNum(raw.computed_hospital_day),
    post_op_day: toNum(raw.post_op_day),
    known_allergies: toStr(raw.known_allergies),
    heart_rate: toNum(raw.heart_rate),
    bp_systolic: toNum(raw.bp_systolic),
    bp_diastolic: toNum(raw.bp_diastolic),
    spo2: toNum(raw.spo2),
    temperature_c:
      toNum(raw.temperature_c) ??
      toNum(raw.temperature) ??
      toNum(raw.temp_c) ??
      toNum(raw.temperature_celsius),
    pain_score: toNum(raw.pain_score) ?? toNum(raw.pain) ?? toNum(raw.pain_level),
    primary_diagnosis_display: toStr(raw.primary_diagnosis_display),
    clinical_status: clinical,
    pending_investigations: toNum(raw.pending_investigations),
    pending_treatments: toNum(raw.pending_treatments),
    expected_discharge_date: toStr(raw.expected_discharge_date),
    surgery_status: toStr(raw.surgery_status),
  };
}

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Compare date-only value to today (local); accepts ISO date or date string. */
export function isOnOrBeforeToday(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const t = value.trim();
  const dayPart = t.length >= 10 ? t.slice(0, 10) : t;
  const parsed = new Date(`${dayPart}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const today = startOfTodayLocal();
  return parsed.getTime() <= today.getTime();
}

function acuityRank(clinicalStatus: string | null): number {
  const s = clinicalStatus?.toLowerCase().trim() ?? "";
  if (s === "critical") return 0;
  if (s === "guarded") return 1;
  return 2;
}

export function sortIpdAdmissionRows(rows: IpdDoctorAdmissionSummaryRow[]): IpdDoctorAdmissionSummaryRow[] {
  return [...rows].sort((a, b) => {
    const ra = acuityRank(a.clinical_status ?? null);
    const rb = acuityRank(b.clinical_status ?? null);
    if (ra !== rb) return ra - rb;
    const da = toNum(a.computed_hospital_day) ?? 0;
    const db = toNum(b.computed_hospital_day) ?? 0;
    return db - da;
  });
}

function isSurgicalRow(row: IpdDoctorAdmissionSummaryRow): boolean {
  const pod = toNum(row.post_op_day);
  if (pod != null && pod > 0) return true;
  const st = row.surgery_status?.toLowerCase().trim();
  return st === "completed";
}

export function computeIpdDashboardStats(rows: IpdDoctorAdmissionSummaryRow[]) {
  let pendingLabs = 0;
  let forDischarge = 0;
  let surgical = 0;
  for (const r of rows) {
    const inv = toNum(r.pending_investigations);
    if (inv != null) pendingLabs += inv;
    if (isOnOrBeforeToday(r.expected_discharge_date ?? null)) forDischarge += 1;
    if (isSurgicalRow(r)) surgical += 1;
  }
  return {
    activePatients: rows.length,
    surgical,
    pendingLabs,
    forDischarge,
  };
}

export function filterRowsForTab(
  rows: IpdDoctorAdmissionSummaryRow[],
  tab: IpdCommandTab,
): IpdDoctorAdmissionSummaryRow[] {
  if (tab === "pending_admission") return [];
  if (tab === "all") return rows;
  if (tab === "post_op") return rows.filter((r) => (toNum(r.post_op_day) ?? 0) > 0);
  return rows.filter((r) => isOnOrBeforeToday(r.expected_discharge_date ?? null));
}

function normalizePendingAdmissionRow(raw: Record<string, unknown>): PendingIpdAdmissionRow | null {
  const id =
    toStr(raw.admission_id) ??
    toStr(raw.id) ??
    (raw.admission_id != null ? String(raw.admission_id).trim() : "");
  if (!id) return null;
  return {
    admission_id: id,
    admission_number: toStr(raw.admission_number) ?? toStr(raw.ipd_admission_number),
    admission_type: toStr(raw.admission_type),
    admitted_at:
      toStr(raw.admitted_at) ??
      toStr(raw.admission_date) ??
      toStr(raw.created_at) ??
      toStr(raw.pending_since),
    primary_diagnosis:
      toStr(raw.primary_diagnosis) ??
      toStr(raw.primary_diagnosis_display) ??
      toStr(raw.diagnosis_display) ??
      toStr(raw.diagnosis),
    patient_name: toStr(raw.patient_name) ?? toStr(raw.full_name),
    patient_age: toNum(raw.patient_age) ?? toNum(raw.age_years),
    patient_sex: toStr(raw.patient_sex) ?? toStr(raw.sex) ?? toStr(raw.gender),
    ward_name: toStr(raw.ward_name),
    bed_number: toStr(raw.bed_number),
    bed_type: toStr(raw.bed_type),
    doctor_name: toStr(raw.doctor_name) ?? toStr(raw.admitting_doctor_name),
  };
}

export function useIpdDoctorAdmissions(hospitalId: string | null) {
  const [rows, setRows] = useState<IpdDoctorAdmissionSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tab, setTab] = useState<IpdCommandTab>("all");

  const [pendingRows, setPendingRows] = useState<PendingIpdAdmissionRow[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setFetchError(null);
    }
    try {
      const { data, error } = await supabase.from("ipd_doctor_admissions_summary").select("*");
      if (error) {
        if (!silent) setFetchError(error.message);
        setRows([]);
        return;
      }
      const list = Array.isArray(data) ? data : [];
      const normalized = list
        .map((item) => normalizeIpdSummaryRow(item as Record<string, unknown>))
        .filter((r) => r.admission_id.trim().length > 0);
      setRows(normalized);
    } catch (e) {
      if (!silent) setFetchError(e instanceof Error ? e.message : "Failed to load admissions");
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadPending = useCallback(async (opts?: { silent?: boolean }) => {
    if (!hospitalId) {
      setPendingRows([]);
      setPendingLoading(false);
      return;
    }
    const silent = opts?.silent === true;
    if (!silent) {
      setPendingLoading(true);
      setPendingError(null);
    }
    const { data, error } = await supabase.rpc("get_pending_admissions", { p_hospital_id: hospitalId });
    if (error) {
      if (!silent) {
        setPendingError(error.message);
        setPendingRows([]);
      }
    } else {
      const list = unwrapRpcArray<Record<string, unknown>>(data)
        .map((item) => normalizePendingAdmissionRow(item))
        .filter((r): r is PendingIpdAdmissionRow => r != null);
      setPendingRows(list);
      if (!silent) setPendingError(null);
    }
    if (!silent) setPendingLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("pending-admissions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ipd_admissions", filter: `hospital_id=eq.${hospitalId}` },
        () => {
          void loadPending({ silent: true });
          void load({ silent: true });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hospitalId, load, loadPending]);

  const stats = useMemo(() => computeIpdDashboardStats(rows), [rows]);

  const tabCounts = useMemo(() => {
    const postOp = rows.filter((r) => (toNum(r.post_op_day) ?? 0) > 0).length;
    const discharge = rows.filter((r) => isOnOrBeforeToday(r.expected_discharge_date ?? null)).length;
    return { all: rows.length, postOp, discharge, pendingAdmission: pendingRows.length };
  }, [rows, pendingRows]);

  const displayRows = useMemo(() => {
    const filtered = filterRowsForTab(rows, tab);
    return sortIpdAdmissionRows(filtered);
  }, [rows, tab]);

  const commandCenterLoading = tab === "pending_admission" ? pendingLoading : loading;
  const commandCenterError = tab === "pending_admission" ? pendingError : fetchError;

  return {
    rows,
    displayRows,
    pendingAdmissionRows: pendingRows,
    stats,
    tabCounts,
    tab,
    setTab,
    loading,
    fetchError,
    commandCenterLoading,
    commandCenterError,
    refresh: load,
    refreshPending: loadPending,
  };
}

export type UseIpdDoctorAdmissionsResult = ReturnType<typeof useIpdDoctorAdmissions>;
