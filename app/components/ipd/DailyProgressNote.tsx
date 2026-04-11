"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Lock, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import {
  acknowledgeCriticalInvestigation,
  insertIpdTreatmentRow,
  rpcGetDpnFullNote,
  rpcGetDpnRightPanel,
  rpcGetDpnTimeline,
  rpcOrderDpnInvestigation,
  rpcSignDpnNote,
  rpcUpsertDpnNote,
} from "@/app/lib/ipdDpn";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import ErrorBanner from "@/app/components/ErrorBanner";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function ymdToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDayShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** e.g. "11 Apr 2026" */
function fmtDmy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export interface DailyProgressNoteProps {
  admissionId: string;
  hospitalId: string;
  patientId: string;
}

type ConditionKey = "Improving" | "Stable" | "Plateauing" | "Deteriorating" | "Critical";

const CONDITIONS: ConditionKey[] = ["Improving", "Stable", "Plateauing", "Deteriorating", "Critical"];

function conditionButtonClass(c: ConditionKey, selected: boolean): string {
  if (!selected) {
    return "rounded-full border border-slate-200 bg-transparent px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200";
  }
  switch (c) {
    case "Improving":
      return "rounded-full border border-emerald-600 bg-emerald-600 px-3 py-1 text-xs font-medium text-white dark:bg-emerald-500";
    case "Stable":
    case "Plateauing":
      return "rounded-full border border-amber-600 bg-amber-600 px-3 py-1 text-xs font-medium text-white dark:bg-amber-950/80 dark:text-amber-50";
    case "Deteriorating":
    case "Critical":
      return "rounded-full border border-red-600 bg-red-600 px-3 py-1 text-xs font-medium text-white dark:bg-red-500";
    default:
      return "";
  }
}

const APPETITE = ["Good", "Poor", "Nil"] as const;
const DISCHARGE_TYPES = ["None", "Serous", "Serosanguinous", "Purulent"] as const;
const SUTURES = ["Intact", "Partial", "Removed", "Staples"] as const;
const SWELLING = ["None", "Mild", "Moderate", "Severe"] as const;
const ERYTHEMA = ["None", "Mild", "Moderate", "Severe"] as const;
const DIETS = ["Nil", "Clear liquid", "Liquid", "Soft", "Normal", "Diabetic"] as const;
const ACTIVITY = [
  "Bed rest",
  "Sit out",
  "Amb. assisted",
  "Amb. independent",
  "Partial WB",
  "Full WB",
] as const;
const INV_CATS = ["Lab", "Imaging", "Microbiology", "ECG", "Echo", "Other"] as const;
const PRIOS = ["Routine", "Urgent", "STAT"] as const;
const MED_ROUTES = ["IV", "IM", "SC", "PO", "SL", "TOP", "INH"] as const;
const MED_FREQ = ["OD", "BD", "TID", "QID", "SOS", "PRN", "Continuous"] as const;

function conditionPillClass(status: string): string {
  const t = status.toLowerCase();
  if (t.includes("critical") || t.includes("deteriorat")) {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  }
  if (t.includes("improv") || t.includes("fit for discharge")) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  }
  if (t.includes("stable") || t.includes("plateau")) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  }
  if (t.includes("poor")) {
    return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function invStatusPill(st: string): { label: string; cls: string } {
  const t = st.toLowerCase();
  if (t.includes("report")) return { label: "Reported", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" };
  if (t.includes("pend")) return { label: "Pending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" };
  if (t.includes("crit")) return { label: "Critical", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" };
  return { label: "Ordered", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" };
}

function parseFullNoteBundle(raw: Record<string, unknown>) {
  let root = raw;
  const nested = asRec(raw.data);
  if (nested && ("note" in nested || "vitals" in nested)) {
    root = nested;
  }
  const note = asRec(root.note) ?? root;
  const vitalsRaw = root.vitals ?? root.latest_vitals ?? root.vitals_row;
  const vitals =
    Array.isArray(vitalsRaw) && vitalsRaw.length > 0
      ? asRec(vitalsRaw[0])
      : asRec(vitalsRaw);
  const wound = asRec(root.wound ?? root.wound_assessment);
  const io = asRec(root.io ?? root.io_record ?? root.fluid_balance);
  const investigations = arr<Record<string, unknown>>(root.investigations);
  const treatments = arr<Record<string, unknown>>(root.treatments);
  const nabh = asRec(root.nabh ?? root.nabh_checklist);
  const author = asRec(root.author);
  return { note, vitals, wound, io, investigations, treatments, nabh, author };
}

type Draft = {
  subjective_text: string;
  appetite: string;
  sleep_ok: boolean | null;
  bowel_ok: boolean | null;
  bladder_ok: boolean | null;
  objective_text: string;
  discharge_type: string;
  sutures: string;
  swelling: string;
  erythema: string;
  drain_ml: string;
  iv_ml: string;
  urine_ml: string;
  assessment_text: string;
  condition_status: string;
  plan_narrative: string;
  vte_ok: boolean | null;
  fall_assessed: boolean | null;
  pressure_ok: boolean | null;
  consent_ok: boolean | null;
  diet_order: string;
  activity: string;
  iv_access_site: string;
  discharge_notes: string;
};

function emptyDraft(): Draft {
  return {
    subjective_text: "",
    appetite: "",
    sleep_ok: null,
    bowel_ok: null,
    bladder_ok: null,
    objective_text: "",
    discharge_type: "None",
    sutures: "Intact",
    swelling: "None",
    erythema: "None",
    drain_ml: "",
    iv_ml: "",
    urine_ml: "",
    assessment_text: "",
    condition_status: "Stable",
    plan_narrative: "",
    vte_ok: null,
    fall_assessed: null,
    pressure_ok: null,
    consent_ok: null,
    diet_order: "Normal",
    activity: "Bed rest",
    iv_access_site: "",
    discharge_notes: "",
  };
}

function draftFromServer(
  note: Record<string, unknown>,
  wound: Record<string, unknown> | null,
  io: Record<string, unknown> | null,
  nabh: Record<string, unknown> | null,
): Draft {
  const d = emptyDraft();
  d.subjective_text = s(note.subjective_text ?? note.subjective);
  d.objective_text = s(note.objective_text ?? note.objective);
  d.assessment_text = s(note.assessment_text);
  d.plan_narrative = s(note.plan_narrative);
  d.appetite = s(note.appetite);
  d.condition_status = s(note.condition_status) || "Stable";
  d.sleep_ok = typeof note.sleep_ok === "boolean" ? note.sleep_ok : note.sleep_ok == null ? null : Boolean(note.sleep_ok);
  d.bowel_ok = typeof note.bowel_ok === "boolean" ? note.bowel_ok : note.bowel_ok == null ? null : Boolean(note.bowel_ok);
  d.bladder_ok = typeof note.bladder_ok === "boolean" ? note.bladder_ok : note.bladder_ok == null ? null : Boolean(note.bladder_ok);

  if (wound) {
    d.discharge_type = s(wound.discharge_type) || d.discharge_type;
    d.sutures = s(wound.sutures ?? wound.suture_status) || d.sutures;
    d.swelling = s(wound.swelling) || d.swelling;
    d.erythema = s(wound.erythema) || d.erythema;
  }
  if (io) {
    d.drain_ml = s(io.drain_output_ml ?? io.drain_ml);
    d.iv_ml = s(io.iv_fluid_ml ?? io.iv_fluids_in_ml ?? io.iv_ml);
    d.urine_ml = s(io.urine_output_ml ?? io.urine_ml);
  }
  if (nabh) {
    d.vte_ok = typeof nabh.vte_prophylaxis_given === "boolean" ? nabh.vte_prophylaxis_given : null;
    d.fall_assessed = typeof nabh.fall_risk_assessed === "boolean" ? nabh.fall_risk_assessed : null;
    d.pressure_ok = typeof nabh.pressure_sore_checked === "boolean" ? nabh.pressure_sore_checked : null;
    d.consent_ok = typeof nabh.consent_valid === "boolean" ? nabh.consent_valid : null;
    d.diet_order = s(nabh.diet_order) || d.diet_order;
    d.activity = s(nabh.activity_order ?? nabh.activity ?? nabh.activity_level) || d.activity;
    d.iv_access_site = s(nabh.iv_access_site);
    d.discharge_notes = s(nabh.discharge_notes);
  }
  return d;
}

function buildUpsertPayload(
  admissionId: string,
  hospitalId: string,
  patientId: string,
  noteDate: string,
  noteId: string | undefined,
  draft: Draft,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    p_admission_id: admissionId,
    p_hospital_id: hospitalId,
    p_patient_id: patientId,
    p_note_date: noteDate,
    p_subjective_text: draft.subjective_text || null,
    p_objective_text: draft.objective_text || null,
    p_assessment_text: draft.assessment_text || null,
    p_plan_narrative: draft.plan_narrative || null,
    p_appetite: draft.appetite || null,
    p_sleep_ok: draft.sleep_ok,
    p_bowel_ok: draft.bowel_ok,
    p_bladder_ok: draft.bladder_ok,
    p_condition_status: draft.condition_status || null,
  };
  if (noteId) payload.p_note_id = noteId;
  return payload;
}

function SectionBadge({ letter, label, className }: { letter: string; label: string; className: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        className,
      )}
    >
      {letter} · {label}
    </span>
  );
}

export default function DailyProgressNote({ admissionId, hospitalId, patientId }: DailyProgressNoteProps) {
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([]);
  const [rightPanel, setRightPanel] = useState<Record<string, unknown> | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [noteDate, setNoteDate] = useState<string>("");
  const [bundle, setBundle] = useState<ReturnType<typeof parseFullNoteBundle> | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [loadingRight, setLoadingRight] = useState(true);
  const [loadingNote, setLoadingNote] = useState(false);
  const [practitionerId, setPractitionerId] = useState<string>("");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [signBusy, setSignBusy] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({ name: "", category: "Lab", priority: "Routine" });
  const [addMedOpen, setAddMedOpen] = useState(false);
  const [medForm, setMedForm] = useState({ name: "", dose: "", route: "IV", freq: "OD", days: "" });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const skipNextDebouncedSave = useRef(true);

  const debouncedDraft = useDebouncedValue(draft, 1200);

  const loadTimeline = useCallback(async () => {
    setLoadingTimeline(true);
    const { rows, error } = await rpcGetDpnTimeline(supabase, admissionId);
    if (error) setSaveErr(error.message);
    const sorted = [...rows].sort((a, b) => {
      const da = s(a.note_date);
      const db = s(b.note_date);
      return db.localeCompare(da);
    });
    setTimeline(sorted);
    setLoadingTimeline(false);
    return sorted;
  }, [admissionId]);

  const loadRight = useCallback(async () => {
    setLoadingRight(true);
    const { data, error } = await rpcGetDpnRightPanel(supabase, admissionId);
    if (error) setSaveErr(error.message);
    setRightPanel(data);
    setLoadingRight(false);
  }, [admissionId]);

  const loadFullNote = useCallback(
    async (noteId: string) => {
      setBundle(null);
      setLoadingNote(true);
      setSaveErr(null);
      const { data, error } = await rpcGetDpnFullNote(supabase, noteId);
      if (error) {
        setSaveErr(error.message);
        setLoadingNote(false);
        return;
      }
      if (!data) {
        setBundle(null);
        setLoadingNote(false);
        return;
      }
      const b = parseFullNoteBundle(data);
      setBundle(b);
      setDraft(draftFromServer(b.note, b.wound, b.io, b.nabh));
      setNoteDate(s(b.note.note_date).slice(0, 10) || ymdToday());
      skipNextDebouncedSave.current = true;
      setLoadingNote(false);
    },
    [],
  );

  useEffect(() => {
    void loadTimeline();
    void loadRight();
  }, [loadTimeline, loadRight]);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const u = auth.user;
      setCurrentUserId(u?.id ?? null);
      if (!u) return;
      const { data: prof } = await supabase.from("practitioners").select("id").eq("user_id", u.id).maybeSingle();
      if (prof?.id) setPractitionerId(String(prof.id));
    })();
  }, []);

  useEffect(() => {
    if (!timeline.length) {
      setActiveNoteId(null);
      setBundle(null);
      return;
    }
    if (activeNoteId && timeline.some((t) => s(t.id) === activeNoteId)) return;
    setActiveNoteId(s(timeline[0].id));
  }, [timeline, activeNoteId]);

  useEffect(() => {
    if (!activeNoteId) return;
    void loadFullNote(activeNoteId);
  }, [activeNoteId, loadFullNote]);

  const noteRow = bundle?.note ?? null;
  const signed = useMemo(() => {
    if (!noteRow) return false;
    const st = s(noteRow.status).toLowerCase();
    if (st === "signed" || st === "locked") return true;
    return noteRow.signed_at != null || noteRow.signed_by != null;
  }, [noteRow]);

  const debouncedFingerprint = useMemo(() => JSON.stringify(debouncedDraft), [debouncedDraft]);

  useEffect(() => {
    if (!activeNoteId || !noteDate || signed) return;
    if (skipNextDebouncedSave.current) {
      skipNextDebouncedSave.current = false;
      return;
    }
    void (async () => {
      const { error } = await rpcUpsertDpnNote(
        supabase,
        buildUpsertPayload(admissionId, hospitalId, patientId, noteDate, activeNoteId, debouncedDraft),
      );
      if (error) setSaveErr(error.message);
      else {
        void loadTimeline();
        void loadRight();
      }
    })();
  }, [
    debouncedFingerprint,
    activeNoteId,
    noteDate,
    signed,
    admissionId,
    hospitalId,
    patientId,
    debouncedDraft,
    loadTimeline,
    loadRight,
  ]);

  const flushSave = useCallback(async () => {
    if (!activeNoteId || !noteDate || signed) return;
    const { error } = await rpcUpsertDpnNote(
      supabase,
      buildUpsertPayload(admissionId, hospitalId, patientId, noteDate, activeNoteId, draft),
    );
    if (error) setSaveErr(error.message);
    else {
      void loadTimeline();
      void loadRight();
    }
  }, [activeNoteId, noteDate, signed, admissionId, hospitalId, patientId, draft, loadTimeline, loadRight]);

  const handleNewDayNote = useCallback(async () => {
    if (!patientId) {
      setSaveErr("Patient ID missing.");
      return;
    }
    const today = ymdToday();
    const existing = timeline.find((t) => s(t.note_date).slice(0, 10) === today);
    if (existing?.id) {
      setActiveNoteId(s(existing.id));
      return;
    }
    setSaveErr(null);
    const { noteId, error } = await rpcUpsertDpnNote(
      supabase,
      buildUpsertPayload(admissionId, hospitalId, patientId, today, undefined, emptyDraft()),
    );
    if (error) {
      setSaveErr(error.message);
      return;
    }
    const id = noteId ?? "";
    if (id) setActiveNoteId(id);
    await loadTimeline();
    await loadRight();
  }, [admissionId, hospitalId, patientId, timeline, loadTimeline, loadRight]);

  const handleSign = useCallback(async () => {
    if (!activeNoteId || !practitionerId) {
      setSaveErr("Cannot sign: missing note or practitioner profile.");
      return;
    }
    setSignBusy(true);
    await flushSave();
    const { ok, error } = await rpcSignDpnNote(supabase, { noteId: activeNoteId, signedBy: practitionerId });
    setSignBusy(false);
    if (error) {
      setSaveErr(error.message);
      return;
    }
    if (ok) void loadFullNote(activeNoteId);
  }, [activeNoteId, practitionerId, flushSave, loadFullNote]);

  const v0 = bundle?.vitals ?? null;
  const tempNum = num(v0?.temperature_c ?? v0?.temperature ?? v0?.temp);
  const tempHigh = tempNum != null && tempNum >= 38;

  const balance =
    (parseFloat(draft.iv_ml) || 0) -
    ((parseFloat(draft.drain_ml) || 0) + (parseFloat(draft.urine_ml) || 0));

  const admissionRp = asRec(rightPanel?.admission);
  const diagnosisRp = s(rightPanel?.diagnosis);
  const admittedFormattedRp = s(rightPanel?.admitted_formatted);
  const surgeonNameRp = s(rightPanel?.surgeon_name);
  const estDischargeFmt = fmtDmy(s(admissionRp?.expected_discharge_date));
  const surgeryDateFmt = fmtDmy(s(admissionRp?.surgery_date));

  const summary = asRec(rightPanel?.admission_summary) ?? asRec(rightPanel?.summary) ?? rightPanel;
  const alerts = arr<Record<string, unknown>>(rightPanel?.alerts);
  const pendingInv = arr<Record<string, unknown>>(rightPanel?.pending_investigations ?? rightPanel?.pending_results);
  const trend = arr<Record<string, unknown>>(rightPanel?.condition_trend ?? rightPanel?.timeline_pills);
  const consultants = arr<Record<string, unknown>>(rightPanel?.consultants ?? rightPanel?.consult_requests);

  const primaryIcd = s(
    admissionRp?.primary_diagnosis_icd10 ?? summary?.primary_diagnosis_icd10 ?? summary?.p_primary_diagnosis_icd10,
  );

  const investigations = bundle?.investigations ?? [];
  const hasCriticalInv = investigations.some((x) => Boolean(x.is_critical) && x.critical_acknowledged_at == null);

  const podDisplay = num(noteRow?.post_op_day) ?? num(bundle?.note?.post_op_day);

  const wardBed = s(noteRow?.ward_bed_label ?? summary?.ward_bed ?? bundle?.author?.ward_bed);
  const doctorName = s(bundle?.author?.display_name ?? bundle?.author?.name ?? noteRow?.authored_by_name);

  const treatments = bundle?.treatments ?? [];

  const bpDisp =
    v0 && num(v0.bp_systolic) != null && num(v0.bp_diastolic) != null
      ? `${num(v0.bp_systolic)}/${num(v0.bp_diastolic)}`
      : "";
  const hrDisp = v0 ? s(v0.heart_rate ?? v0.hr) : "";
  const spo2Disp = v0 && s(v0.spo2) !== "" ? `${s(v0.spo2)}%` : "";
  const tempDisp = tempNum != null ? `${tempNum}°C` : "";
  const rrDisp = v0 ? s(v0.respiratory_rate ?? v0.rr) : "";
  const painDisp = v0 && (v0.pain_score != null || v0.pain_vas != null) ? `${s(v0.pain_score ?? v0.pain_vas)}/10` : "";

  const hospitalDayTitle = Math.max(1, num(noteRow?.hospital_day ?? noteRow?.hospital_day_number) ?? 0);

  const handleAckCritical = async (orderId: string) => {
    const { error } = await acknowledgeCriticalInvestigation(supabase, orderId, currentUserId);
    if (error) setSaveErr(error.message);
    else if (activeNoteId) void loadFullNote(activeNoteId);
  };

  const handleOrderInv = async () => {
    if (!activeNoteId || !orderForm.name.trim()) return;
    const { error } = await rpcOrderDpnInvestigation(supabase, {
      admissionId,
      hospitalId,
      patientId,
      noteId: activeNoteId,
      testName: orderForm.name.trim(),
      testCategory: orderForm.category,
      priority: orderForm.priority,
    });
    if (error) setSaveErr(error.message);
    else {
      setOrderOpen(false);
      setOrderForm({ name: "", category: "Lab", priority: "Routine" });
      if (activeNoteId) void loadFullNote(activeNoteId);
      void loadRight();
    }
  };

  const handleAddMed = async () => {
    if (!activeNoteId || !medForm.name.trim()) return;
    const nd = noteDate || ymdToday();
    const duration = medForm.days.trim() ? parseInt(medForm.days, 10) : null;
    const { error } = await insertIpdTreatmentRow(supabase, {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      progress_note_id: activeNoteId,
      treatment_kind: "medical",
      name: medForm.name.trim(),
      dose: medForm.dose.trim() || null,
      route: medForm.route,
      frequency: medForm.freq,
      duration_days: duration != null && Number.isFinite(duration) ? duration : null,
      status: "active",
      ordered_date: nd,
      start_date: nd,
    });
    if (error) setSaveErr(error.message);
    else {
      setAddMedOpen(false);
      setMedForm({ name: "", dose: "", route: "IV", freq: "OD", days: "" });
      if (activeNoteId) void loadFullNote(activeNoteId);
    }
  };

  const persistWoundAssessment = useCallback(
    async (wDraft: Draft) => {
      if (!activeNoteId || signed || !currentUserId) return;
      const woundRow = bundle?.wound;
      const wid = woundRow ? s((woundRow as Record<string, unknown>).id) : "";
      const row: Record<string, unknown> = {
        hospital_id: hospitalId,
        admission_id: admissionId,
        progress_note_id: activeNoteId,
        patient_id: patientId,
        assessed_by: currentUserId,
        discharge_type: wDraft.discharge_type,
        sutures: wDraft.sutures,
        swelling: wDraft.swelling,
        erythema: wDraft.erythema,
      };
      if (wid) row.id = wid;
      const { error } = await supabase.from("ipd_wound_assessments").upsert(row, { onConflict: "id" });
      if (error) setSaveErr(error.message);
      else if (activeNoteId) void loadFullNote(activeNoteId);
    },
    [activeNoteId, admissionId, bundle?.wound, currentUserId, hospitalId, patientId, signed, loadFullNote],
  );

  const persistIoRecord = useCallback(
    async (wDraft: Draft) => {
      if (!activeNoteId || signed || !noteDate) return;
      const { error } = await supabase.from("ipd_io_records").upsert(
        {
          hospital_id: hospitalId,
          admission_id: admissionId,
          progress_note_id: activeNoteId,
          patient_id: patientId,
          record_date: noteDate,
          iv_fluid_ml: parseFloat(wDraft.iv_ml) || 0,
          drain_output_ml: parseFloat(wDraft.drain_ml) || 0,
          urine_output_ml: parseFloat(wDraft.urine_ml) || 0,
        },
        { onConflict: "admission_id,record_date" },
      );
      if (error) setSaveErr(error.message);
    },
    [activeNoteId, admissionId, hospitalId, noteDate, patientId, signed],
  );

  const persistNabhChecklist = useCallback(
    async (wDraft: Draft) => {
      if (!activeNoteId || signed || !noteDate || !currentUserId) return;
      const nabhRow = bundle?.nabh;
      const nid = nabhRow ? s((nabhRow as Record<string, unknown>).id) : "";
      const row: Record<string, unknown> = {
        hospital_id: hospitalId,
        admission_id: admissionId,
        progress_note_id: activeNoteId,
        patient_id: patientId,
        checklist_date: noteDate,
        completed_by: currentUserId,
        vte_prophylaxis_given: wDraft.vte_ok,
        fall_risk_assessed: wDraft.fall_assessed,
        pressure_sore_checked: wDraft.pressure_ok,
        consent_valid: wDraft.consent_ok,
        diet_order: wDraft.diet_order,
        activity_order: wDraft.activity,
        iv_access_site: wDraft.iv_access_site || null,
        discharge_notes: wDraft.discharge_notes || null,
      };
      if (nid) row.id = nid;
      const { error } = await supabase.from("ipd_nabh_checklist").upsert(row, { onConflict: "progress_note_id" });
      if (error) setSaveErr(error.message);
    },
    [activeNoteId, admissionId, bundle?.nabh, currentUserId, hospitalId, noteDate, patientId, signed],
  );

  if (!patientId) {
    return (
      <ErrorBanner message="Admission record is missing patient linkage. Contact support." />
    );
  }

  return (
    <div className="grid h-[min(100vh-12rem,900px)] min-h-[560px] w-full grid-cols-1 gap-3 lg:grid-cols-[200px_minmax(0,1fr)_220px] lg:gap-4">
      {/* LEFT */}
      <aside className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
        <div className="border-b border-slate-200 px-2 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Day timeline
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {loadingTimeline ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : timeline.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
              No progress notes yet.
              <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => void handleNewDayNote()}>
                Start Day 1 note
              </Button>
            </div>
          ) : (
            timeline.map((row) => {
              const id = s(row.id);
              const active = id === activeNoteId;
              const rawDay = num(row.hospital_day ?? row.hospital_day_number ?? row.day_number) ?? 0;
              const dayPart = `Day ${Math.max(1, rawDay)}`;
              const pod = num(row.post_op_day);
              const label = pod != null ? `${dayPart} · POD ${pod}` : dayPart;
              const invC = num(row.investigation_count ?? row.inv_count) ?? 0;
              const txC = num(row.treatment_count ?? row.tx_count) ?? 0;
              const crit = Boolean(row.has_critical_inv);
              const cond = s(row.condition_status ?? row.condition_today);
              return (
                <button
                  key={id || `day-${String(row.note_date)}`}
                  type="button"
                  onClick={() => setActiveNoteId(id)}
                  className={cn(
                    "w-full rounded-lg border bg-white p-2 text-left text-xs shadow-sm transition dark:bg-slate-900",
                    active
                      ? "border-blue-600 border-l-4 border-l-blue-600 dark:border-blue-400 dark:border-l-blue-400"
                      : "border-slate-200 dark:border-slate-700",
                  )}
                >
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{label}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{fmtDayShort(s(row.note_date))}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-300">{s(row.authored_by_name) || "—"}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-slate-800">Tx {txC}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-slate-800">Inv {invC}</span>
                    {crit ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-900/50 dark:text-red-200">
                        Critical
                      </span>
                    ) : null}
                  </div>
                  {cond ? <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px]", conditionPillClass(cond))}>{cond}</span> : null}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-slate-200 p-2 dark:border-slate-700">
          <Button type="button" size="sm" className="w-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500" onClick={() => void handleNewDayNote()}>
            New day note
          </Button>
        </div>
      </aside>

      {/* CENTER */}
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {loadingNote && !bundle && activeNoteId ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !activeNoteId ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Select a day from the timeline or create a new note
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Day {hospitalDayTitle} Progress Note
                    {podDisplay != null ? <span className="text-slate-500"> · POD {podDisplay}</span> : null}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {noteDate ? fmtDayShort(noteDate) : "—"} · {doctorName || "—"} · {wardBed || "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {signed ? null : (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => void flushSave()}>
                        Save draft
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500"
                        disabled={signBusy || !practitionerId}
                        onClick={() => void handleSign()}
                      >
                        Sign &amp; lock note
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {signed ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <Lock className="h-4 w-4 shrink-0" />
                  Signed — note is locked.
                </div>
              ) : null}
              {saveErr ? <p className="text-xs text-red-600 dark:text-red-400">{saveErr}</p> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {/* S */}
              <section className="mb-8">
                <SectionBadge letter="S" label="Subjective" className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200" />
                <div className="mt-3 flex flex-wrap gap-2">
                  {APPETITE.map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={signed}
                      onClick={() => setDraft((d) => ({ ...d, appetite: d.appetite === a ? "" : a }))}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        draft.appetite === a
                          ? "border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200"
                          : "border-slate-200 dark:border-slate-600",
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-4">
                  {(
                    [
                      ["sleep_ok", "Sleep", draft.sleep_ok],
                      ["bowel_ok", "Bowel", draft.bowel_ok],
                      ["bladder_ok", "Bladder", draft.bladder_ok],
                    ] as const
                  ).map(([key, lab, val]) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-600 dark:text-slate-300">{lab}</span>
                      <button
                        type="button"
                        disabled={signed}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            [key]: val === true ? false : val === false ? null : true,
                          }))
                        }
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold",
                          val === true
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : val === false
                              ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                              : "border-slate-200 text-slate-400 dark:border-slate-600",
                        )}
                      >
                        {val === true ? <Check className="h-4 w-4" /> : val === false ? <X className="h-4 w-4" /> : "—"}
                      </button>
                    </div>
                  ))}
                </div>
                <Textarea
                  value={draft.subjective_text}
                  readOnly={signed}
                  onChange={(e) => setDraft((d) => ({ ...d, subjective_text: e.target.value }))}
                  onBlur={() => void flushSave()}
                  placeholder="Patient complaints today..."
                  className="mt-3 min-h-[88px] border-slate-200 dark:border-slate-600 dark:bg-slate-800"
                />
              </section>

              {/* O */}
              <section className="mb-8">
                <SectionBadge letter="O" label="Objective" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" />
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Synced from nursing
                  </span>
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      { k: "bp", lab: "BP", val: bpDisp, hot: false },
                      { k: "hr", lab: "HR", val: hrDisp, hot: false },
                      { k: "spo2", lab: "SpO₂", val: spo2Disp, hot: false },
                      { k: "temp", lab: "Temp", val: tempDisp, hot: tempHigh },
                      { k: "rr", lab: "RR", val: rrDisp, hot: false },
                      { k: "pain", lab: "Pain", val: painDisp, hot: false },
                    ] as const
                  ).map(({ k, lab, val, hot }) => (
                    <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-600 dark:bg-slate-800/80">
                      <p className="text-[10px] font-bold uppercase text-slate-500">{lab}</p>
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          hot ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white",
                        )}
                      >
                        {val || "—"}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-600">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Wound site assessment</p>
                    <div className="mt-2 space-y-2">
                      <Label className="text-[10px] uppercase text-slate-500">Discharge</Label>
                      <div className="flex flex-wrap gap-1">
                        {DISCHARGE_TYPES.map((x) => (
                          <button
                            key={x}
                            type="button"
                            disabled={signed}
                            onClick={() => {
                              const next = { ...draftRef.current, discharge_type: x };
                              setDraft(next);
                              void persistWoundAssessment(next);
                            }}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px]",
                              draft.discharge_type === x ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : "bg-slate-100 dark:bg-slate-800",
                            )}
                          >
                            {x}
                          </button>
                        ))}
                      </div>
                      <Label className="text-[10px] uppercase text-slate-500">Sutures</Label>
                      <div className="flex flex-wrap gap-1">
                        {SUTURES.map((x) => (
                          <button
                            key={x}
                            type="button"
                            disabled={signed}
                            onClick={() => {
                              const next = { ...draftRef.current, sutures: x };
                              setDraft(next);
                              void persistWoundAssessment(next);
                            }}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px]",
                              draft.sutures === x ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : "bg-slate-100 dark:bg-slate-800",
                            )}
                          >
                            {x}
                          </button>
                        ))}
                      </div>
                      <Label className="text-[10px] uppercase text-slate-500">Swelling / Erythema</Label>
                      <div className="flex flex-wrap gap-1">
                        {SWELLING.map((x) => (
                          <button
                            key={x}
                            type="button"
                            disabled={signed}
                            onClick={() => {
                              const next = { ...draftRef.current, swelling: x };
                              setDraft(next);
                              void persistWoundAssessment(next);
                            }}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px]",
                              draft.swelling === x ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-slate-100 dark:bg-slate-800",
                            )}
                          >
                            {x}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ERYTHEMA.map((x) => (
                          <button
                            key={x}
                            type="button"
                            disabled={signed}
                            onClick={() => {
                              const next = { ...draftRef.current, erythema: x };
                              setDraft(next);
                              void persistWoundAssessment(next);
                            }}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px]",
                              draft.erythema === x ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-slate-100 dark:bg-slate-800",
                            )}
                          >
                            E {x}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-600">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Fluid balance I/O</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div>
                        <Label className="text-[10px]">IV fluids in (ml)</Label>
                        <Input
                          type="number"
                          disabled={signed}
                          value={draft.iv_ml}
                          onChange={(e) => setDraft((d) => ({ ...d, iv_ml: e.target.value }))}
                          onBlur={() => void persistIoRecord(draftRef.current)}
                          className="h-9 dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Drain output (ml)</Label>
                        <Input
                          type="number"
                          disabled={signed}
                          value={draft.drain_ml}
                          onChange={(e) => setDraft((d) => ({ ...d, drain_ml: e.target.value }))}
                          onBlur={() => void persistIoRecord(draftRef.current)}
                          className="h-9 dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Urine output (ml)</Label>
                        <Input
                          type="number"
                          disabled={signed}
                          value={draft.urine_ml}
                          onChange={(e) => setDraft((d) => ({ ...d, urine_ml: e.target.value }))}
                          onBlur={() => void persistIoRecord(draftRef.current)}
                          className="h-9 dark:bg-slate-800"
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                      Balance (IV − drain − urine):{" "}
                      <span
                        className={cn(
                          "font-semibold",
                          balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {Number.isFinite(balance) ? balance : "—"} ml
                      </span>
                    </p>
                  </div>
                </div>

                <Textarea
                  value={draft.objective_text}
                  readOnly={signed}
                  onChange={(e) => setDraft((d) => ({ ...d, objective_text: e.target.value }))}
                  onBlur={() => void flushSave()}
                  placeholder="Examination findings…"
                  className="mt-4 min-h-[80px] border-slate-200 dark:border-slate-600 dark:bg-slate-800"
                />
              </section>

              {/* A */}
              <section className="mb-8">
                <SectionBadge letter="A" label="Assessment" className="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" />
                <div className="mt-3 flex flex-wrap gap-2">
                  {CONDITIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={signed}
                      onClick={() => {
                        const next = { ...draftRef.current, condition_status: c };
                        setDraft(next);
                        void (async () => {
                          const { error } = await rpcUpsertDpnNote(
                            supabase,
                            buildUpsertPayload(admissionId, hospitalId, patientId, noteDate, activeNoteId, next),
                          );
                          if (error) setSaveErr(error.message);
                          else {
                            void loadTimeline();
                            void loadRight();
                          }
                        })();
                      }}
                      className={conditionButtonClass(c, draft.condition_status === c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={draft.assessment_text}
                  readOnly={signed}
                  onChange={(e) => setDraft((d) => ({ ...d, assessment_text: e.target.value }))}
                  onBlur={() => void flushSave()}
                  placeholder="Assessment…"
                  className="mt-3 min-h-[72px] border-slate-200 dark:border-slate-600 dark:bg-slate-800"
                />
                {primaryIcd ? (
                  <p className="mt-2 text-xs text-slate-500">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                      ICD-10 {primaryIcd}
                    </span>
                  </p>
                ) : null}
              </section>

              {/* I */}
              <section className="mb-8">
                <div className="flex items-center gap-2">
                  <SectionBadge letter="I" label="Investigations" className="bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" />
                  {hasCriticalInv ? (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setOrderOpen((o) => !o)}>
                    + Order investigation
                  </Button>
                </div>
                {orderOpen ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-600">
                    <Input
                      placeholder="Test name"
                      value={orderForm.name}
                      onChange={(e) => setOrderForm((f) => ({ ...f, name: e.target.value }))}
                      className="h-9 max-w-xs dark:bg-slate-800"
                    />
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                      value={orderForm.category}
                      onChange={(e) => setOrderForm((f) => ({ ...f, category: e.target.value }))}
                    >
                      {INV_CATS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                      value={orderForm.priority}
                      onChange={(e) => setOrderForm((f) => ({ ...f, priority: e.target.value }))}
                    >
                      {PRIOS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <Button type="button" size="sm" onClick={() => void handleOrderInv()}>
                      Submit order
                    </Button>
                  </div>
                ) : null}
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Investigation</TableHead>
                      <TableHead>Ordered</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {investigations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-slate-500">
                          No orders for this day.
                        </TableCell>
                      </TableRow>
                    ) : (
                      investigations.map((inv) => {
                        const st = s(inv.status ?? inv.order_status);
                        const pill = invStatusPill(st);
                        const unackedCrit = Boolean(inv.is_critical) && inv.critical_acknowledged_at == null;
                        const oid = s(inv.id);
                        return (
                          <TableRow key={oid} className={unackedCrit ? "bg-red-50 dark:bg-red-950/30" : undefined}>
                            <TableCell className="font-medium">{s(inv.test_name ?? inv.name)}</TableCell>
                            <TableCell className="text-xs">
                              {fmtDayShort(s(inv.ordered_at ?? inv.created_at))}{" "}
                              {s(inv.ordered_at ?? inv.created_at).slice(11, 16)}
                            </TableCell>
                            <TableCell className="text-xs">{s(inv.result_summary ?? inv.result)}</TableCell>
                            <TableCell>
                              <span className={cn("rounded-full px-2 py-0.5 text-[11px]", pill.cls)}>{pill.label}</span>
                            </TableCell>
                            <TableCell>
                              {unackedCrit ? (
                                <Button type="button" size="sm" variant="outline" onClick={() => void handleAckCritical(oid)}>
                                  Acknowledge
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </section>

              {/* P */}
              <section className="mb-8">
                <SectionBadge letter="P" label="Plan / Treatments" className="bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setAddMedOpen((o) => !o)}>
                    + Add medication
                  </Button>
                </div>
                {addMedOpen ? (
                  <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-3 lg:grid-cols-6 dark:border-slate-600">
                    <Input
                      placeholder="Name"
                      value={medForm.name}
                      onChange={(e) => setMedForm((f) => ({ ...f, name: e.target.value }))}
                      className="h-9 dark:bg-slate-800"
                    />
                    <Input
                      placeholder="Dose"
                      value={medForm.dose}
                      onChange={(e) => setMedForm((f) => ({ ...f, dose: e.target.value }))}
                      className="h-9 dark:bg-slate-800"
                    />
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                      value={medForm.route}
                      onChange={(e) => setMedForm((f) => ({ ...f, route: e.target.value }))}
                    >
                      {MED_ROUTES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                      value={medForm.freq}
                      onChange={(e) => setMedForm((f) => ({ ...f, freq: e.target.value }))}
                    >
                      {MED_FREQ.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <Input
                      placeholder="Duration (days)"
                      type="number"
                      value={medForm.days}
                      onChange={(e) => setMedForm((f) => ({ ...f, days: e.target.value }))}
                      className="h-9 dark:bg-slate-800"
                    />
                    <Button type="button" className="lg:col-span-6" size="sm" onClick={() => void handleAddMed()}>
                      Save medication
                    </Button>
                  </div>
                ) : null}
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kind</TableHead>
                      <TableHead>Name / dose</TableHead>
                      <TableHead>Route / freq</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>NAR</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {treatments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-slate-500">
                          No treatments.
                        </TableCell>
                      </TableRow>
                    ) : (
                      treatments.map((tx) => {
                        const kind = s(tx.kind ?? tx.treatment_kind).toLowerCase();
                        const kindCls =
                          kind.includes("surg")
                            ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
                            : kind.includes("physio")
                              ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200"
                              : kind.includes("diet")
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                : kind.includes("vte")
                                  ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                                  : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
                        const narToday = arr<Record<string, unknown>>(tx.nar_today).slice(0, 4);
                        const st = s(tx.status).toLowerCase();
                        const statusCls =
                          st.includes("stop")
                            ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            : st.includes("plan")
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
                        const dosePart = s(tx.dose ?? tx.dose_details);
                        const routePart = [s(tx.route), s(tx.frequency ?? tx.route_frequency)].filter(Boolean).join(" / ");
                        return (
                          <TableRow key={s(tx.id)}>
                            <TableCell>
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", kindCls)}>
                                {s(tx.treatment_kind ?? tx.kind) || "medical"}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">
                              {s(tx.name)}
                              {dosePart ? ` / ${dosePart}` : ""}
                            </TableCell>
                            <TableCell className="text-xs">{routePart || "—"}</TableCell>
                            <TableCell className="text-xs">{s(tx.duration_days ?? tx.days) || "—"}</TableCell>
                            <TableCell>
                              <div className="flex gap-0.5">
                                {narToday.length === 0 ? (
                                  <span className="text-[10px] text-slate-400">—</span>
                                ) : (
                                  narToday.map((n, i) => {
                                    const given = n.administered_at != null;
                                    return (
                                      <span
                                        key={i}
                                        className={cn(
                                          "h-2.5 w-2.5 rounded-full border",
                                          given
                                            ? "border-emerald-500 bg-emerald-500"
                                            : "border-slate-400 bg-white dark:border-slate-400 dark:bg-slate-900",
                                        )}
                                        title={given ? "Given" : "Due"}
                                      />
                                    );
                                  })
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", statusCls)}>
                                {s(tx.status) || "—"}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                <Textarea
                  value={draft.plan_narrative}
                  readOnly={signed}
                  onChange={(e) => setDraft((d) => ({ ...d, plan_narrative: e.target.value }))}
                  onBlur={() => void flushSave()}
                  placeholder="Discharge planning / plan narrative..."
                  className="mt-4 min-h-[80px] border-slate-200 dark:border-slate-600 dark:bg-slate-800"
                />
              </section>

              {/* N */}
              <section className="mb-8">
                <SectionBadge letter="N" label="Nursing & NABH" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" />
                <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-600">
                    <p className="text-xs font-bold">Mandatory NABH checks</p>
                    <div className="mt-2 space-y-2 text-sm">
                      <BoolRow
                        label="VTE prophylaxis given"
                        value={draft.vte_ok}
                        disabled={signed}
                        onChange={(v) => {
                          const next = { ...draftRef.current, vte_ok: v };
                          setDraft(next);
                          void persistNabhChecklist(next);
                        }}
                      />
                      <BoolRow
                        label="Fall risk assessed"
                        value={draft.fall_assessed}
                        disabled={signed}
                        onChange={(v) => {
                          const next = { ...draftRef.current, fall_assessed: v };
                          setDraft(next);
                          void persistNabhChecklist(next);
                        }}
                      />
                      <BoolRow
                        label="Pressure sore checked"
                        value={draft.pressure_ok}
                        disabled={signed}
                        onChange={(v) => {
                          const next = { ...draftRef.current, pressure_ok: v };
                          setDraft(next);
                          void persistNabhChecklist(next);
                        }}
                      />
                      <BoolRow
                        label="Consent valid"
                        value={draft.consent_ok}
                        disabled={signed}
                        onChange={(v) => {
                          const next = { ...draftRef.current, consent_ok: v };
                          setDraft(next);
                          void persistNabhChecklist(next);
                        }}
                      />
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-600">
                    <p className="text-xs font-bold">Orders</p>
                    <div className="mt-2 space-y-2">
                      <Label className="text-[10px]">Diet order</Label>
                      <select
                        disabled={signed}
                        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                        value={draft.diet_order}
                        onChange={(e) => {
                          const next = { ...draftRef.current, diet_order: e.target.value };
                          setDraft(next);
                          void persistNabhChecklist(next);
                        }}
                      >
                        {DIETS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <Label className="text-[10px]">Activity</Label>
                      <select
                        disabled={signed}
                        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                        value={draft.activity}
                        onChange={(e) => {
                          const next = { ...draftRef.current, activity: e.target.value };
                          setDraft(next);
                          void persistNabhChecklist(next);
                        }}
                      >
                        {ACTIVITY.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <Label className="text-[10px]">IV access site</Label>
                      <Input
                        disabled={signed}
                        value={draft.iv_access_site}
                        onChange={(e) => setDraft((d) => ({ ...d, iv_access_site: e.target.value }))}
                        onBlur={() => void persistNabhChecklist(draftRef.current)}
                        className="h-9 dark:bg-slate-800"
                      />
                      <Label className="text-[10px]">Discharge planning notes</Label>
                      <Textarea
                        disabled={signed}
                        value={draft.discharge_notes}
                        onChange={(e) => setDraft((d) => ({ ...d, discharge_notes: e.target.value }))}
                        onBlur={() => void persistNabhChecklist(draftRef.current)}
                        className="min-h-[64px] dark:bg-slate-800"
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      {/* RIGHT */}
      <aside className="flex min-h-0 flex-col overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
        <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Context
        </div>
        <div className="min-h-0 flex-1 space-y-4 p-3 text-xs">
          {loadingRight ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-600 dark:bg-slate-900">
                <p className="font-bold text-slate-800 dark:text-slate-100">Admission summary</p>
                <dl className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">
                  <div>
                    <dt className="text-[10px] uppercase text-slate-400">Diagnosis</dt>
                    <dd>{diagnosisRp || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-slate-400">Admitted</dt>
                    <dd>{admittedFormattedRp || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-slate-400">Surgery date</dt>
                    <dd>{s(admissionRp?.surgery_date) ? surgeryDateFmt : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-slate-400">Surgeon</dt>
                    <dd>{surgeonNameRp || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-slate-400">Est. discharge</dt>
                    <dd>{s(admissionRp?.expected_discharge_date) ? estDischargeFmt : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-slate-400">Insurance / TPA</dt>
                    <dd>—</dd>
                  </div>
                </dl>
              </div>

              <div>
                <p className="mb-1 font-bold text-slate-800 dark:text-slate-100">Alerts</p>
                <div className="space-y-2">
                  {alerts.length === 0 && !hasCriticalInv ? (
                    <p className="text-slate-500">No alerts.</p>
                  ) : (
                    <>
                      {alerts.map((a, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-900 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-200"
                        >
                          <AlertTriangle className="mb-1 inline h-3.5 w-3.5" />
                          {s(a.message ?? a.title ?? a.text)}
                        </div>
                      ))}
                      {hasCriticalInv ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-900 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-200">
                          Critical investigation on this note — acknowledge in Investigations.
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-1 font-bold text-slate-800 dark:text-slate-100">Pending results</p>
                <ul className="list-inside list-disc space-y-1 text-slate-600 dark:text-slate-300">
                  {pendingInv.length === 0 ? <li>None</li> : pendingInv.map((p, i) => <li key={i}>{s(p.test_name ?? p.name)}</li>)}
                </ul>
              </div>

              <div>
                <p className="mb-1 font-bold text-slate-800 dark:text-slate-100">Condition trend</p>
                <div className="flex flex-wrap gap-1">
                  {(trend.length >= 4 ? trend.slice(-7) : trend).map((t, i) => (
                    <span
                      key={i}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px]",
                        conditionPillClass(s(t.status ?? t.condition_status)),
                      )}
                    >
                      D{s(t.day_number ?? t.hospital_day_number) || i + 1}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 font-bold text-slate-800 dark:text-slate-100">Consultants</p>
                <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                  {consultants.length === 0 ? <li>—</li> : consultants.map((c, i) => <li key={i}>{s(c.name ?? c.consultant_name ?? c.specialty)}</li>)}
                </ul>
              </div>

              {s(noteRow?.status).toLowerCase() === "draft" || (!signed && s(noteRow?.status) === "") ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                  Note unsigned · locks in 8h
                </div>
              ) : null}
              {!signed && activeNoteId ? (
                <Button
                  type="button"
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500"
                  disabled={signBusy || !practitionerId}
                  onClick={() => void handleSign()}
                >
                  e-Sign &amp; lock Day {hospitalDayTitle} note
                </Button>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function BoolRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean | null;
  disabled: boolean;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === true ? false : value === false ? null : true)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold",
          value === true
            ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50"
            : value === false
              ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40"
              : "border-slate-200 text-slate-400 dark:border-slate-600",
        )}
      >
        {value === true ? <Check className="h-4 w-4" /> : value === false ? <X className="h-4 w-4" /> : "—"}
      </button>
    </div>
  );
}
