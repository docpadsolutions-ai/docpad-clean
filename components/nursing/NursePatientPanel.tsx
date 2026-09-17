"use client";

import { formatDistanceToNow } from "date-fns";
import { Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { practitionerRoleRawFromRow } from "@/lib/practitionerAuthLookup";
import { normalizePractitionerRole } from "@/lib/userRole";
import IpdNursingVitalsTimeline from "@/components/nursing/IpdNursingVitalsTimeline";
import RecordIpdNursingVitalsModal from "@/components/nursing/RecordIpdNursingVitalsModal";
import ShiftHandoverNote from "@/components/ipd/nursing/ShiftHandoverNote";
import WoundDrainDoc from "@/components/ipd/nursing/WoundDrainDoc";
import { NursingProcedureLogger } from "@/components/paramedical/NursingProcedureLogger";
import MARView from "@/components/ipd/nursing/MARView";
import {
  allergiesListFromPatient,
  patientFromAdmission,
  preAdmissionFrom,
} from "@/lib/ipdAdmissionDisplay";
import { normalizeIpdAdmissionBundle, rpcGetIpdAdmission } from "@/lib/ipdData";
import type { NursingShiftUi } from "@/lib/nursingShift";
import { cn } from "@/lib/utils";
import { isMarSlotOverdue } from "@/components/ipd/nursing/marOverdue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** First instant of admission calendar day in local TZ (from any ISO instant on that day). */
function parseAdmissionLocalStart(iso: string): Date | null {
  const t = s(iso);
  if (!t) return null;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return null;
  return startOfLocalDay(new Date(ms));
}

function ymdFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Hospital day 1 = admission local date; Day N = admission + (N − 1) calendar days. */
function hospitalDayNumberForDate(admissionStart: Date, ref: Date): number {
  const diffMs = startOfLocalDay(ref).getTime() - admissionStart.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.max(1, diffDays + 1);
}

function calendarDateForHospitalDay(admissionStart: Date, dayNum: number): Date {
  const d = new Date(admissionStart);
  d.setDate(d.getDate() + (dayNum - 1));
  return startOfLocalDay(d);
}

/** India (IST) calendar-day bounds for `timestamptz` filters on `recorded_at`. */
function istDayBoundsIso(ymd: string): { startIso: string; endIso: string } {
  return {
    startIso: `${ymd}T00:00:00+05:30`,
    endIso: `${ymd}T23:59:59+05:30`,
  };
}

/** Local calendar day bounds as UTC ISO strings for timestamptz filters (inclusive end). */
function localDayBoundsUtcIso(ymd: string): { startIso: string; endIso: string } {
  const parts = ymd.split("-").map((x) => Number.parseInt(x, 10));
  const y = parts[0];
  const mo = parts[1];
  const da = parts[2];
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) {
    const n = new Date();
    const iso = n.toISOString();
    return { startIso: iso, endIso: iso };
  }
  const start = new Date(y, mo - 1, da, 0, 0, 0, 0);
  const end = new Date(y, mo - 1, da, 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function triBool(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "—";
}

function formatCurrentMedicationsField(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) {
    const parts = v.map((x) => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        return s(o.name ?? o.label ?? o.medication ?? o.text ?? o.brand_name);
      }
      return s(x);
    });
    const t = parts.filter(Boolean).join(", ").trim();
    return t || "—";
  }
  const str = s(v);
  return str || "—";
}

function consentTitleFromRow(row: Record<string, unknown>): string {
  const nested = asRec(row.consent_type) ?? asRec(row.type) ?? asRec(row.ipd_consent_type);
  return (
    s(row.type_name) ||
    s(row.display_name) ||
    s(nested?.display_name) ||
    s(nested?.type_name) ||
    s(nested?.name) ||
    s(row.consent_type_name) ||
    s(row.name) ||
    "Consent"
  );
}

function consentStatusLabel(row: Record<string, unknown>): string {
  const st = s(row.status).toLowerCase();
  if (st === "signed" || st === "obtained" || st === "completed") return "Signed";
  if (st === "waived") return "Waived";
  if (st === "pending") return "Pending";
  return s(row.status) || "—";
}

/** Attribution line: avoid doubling an existing "Dr." prefix. */
function displayDoctorAttribution(name: string): string {
  const t = name.trim();
  if (!t) return "—";
  return /^dr\.?\s/i.test(t) ? t : `Dr. ${t}`;
}

function fallRiskLevel(score: number): "Low" | "Medium" | "High" {
  if (score <= 7) return "Low";
  if (score <= 13) return "Medium";
  return "High";
}

export type NursePatientPanelProps = {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  nursePractitionerId: string;
  /** Ward shift used for care plan (same as portal selector). */
  selectedShift: NursingShiftUi;
  /** Admission instant (ISO). Hospital Day 1 = local calendar date of admission. */
  admittedAt: string;
  admissionId: string;
  patientId: string;
  patientName: string;
  patientAge: number | null;
  patientSex: string | null;
  bedLabel: string;
  wardName: string;
  doctorName: string | null;
  allergiesText: string | null;
  onVitalsSaved: () => void;
};

type VitalsHistoryRow = Record<string, unknown>;

type DoctorOrderRow = Record<string, unknown>;

type CarePlanRow = Record<string, unknown> | null;

type InterventionRow = { intervention: string; frequency: string };

const inputCls =
  "w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const tabBtn = (active: boolean) =>
  cn(
    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
    active ? "bg-blue-600 text-white shadow-sm" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50",
  );

export default function NursePatientPanel({
  open,
  onClose,
  hospitalId,
  nursePractitionerId,
  selectedShift,
  admittedAt,
  admissionId,
  patientId,
  patientName,
  patientAge,
  patientSex,
  bedLabel,
  wardName,
  doctorName,
  allergiesText,
  onVitalsSaved,
}: NursePatientPanelProps) {
  const [tab, setTab] = useState<
    "vitals" | "mar" | "orders" | "care" | "handover" | "wound" | "procedures" | "doctor" | "file"
  >("vitals");

  const admissionStart = useMemo(() => parseAdmissionLocalStart(admittedAt), [admittedAt]);

  const maxHospitalDay = useMemo(() => {
    if (!admissionStart) return 1;
    return hospitalDayNumberForDate(admissionStart, new Date());
  }, [admissionStart]);

  const [selectedDay, setSelectedDay] = useState(1);

  /** Reset default day only when opening the panel or switching admissions — not when `admittedAt` string churns (same admission). */
  const dayTabResetAdmissionRef = useRef<string>("");

  const selectedCalendarYmd = useMemo(() => {
    if (!admissionStart) return todayYmd();
    return ymdFromLocalDate(calendarDateForHospitalDay(admissionStart, selectedDay));
  }, [admissionStart, selectedDay]);

  const minVitalsYmd = useMemo(() => {
    if (!admissionStart) return "2000-01-01";
    return ymdFromLocalDate(admissionStart);
  }, [admissionStart]);

  const maxSelectableYmd = useMemo(() => {
    if (!admissionStart) return todayYmd();
    return ymdFromLocalDate(calendarDateForHospitalDay(admissionStart, maxHospitalDay));
  }, [admissionStart, maxHospitalDay]);

  const [vitalsModalOpen, setVitalsModalOpen] = useState(false);
  const [recorderShowGcs, setRecorderShowGcs] = useState(false);

  const [ipdContextLoading, setIpdContextLoading] = useState(false);
  const [admissionBundle, setAdmissionBundle] = useState<Record<string, unknown> | null>(null);

  const [doctorNoteLoading, setDoctorNoteLoading] = useState(false);
  const [doctorNoteRow, setDoctorNoteRow] = useState<Record<string, unknown> | null>(null);
  const [doctorInv, setDoctorInv] = useState<Record<string, unknown>[]>([]);
  const [doctorTx, setDoctorTx] = useState<Record<string, unknown>[]>([]);
  const [doctorAuthorName, setDoctorAuthorName] = useState<string>("");

  const [vitalsLoading, setVitalsLoading] = useState(false);
  const [vitalsHistory, setVitalsHistory] = useState<VitalsHistoryRow[]>([]);

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orders, setOrders] = useState<DoctorOrderRow[]>([]);
  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);

  /** Overdue pending MAR doses for the selected hospital day (panel + ward list). */
  const [marOverdueCount, setMarOverdueCount] = useState(0);

  const [careLoading, setCareLoading] = useState(false);
  const [careRow, setCareRow] = useState<CarePlanRow>(null);
  const [careDiag, setCareDiag] = useState("");
  const [careGoal, setCareGoal] = useState("");
  const [careInterventions, setCareInterventions] = useState<InterventionRow[]>([{ intervention: "", frequency: "" }]);
  const [fallScore, setFallScore] = useState("");
  const [braden, setBraden] = useState("");
  const [carePain, setCarePain] = useState(0);
  const [carePainIx, setCarePainIx] = useState("");
  const [eduGiven, setEduGiven] = useState("");
  const [eduUnderstood, setEduUnderstood] = useState(false);
  const [careSaving, setCareSaving] = useState(false);
  const [careFormOpen, setCareFormOpen] = useState(false);

  const loadVitalsHistory = useCallback(async () => {
    setVitalsLoading(true);
    const dateStr = selectedCalendarYmd;
    const { startIso, endIso } = istDayBoundsIso(dateStr);
    const { data, error } = await supabase
      .from("ipd_nursing_vitals")
      .select("*")
      .eq("admission_id", admissionId)
      .gte("recorded_at", startIso)
      .lte("recorded_at", endIso)
      .order("recorded_at", { ascending: true });
    setVitalsLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (data ?? []) as VitalsHistoryRow[];
    const ids = [...new Set(rows.map((r) => s(r.recorded_by)).filter(Boolean))];
    const nameMap = new Map<string, string>();
    if (ids.length > 0) {
      const { data: prs, error: pErr } = await supabase.from("practitioners").select("id, full_name").in("id", ids);
      if (!pErr && prs) {
        for (const p of prs as { id: string; full_name?: unknown }[]) {
          nameMap.set(s(p.id), s(p.full_name) || "—");
        }
      }
    }
    const merged = rows.map((r) => {
      const rid = s(r.recorded_by);
      return {
        ...r,
        practitioners: { full_name: nameMap.get(rid) ?? "—" },
      };
    });
    setVitalsHistory(merged);
  }, [admissionId, selectedCalendarYmd]);

  const refreshMarOverdueCount = useCallback(async () => {
    const aid = s(admissionId);
    const ymd = selectedCalendarYmd;
    if (!aid || !ymd) {
      setMarOverdueCount(0);
      return;
    }
    const { data, error } = await supabase
      .from("ipd_mar")
      .select("scheduled_date, scheduled_time, status")
      .eq("admission_id", aid)
      .eq("scheduled_date", ymd)
      .eq("status", "pending");
    if (error) {
      console.warn("[NursePatientPanel] MAR overdue:", error.message);
      setMarOverdueCount(0);
      return;
    }
    let n = 0;
    for (const raw of Array.isArray(data) ? data : []) {
      const o = raw as Record<string, unknown>;
      const sd = s(o.scheduled_date);
      const stime = s(o.scheduled_time);
      if (isMarSlotOverdue(sd || ymd, stime)) n += 1;
    }
    setMarOverdueCount(n);
  }, [admissionId, selectedCalendarYmd]);

  const onMarOverdueFromView = useCallback((n: number) => {
    setMarOverdueCount(n);
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    const { startIso, endIso } = localDayBoundsUtcIso(selectedCalendarYmd);
    const { data, error } = await supabase
      .from("ipd_doctor_orders")
      .select("*")
      .eq("admission_id", admissionId)
      .eq("order_category", "nursing")
      .eq("status", "active")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: true });
    setOrdersLoading(false);
    if (error) {
      toast.error(error.message);
      setOrders([]);
      return;
    }
    setOrders((data ?? []) as DoctorOrderRow[]);
  }, [admissionId, selectedCalendarYmd]);

  const loadCare = useCallback(async () => {
    setCareLoading(true);
    const { data, error } = await supabase
      .from("ipd_nursing_care_plans")
      .select("*")
      .eq("admission_id", admissionId)
      .eq("plan_date", selectedCalendarYmd)
      .eq("shift", selectedShift)
      .maybeSingle();
    setCareLoading(false);
    if (error) {
      toast.error(error.message);
      setCareRow(null);
      return;
    }
    const row = (data ?? null) as CarePlanRow;
    setCareRow(row);
    if (row && typeof row === "object") {
      setCareFormOpen(true);
      const r = row as Record<string, unknown>;
      setCareDiag(s(r.nursing_diagnosis));
      setCareGoal(s(r.patient_goal));
      const rawIv = r.interventions;
      let rows: InterventionRow[] = [{ intervention: "", frequency: "" }];
      if (Array.isArray(rawIv)) {
        rows = (rawIv as unknown[]).map((x) => {
          if (x && typeof x === "object") {
            const o = x as Record<string, unknown>;
            return { intervention: s(o.intervention ?? o.text), frequency: s(o.frequency) };
          }
          return { intervention: String(x), frequency: "" };
        });
        if (rows.length === 0) rows = [{ intervention: "", frequency: "" }];
      } else if (typeof rawIv === "string" && rawIv.trim()) {
        try {
          const j = JSON.parse(rawIv) as unknown;
          if (Array.isArray(j)) {
            rows = j.map((x) =>
              x && typeof x === "object"
                ? {
                    intervention: s((x as Record<string, unknown>).intervention ?? (x as Record<string, unknown>).text),
                    frequency: s((x as Record<string, unknown>).frequency),
                  }
                : { intervention: String(x), frequency: "" },
            );
          }
        } catch {
          /* ignore */
        }
      }
      setCareInterventions(rows);
      setFallScore(r.fall_risk_score != null ? String(r.fall_risk_score) : "");
      setBraden(r.braden_score != null ? String(r.braden_score) : "");
      setCarePain(num(r.pain_score) ?? num(r.nursing_pain_score) ?? 0);
      setCarePainIx(s(r.pain_intervention));
      setEduGiven(s(r.education_given));
      setEduUnderstood(Boolean(r.education_understood));
    } else {
      setCareFormOpen(false);
      setCareDiag("");
      setCareGoal("");
      setCareInterventions([{ intervention: "", frequency: "" }]);
      setFallScore("");
      setBraden("");
      setCarePain(0);
      setCarePainIx("");
      setEduGiven("");
      setEduUnderstood(false);
    }
  }, [admissionId, selectedShift, selectedCalendarYmd]);

  const loadIpdEncounterContext = useCallback(async () => {
    if (!admissionId) return;
    setIpdContextLoading(true);
    try {
      const { data: raw, error: admErr } = await rpcGetIpdAdmission(supabase, admissionId);
      if (admErr) {
        toast.error(admErr.message);
        setAdmissionBundle(null);
      } else {
        setAdmissionBundle(normalizeIpdAdmissionBundle(raw) as Record<string, unknown> | null);
      }
    } finally {
      setIpdContextLoading(false);
    }
  }, [admissionId]);

  const loadDoctorNoteForSelectedDay = useCallback(async () => {
    if (!admissionId) {
      setDoctorNoteRow(null);
      setDoctorInv([]);
      setDoctorTx([]);
      setDoctorAuthorName("");
      return;
    }
    const { startIso, endIso } = localDayBoundsUtcIso(selectedCalendarYmd);
    setDoctorNoteLoading(true);
    try {
      const { data: notes, error: nErr } = await supabase
        .from("ipd_progress_notes")
        .select("*")
        .eq("admission_id", admissionId)
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false })
        .limit(1);
      if (nErr) {
        toast.error(nErr.message);
        setDoctorNoteRow(null);
        setDoctorInv([]);
        setDoctorTx([]);
        setDoctorAuthorName("");
        return;
      }
      const note = Array.isArray(notes) && notes.length > 0 ? (notes[0] as Record<string, unknown>) : null;
      if (!note) {
        setDoctorNoteRow(null);
        setDoctorInv([]);
        setDoctorTx([]);
        setDoctorAuthorName("");
        return;
      }
      const nid = s(note.id);
      setDoctorNoteRow(note);
      const [invR, txR] = await Promise.all([
        supabase
          .from("ipd_investigation_orders")
          .select("*")
          .eq("progress_note_id", nid)
          .order("created_at", { ascending: false }),
        supabase
          .from("ipd_treatments")
          .select("*")
          .eq("progress_note_id", nid)
          .order("ordered_date", { ascending: false }),
      ]);
      setDoctorInv((invR.data ?? []) as Record<string, unknown>[]);
      setDoctorTx((txR.data ?? []) as Record<string, unknown>[]);

      let name = s(note.authored_by_name);
      const aid = s(note.authored_by);
      if (!name && aid) {
        const { data: pr } = await supabase.from("practitioners").select("full_name").eq("id", aid).maybeSingle();
        name = s(pr?.full_name);
      }
      setDoctorAuthorName(name);
    } finally {
      setDoctorNoteLoading(false);
    }
  }, [admissionId, selectedCalendarYmd]);

  useEffect(() => {
    if (!open || !admissionId) return;
    void loadIpdEncounterContext();
  }, [open, admissionId, loadIpdEncounterContext]);

  useEffect(() => {
    if (!open) {
      dayTabResetAdmissionRef.current = "";
      return;
    }
    if (!admissionStart) return;
    const key = admissionId;
    if (dayTabResetAdmissionRef.current === key) return;
    dayTabResetAdmissionRef.current = key;
    const def = hospitalDayNumberForDate(admissionStart, new Date());
    setSelectedDay(def);
  }, [open, admissionId, admissionStart]);

  useEffect(() => {
    setSelectedDay((d) => Math.min(Math.max(1, d), maxHospitalDay));
  }, [maxHospitalDay]);

  useEffect(() => {
    if (!open || tab !== "doctor") return;
    void loadDoctorNoteForSelectedDay();
  }, [open, tab, selectedCalendarYmd, loadDoctorNoteForSelectedDay]);

  useEffect(() => {
    if (!open || !nursePractitionerId) return;
    void (async () => {
      const { data, error } = await supabase.from("practitioners").select("role, user_role").eq("id", nursePractitionerId).maybeSingle();
      if (error || !data) {
        setRecorderShowGcs(false);
        return;
      }
      const raw = practitionerRoleRawFromRow(data as { role?: unknown; user_role?: unknown });
      const n = normalizePractitionerRole(raw);
      setRecorderShowGcs(n === "nurse" || n === "doctor");
    })();
  }, [open, nursePractitionerId]);

  useEffect(() => {
    if (!open || !admissionId) return;
    void loadVitalsHistory();
  }, [open, admissionId, selectedCalendarYmd, loadVitalsHistory]);

  useEffect(() => {
    if (!open) {
      setMarOverdueCount(0);
      return;
    }
    void refreshMarOverdueCount();
  }, [open, refreshMarOverdueCount]);

  useEffect(() => {
    if (!open || !admissionId) return;
    const dateStr = selectedCalendarYmd;
    const channel = supabase
      .channel(`vitals-${admissionId}-${dateStr}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ipd_nursing_vitals",
          filter: `admission_id=eq.${admissionId}`,
        },
        (payload) => {
          const row = payload.new as VitalsHistoryRow;
          const ra = s(row.recorded_at);
          if (!ra) return;
          const t = Date.parse(ra);
          if (Number.isNaN(t)) return;
          const start = Date.parse(`${dateStr}T00:00:00+05:30`);
          const end = Date.parse(`${dateStr}T23:59:59+05:30`);
          if (t < start || t > end) return;

          void (async () => {
            const rid = s(row.recorded_by);
            let merged: VitalsHistoryRow = { ...row, practitioners: { full_name: "—" } };
            if (rid) {
              const { data: pr } = await supabase.from("practitioners").select("full_name").eq("id", rid).maybeSingle();
              merged = {
                ...row,
                practitioners: { full_name: s((pr as { full_name?: unknown } | null)?.full_name) || "—" },
              };
            }
            setVitalsHistory((prev) => {
              const id = s(merged.id);
              if (id && prev.some((p) => s(p.id) === id)) return prev;
              return [...prev, merged];
            });
          })();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, admissionId, selectedCalendarYmd]);

  useEffect(() => {
    if (!open || !admissionId) return;
    void loadOrders();
    void loadCare();
  }, [open, admissionId, selectedCalendarYmd, loadOrders, loadCare]);

  async function ackOrder(orderId: string) {
    setOrderBusyId(orderId);
    const { error } = await supabase
      .from("ipd_doctor_orders")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: nursePractitionerId,
      })
      .eq("id", orderId);
    setOrderBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    void loadOrders();
  }

  async function completeOrder(orderId: string) {
    setOrderBusyId(orderId);
    const { error } = await supabase
      .from("ipd_doctor_orders")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    setOrderBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    void loadOrders();
  }

  async function saveCarePlan() {
    setCareSaving(true);
    const interventionsPayload = careInterventions
      .filter((x) => x.intervention.trim() || x.frequency.trim())
      .map((x) => ({ intervention: x.intervention.trim(), frequency: x.frequency.trim() }));
    const base: Record<string, unknown> = {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      plan_date: selectedCalendarYmd,
      shift: selectedShift,
      nursing_diagnosis: careDiag.trim() || null,
      patient_goal: careGoal.trim() || null,
      interventions: interventionsPayload,
      fall_risk_score: fallScore.trim() ? Number.parseInt(fallScore, 10) : null,
      braden_score: braden.trim() ? Number.parseInt(braden, 10) : null,
      pain_score: carePain,
      pain_intervention: carePainIx.trim() || null,
      education_given: eduGiven.trim() || null,
      education_understood: eduUnderstood,
      updated_at: new Date().toISOString(),
    };
    const existingId = careRow && typeof careRow === "object" ? s((careRow as Record<string, unknown>).id) : "";
    let error;
    if (existingId) {
      const res = await supabase.from("ipd_nursing_care_plans").update(base).eq("id", existingId);
      error = res.error;
    } else {
      const res = await supabase.from("ipd_nursing_care_plans").insert({
        ...base,
        created_by: nursePractitionerId,
      });
      error = res.error;
    }
    setCareSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Care plan saved");
    void loadCare();
  }

  const fs = num(fallScore);
  const fallLevel = fs != null && !Number.isNaN(fs) ? fallRiskLevel(fs) : null;

  const mergedAdmissionForFile = useMemo(() => {
    if (!admissionBundle) return null;
    const adm = asRec(admissionBundle.admission) ?? {};
    return {
      ...adm,
      patient: admissionBundle.patient,
      pre_admission: admissionBundle.pre_admission,
      ward: admissionBundle.ward,
      bed: admissionBundle.bed,
    } as Record<string, unknown>;
  }, [admissionBundle]);

  const patientForFile = patientFromAdmission(mergedAdmissionForFile);
  const preForFile = preAdmissionFrom(mergedAdmissionForFile);
  const fileAllergies = useMemo(() => allergiesListFromPatient(patientForFile), [patientForFile]);
  const fileBloodGroup = s(patientForFile?.blood_group ?? patientForFile?.blood_type);
  const filePmh = s(preForFile?.pmh_text);
  const fileCurrentMeds = formatCurrentMedicationsField(preForFile?.current_medications);
  const fileConsents = useMemo(() => {
    const c = admissionBundle?.consents;
    return Array.isArray(c) ? (c as Record<string, unknown>[]) : [];
  }, [admissionBundle]);

  const doctorNoteStatus = s(doctorNoteRow?.status).toLowerCase();
  const isDoctorNoteDraft = doctorNoteStatus === "draft";

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close patient panel"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-gray-900">{patientName}</p>
          <p className="text-xs text-gray-500">
            {patientAge != null ? `${patientAge} yrs` : "—"} · {patientSex ?? "—"} · {wardName} · Bed {bedLabel}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Doctor: {doctorName ? `Dr. ${doctorName}` : "—"}
          </p>
          {ipdContextLoading && !admissionBundle && !admissionStart ? (
            <p className="mt-2 text-[10px] text-gray-400">Loading admission…</p>
          ) : admissionStart ? (
            <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Hospital day">
              {Array.from({ length: maxHospitalDay }, (_, i) => {
                const d = i + 1;
                const ymd = ymdFromLocalDate(calendarDateForHospitalDay(admissionStart, d));
                const isToday = ymd === todayYmd();
                const isSel = selectedDay === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelectedDay(d)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                      isSel
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50",
                      isToday && !isSel && "ring-2 ring-emerald-400/80",
                    )}
                  >
                    Day {d}
                    {isToday ? <span className="ml-1 font-normal opacity-90">· Today</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-amber-800">
              Admission date missing — day filters use today only. Vitals use recorded time in your timezone.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100"
        >
          Close
        </button>
      </div>
      {allergiesText ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950">
          Allergies: {allergiesText}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-gray-200 px-3 py-2">
        <button type="button" className={tabBtn(tab === "vitals")} onClick={() => setTab("vitals")}>
          Vitals
        </button>
        <button
          type="button"
          className={cn(tabBtn(tab === "mar"), "inline-flex items-center gap-1.5")}
          onClick={() => setTab("mar")}
        >
          Meds
          {marOverdueCount > 0 ? (
            <span
              className="inline-flex min-h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white tabular-nums ring-2 ring-white/90"
              aria-label={`${marOverdueCount} overdue dose${marOverdueCount > 1 ? "s" : ""}`}
            >
              {marOverdueCount > 99 ? "99+" : marOverdueCount}
            </span>
          ) : null}
        </button>
        <button type="button" className={tabBtn(tab === "orders")} onClick={() => setTab("orders")}>
          Orders
        </button>
        <button type="button" className={tabBtn(tab === "care")} onClick={() => setTab("care")}>
          Care plan
        </button>
        <button type="button" className={tabBtn(tab === "handover")} onClick={() => setTab("handover")}>
          Handover
        </button>
        <button type="button" className={tabBtn(tab === "wound")} onClick={() => setTab("wound")}>
          Wound / drain
        </button>
        <button type="button" className={tabBtn(tab === "procedures")} onClick={() => setTab("procedures")}>
          Procedure log
        </button>
        <button type="button" className={tabBtn(tab === "doctor")} onClick={() => setTab("doctor")}>
          Doctor&apos;s Notes
        </button>
        <button type="button" className={tabBtn(tab === "file")} onClick={() => setTab("file")}>
          Patient File
        </button>
      </div>

      {marOverdueCount > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span aria-hidden>⚠️</span>
          <span>
            {marOverdueCount} dose{marOverdueCount > 1 ? "s" : ""} overdue for{" "}
            <time dateTime={selectedCalendarYmd} className="font-semibold tabular-nums">
              {selectedCalendarYmd}
            </time>{" "}
            — open <span className="font-semibold">Meds</span> to administer or mark held/omitted.
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === "vitals" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">Vitals timeline</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  Viewing{" "}
                  <time dateTime={selectedCalendarYmd} className="font-medium text-gray-800">
                    {selectedCalendarYmd}
                  </time>
                  {selectedCalendarYmd === todayYmd() ? " · Today" : null}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Label htmlFor="ipd-vitals-date" className="text-[10px] uppercase text-gray-500">
                    Date
                  </Label>
                  <Input
                    id="ipd-vitals-date"
                    type="date"
                    className="h-9 w-[11rem] text-sm"
                    value={selectedCalendarYmd}
                    min={minVitalsYmd}
                    max={maxSelectableYmd}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v || !admissionStart) return;
                      const dayNum = hospitalDayNumberForDate(admissionStart, new Date(`${v}T12:00:00`));
                      setSelectedDay(Math.min(Math.max(1, dayNum), maxHospitalDay));
                    }}
                  />
                </div>
              </div>
              <Button type="button" className="h-9 shrink-0" onClick={() => setVitalsModalOpen(true)}>
                + Record Vitals Now
              </Button>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Readings</p>
              {vitalsLoading ? (
                <div className="mt-2 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
                  ))}
                </div>
              ) : (
                <div className="mt-2">
                  <IpdNursingVitalsTimeline rows={vitalsHistory} />
                </div>
              )}
            </div>

            <RecordIpdNursingVitalsModal
              open={vitalsModalOpen}
              onClose={() => setVitalsModalOpen(false)}
              hospitalId={hospitalId}
              admissionId={admissionId}
              patientId={patientId}
              recordedByPractitionerId={nursePractitionerId}
              showGcsField={recorderShowGcs}
              onSaved={() => {
                onVitalsSaved();
                void loadVitalsHistory();
              }}
            />
          </div>
        ) : null}

        {tab === "mar" ? (
          <MARView
            admissionId={admissionId}
            hospitalId={hospitalId}
            viewDateYmd={selectedCalendarYmd}
            onOverdueCountChange={onMarOverdueFromView}
          />
        ) : null}

        {tab === "orders" ? (
          <div className="space-y-3">
            {ordersLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-gray-500">No active nursing orders for this day.</p>
            ) : (
              orders.map((o) => {
                const oid = s(o.id);
                const text = s(o.order_text ?? o.instructions ?? o.instruction ?? o.description ?? "Order");
                const pri = s(o.priority ?? "routine");
                const created = s(o.created_at);
                return (
                  <div key={oid} className="rounded-lg border border-gray-200 p-3 text-sm">
                    <p className="font-medium text-gray-900">{text}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium capitalize">{pri}</span>
                      <span>{created ? formatDistanceToNow(new Date(created), { addSuffix: true }) : ""}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={orderBusyId === oid || !!o.acknowledged_at}
                        onClick={() => void ackOrder(oid)}
                      >
                        Acknowledge
                      </Button>
                      <Button type="button" size="sm" className="h-8" disabled={orderBusyId === oid} onClick={() => void completeOrder(oid)}>
                        Mark complete
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        {tab === "care" ? (
          <div className="space-y-4">
            {careLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
                ))}
              </div>
            ) : !careRow && !careFormOpen ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
                <p className="text-sm text-gray-600">No care plan for this shift yet.</p>
                <Button type="button" className="mt-3" size="sm" onClick={() => setCareFormOpen(true)}>
                  Create care plan
                </Button>
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs text-gray-600">Nursing diagnosis</Label>
                  <Textarea className={cn(inputCls, "mt-1 min-h-[72px]")} value={careDiag} onChange={(e) => setCareDiag(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Patient goal</Label>
                  <Textarea className={cn(inputCls, "mt-1 min-h-[72px]")} value={careGoal} onChange={(e) => setCareGoal(e.target.value)} />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-gray-600">Interventions</Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-blue-600"
                      onClick={() => setCareInterventions((rows) => [...rows, { intervention: "", frequency: "" }])}
                    >
                      + Add
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {careInterventions.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Intervention"
                          className="h-9 text-xs"
                          value={row.intervention}
                          onChange={(e) =>
                            setCareInterventions((rows) => rows.map((r, i) => (i === idx ? { ...r, intervention: e.target.value } : r)))
                          }
                        />
                        <Input
                          placeholder="Frequency"
                          className="h-9 text-xs"
                          value={row.frequency}
                          onChange={(e) =>
                            setCareInterventions((rows) => rows.map((r, i) => (i === idx ? { ...r, frequency: e.target.value } : r)))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-600">Fall risk (0–20)</Label>
                    <Input
                      className={cn(inputCls, "mt-1")}
                      value={fallScore}
                      onChange={(e) => setFallScore(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    />
                    {fallLevel ? (
                      <p className="mt-1 text-[11px] text-gray-600">
                        Level: <span className="font-semibold">{fallLevel}</span>
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600">Braden (6–23)</Label>
                    <Input className={cn(inputCls, "mt-1")} value={braden} onChange={(e) => setBraden(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Pain (0–10)</Label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={carePain}
                    onChange={(e) => setCarePain(Number.parseInt(e.target.value, 10))}
                    className="mt-2 w-full accent-blue-600"
                  />
                  <p className="text-xs text-gray-600">{carePain}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Pain intervention</Label>
                  <Input className={cn(inputCls, "mt-1")} value={carePainIx} onChange={(e) => setCarePainIx(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Education given</Label>
                  <Textarea className={cn(inputCls, "mt-1 min-h-[64px]")} value={eduGiven} onChange={(e) => setEduGiven(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={eduUnderstood} onChange={(e) => setEduUnderstood(e.target.checked)} />
                  Education understood
                </label>
                <Button type="button" disabled={careSaving} onClick={() => void saveCarePlan()}>
                  {careSaving ? "Saving…" : careRow ? "Update care plan" : "Save care plan"}
                </Button>
              </>
            )}
          </div>
        ) : null}

        {tab === "handover" ? (
          <ShiftHandoverNote
            admissionId={admissionId}
            patientId={patientId}
            hospitalId={hospitalId}
            nursePractitionerId={nursePractitionerId}
            patientName={patientName}
            bedLabel={bedLabel}
            wardName={wardName}
            shiftUi={selectedShift}
            shiftDateYmd={todayYmd()}
          />
        ) : null}

        {tab === "wound" ? (
          <WoundDrainDoc
            admissionId={admissionId}
            patientId={patientId}
            hospitalId={hospitalId}
            practitionerId={nursePractitionerId}
          />
        ) : null}

        {tab === "procedures" ? (
          <NursingProcedureLogger
            hospitalId={hospitalId}
            patientId={patientId}
            admissionId={admissionId}
            className="border-0 bg-transparent p-0 shadow-none"
          />
        ) : null}

        {tab === "doctor" ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-600">
              <span aria-hidden>🔒</span> Read only · Clinical notes by {displayDoctorAttribution(doctorAuthorName)}
            </p>
            {isDoctorNoteDraft ? (
              <div className="rounded-lg border border-amber-200/90 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Draft — doctor hasn&apos;t signed yet
              </div>
            ) : null}
            {doctorNoteLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : !doctorNoteRow ? (
              <p className="text-sm text-gray-500">
                No doctor progress note for {selectedCalendarYmd}. Notes are filtered by the day tabs above (created time in
                your timezone).
              </p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50/90 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Subjective</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">
                    {s(doctorNoteRow.subjective_text) || "—"}
                  </p>
                  <dl className="mt-3 grid gap-2 text-xs text-gray-800 sm:grid-cols-2">
                    <div>
                      <dt className="text-gray-500">Pain score (0–10)</dt>
                      <dd className="font-medium tabular-nums">
                        {num(doctorNoteRow.pain_score) != null ? String(num(doctorNoteRow.pain_score)) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Sleep</dt>
                      <dd className="font-medium">{triBool(doctorNoteRow.sleep_ok)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Bowel</dt>
                      <dd className="font-medium">{triBool(doctorNoteRow.bowel_ok)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Bladder</dt>
                      <dd className="font-medium">{triBool(doctorNoteRow.bladder_ok)}</dd>
                    </div>
                    {s(doctorNoteRow.appetite) ? (
                      <div className="sm:col-span-2">
                        <dt className="text-gray-500">Appetite</dt>
                        <dd className="font-medium">{s(doctorNoteRow.appetite)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/90 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Examination findings</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">
                    {s(doctorNoteRow.objective_text) || "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/90 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Assessment</p>
                  <p className="mt-2 text-sm">
                    <span className="text-gray-500">Condition: </span>
                    <span className="font-medium text-gray-900">{s(doctorNoteRow.condition_status) || "—"}</span>
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">
                    {s(doctorNoteRow.assessment_text) || "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/90 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Plan</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">
                    {s(doctorNoteRow.plan_narrative) || "—"}
                  </p>
                  {s(doctorNoteRow.medical_surgical_notes) ? (
                    <div className="mt-3 border-t border-gray-200 pt-3">
                      <p className="text-[11px] font-semibold text-gray-500">Surgical plan</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                        {s(doctorNoteRow.medical_surgical_notes)}
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <p className="text-[11px] font-semibold text-gray-500">Medications ordered</p>
                    {doctorTx.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">None recorded for this day</p>
                    ) : (
                      <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-gray-900">
                        {doctorTx.map((t, i) => (
                          <li key={s(t.id) || i}>
                            {s(t.brand_name ?? t.medication_name ?? t.drug_name ?? t.name ?? "Medication")}
                            {s(t.dose) ? ` — ${s(t.dose)}` : ""}
                            {s(t.route) ? ` (${s(t.route)})` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <p className="text-[11px] font-semibold text-gray-500">Investigations ordered</p>
                    {doctorInv.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">None recorded for this day</p>
                    ) : (
                      <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-gray-900">
                        {doctorInv.map((inv, i) => (
                          <li key={s(inv.id) || i}>
                            {s(inv.test_name ?? inv.investigation_name ?? inv.name ?? inv.short_code ?? "Investigation")}
                            {s(inv.status) ? ` — ${s(inv.status)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {tab === "file" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
              <Lock className="h-3.5 w-3.5 shrink-0 text-black" strokeWidth={2.5} aria-hidden />
              <span>Patient file — read-only</span>
            </div>
            {ipdContextLoading && !admissionBundle ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <Lock className="h-3 w-3 text-black" aria-hidden />
                    Known allergies
                  </div>
                  <p className="mt-2 text-sm text-gray-900">
                    {fileAllergies.length > 0 ? fileAllergies.join(", ") : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <Lock className="h-3 w-3 text-black" aria-hidden />
                    Blood group
                  </div>
                  <p className="mt-2 text-sm text-gray-900">{fileBloodGroup || "—"}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <Lock className="h-3 w-3 text-black" aria-hidden />
                    Past medical history (pre-admission)
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">{filePmh || "—"}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <Lock className="h-3 w-3 text-black" aria-hidden />
                    Current medications (pre-admission)
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">{fileCurrentMeds}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <Lock className="h-3 w-3 text-black" aria-hidden />
                    Consents on file
                  </div>
                  {fileConsents.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">—</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {fileConsents.map((c, i) => (
                        <li
                          key={s(c.id) || `c-${i}`}
                          className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5 text-sm text-gray-900"
                        >
                          <span className="font-medium">{consentTitleFromRow(c)}</span>
                          <span className="text-xs text-gray-600">{consentStatusLabel(c)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
    </>
  );
}
