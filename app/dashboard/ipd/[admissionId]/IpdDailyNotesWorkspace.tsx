"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Minus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../../../lib/supabase";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { cn } from "../../../../lib/utils";
import { formatClinicalDate, patientFromAdmission, preAdmissionFrom } from "../../../lib/ipdAdmissionDisplay";
import { IPD_DEFAULT_HOSPITAL_ID } from "../../../lib/ipdConstants";
import { formatRequestedAgo, rpcGetAdmissionConsults } from "../../../lib/ipdConsults";
import { readIndiaRefsetKeyFromEnv } from "@/app/lib/snomedUiConfig";
import type { ClinicalChip } from "../../../lib/clinicalChipTypes";
import {
  buildAssessmentDisplayText,
  buildAssessmentSnomedPayload,
  buildComplaintSnomedPayload,
  buildFindingsSnomedPayload,
  buildObjectiveDisplayText,
  buildSubjectiveDisplayText,
  ipdSnomedTermToClinicalChip,
  ipdSnomedTermToDiagnosisEntry,
  parseIpdSnomedTermsJson,
  parseLegacyLocalExamAssessmentTerms,
  parseLegacyLocalExamFindingTerms,
  readLegacyAssessmentObjectiveFreeFromLocalExam,
  readLegacyFreeTextFromJson,
  recoverFreeTextBelowChipLine,
  type IpdDiagnosisEntry,
} from "../../../lib/ipdProgressNoteSnomed";
import {
  IpdAssessmentSnomedBlock,
  IpdExaminationSnomedBlock,
  IpdSubjectiveSnomedBlock,
} from "../../../components/ipd/IpdProgressNoteSnomedFields";
import VoiceDictationButton from "../../../components/VoiceDictationButton";
import { DiagnosisWithIcd } from "../../../components/clinical/DiagnosisWithIcd";
import { Button } from "../../../../components/ui/button";
import { Skeleton } from "../../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { Textarea } from "../../../../components/ui/textarea";
import OrderInvestigationModal, {
  type OrderInvestigationCatalogRow,
} from "../../../components/ipd/order-investigation-modal";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** True when Postgres raises unique violation (e.g. concurrent upsert races). */
function isPostgresDuplicateKey(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "23505") return true;
  const m = String(e.message ?? "");
  return /duplicate key/i.test(m) || /unique constraint/i.test(m);
}

function fmtDayShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Match app shell: white page background. */
const PAGE_BG = "bg-white";
/** Three-column shell: timeline & context slightly off-white; center note editor white. */
const PANEL_LEFT = "border border-slate-200 bg-gray-50 shadow-sm";
const PANEL_MAIN = "border border-slate-200 bg-white shadow-sm";
const PANEL_RIGHT = "border border-slate-200 bg-gray-50 shadow-sm";
/** Nested SOAP blocks — slight contrast on light */
const NESTED_SECTION_BG = "border border-slate-200 bg-slate-50 shadow-sm";

const SNOMED_INDIA_IPD = readIndiaRefsetKeyFromEnv();

const SURGICAL_SPECIALTIES = [
  "Orthopedic Surgery",
  "General Surgery",
  "Obstetrics & Gynaecology",
  "Urology",
  "Neurosurgery",
  "Cardiothoracic Surgery",
  "Plastic Surgery",
  "ENT",
  "Ophthalmology",
  "Surgical Oncology",
] as const;

/** Row from `test_catalogue` search (Order investigation picker). */
type InvCataloguePick = OrderInvestigationCatalogRow & {
  snomed_code: string | null;
  snomed_display: string | null;
  hospital_id?: string | null;
};

type DrugMasterRow = {
  id: string;
  generic_name: string | null;
  brand_name: string | null;
  dosage_form: string | null;
  strength: string | null;
  /** Maximum retail price — from `drugs.mrp` (not `purchase_price`). */
  mrp: number | string | null;
};

function parseDrugMrpPositive(mrp: number | string | null): number | null {
  if (mrp == null || mrp === "") return null;
  const n = typeof mrp === "number" ? mrp : Number(String(mrp).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function sanitizeIlike(q: string): string {
  return q.trim().replace(/[%_]/g, "").slice(0, 120);
}

/** Alias normalisation for investigation catalogue search. */
function normalizeInvestigationSearchTerm(term: string): string {
  return term
    .replace(/\bxray\b/gi, "x-ray")
    .replace(/\bxr\b/gi, "x-ray")
    .replace(/\bcxr\b/gi, "chest");
}

const APPETITE = ["Good", "Fair", "Poor"] as const;
const CONDITIONS = ["Improving", "Stable", "Plateauing", "Deteriorating", "Critical"] as const;

type WoundJson = {
  discharge: string;
  sutures: string;
  swelling: string;
  erythema: string;
};

const DEFAULT_WOUND: WoundJson = {
  discharge: "None",
  sutures: "Intact",
  swelling: "None",
  erythema: "None",
};

const DISCHARGE_OPTS = ["None", "Serous", "Purulent"] as const;
const SUTURE_OPTS = ["Intact", "Partial", "Removed"] as const;
const SWELL_OPTS = ["None", "Mild", "Moderate", "Severe"] as const;
const ERYTHEMA_OPTS = ["None", "Present"] as const;

const DIET_TAGS = ["NPO", "Liquid", "Soft", "Normal"] as const;
const ACTIVITY_TAGS = ["Bedrest", "Sitting", "Amb.+walker", "Full"] as const;

function parseWoundJson(raw: string): WoundJson {
  if (!raw.trim()) return { ...DEFAULT_WOUND };
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    return {
      discharge: s(j.discharge) || DEFAULT_WOUND.discharge,
      sutures: s(j.sutures) || DEFAULT_WOUND.sutures,
      swelling: s(j.swelling) || DEFAULT_WOUND.swelling,
      erythema: s(j.erythema) || DEFAULT_WOUND.erythema,
    };
  } catch {
    return { ...DEFAULT_WOUND };
  }
}

function conditionChipClass(c: string, selected: boolean): string {
  if (!selected) {
    return "border border-slate-200 bg-white text-slate-600 hover:border-slate-300";
  }
  const t = c.toLowerCase();
  if (t === "improving") return "border border-emerald-500 bg-emerald-600 text-white shadow-sm";
  if (t === "stable") return "border border-sky-500 bg-sky-600 text-white shadow-sm";
  if (t === "plateauing") return "border border-amber-500 bg-amber-600 text-white shadow-sm";
  if (t === "deteriorating") return "border border-orange-500 bg-orange-600 text-white shadow-sm";
  if (t === "critical") return "border border-red-500 bg-red-600 text-white shadow-sm";
  return "border border-slate-500 bg-slate-600 text-white";
}

function timelineConditionBarClass(st: string): string {
  const t = st.toLowerCase();
  if (t.includes("improv")) return "bg-emerald-500";
  if (t.includes("stable") || t.includes("plateau")) return "bg-sky-500";
  if (t.includes("deteriorat")) return "bg-amber-500";
  if (t.includes("critical")) return "bg-red-500";
  return "bg-slate-600";
}

function trendChipClass(st: string): string {
  const t = st.toLowerCase();
  if (t.includes("improv"))
    return "border border-emerald-500/40 bg-emerald-50 text-emerald-900";
  if (t.includes("stable"))
    return "border border-sky-500/40 bg-sky-50 text-sky-900";
  if (t.includes("plateau"))
    return "border border-amber-500/40 bg-amber-50 text-amber-900";
  if (t.includes("deteriorat"))
    return "border border-orange-500/40 bg-orange-50 text-orange-900";
  if (t.includes("critical"))
    return "border border-red-500/40 bg-red-50 text-red-900";
  return "border border-slate-300 bg-slate-100 text-slate-700";
}

function shortConditionLabel(st: string): string {
  const t = st.toLowerCase();
  if (t.includes("improv")) return "↑Impr";
  if (t.includes("stable")) return "Stable";
  if (t.includes("plateau")) return "Plat";
  if (t.includes("deteriorat")) return "Det";
  if (t.includes("critical")) return "Crit";
  return st ? st.slice(0, 4) : "—";
}

function dayNumForNote(notes: Record<string, unknown>[], noteId: string): number {
  const r = notes.find((x) => s((x as Record<string, unknown>).id) === noteId);
  return r ? Math.max(1, num((r as Record<string, unknown>).hospital_day_number) ?? 0) : 0;
}

function invStatusBadge(st: string): { label: string; cls: string } {
  const t = st.toLowerCase();
  if (t.includes("report") || t.includes("result_enter"))
    return { label: "Reported", cls: "border border-blue-200 bg-blue-50 text-blue-900" };
  if (t.includes("sample_collected"))
    return { label: "Sample collected", cls: "border border-violet-200 bg-violet-50 text-violet-900" };
  if (t.includes("pend"))
    return { label: "Pending", cls: "border border-amber-200 bg-amber-50 text-amber-900" };
  if (t.includes("crit"))
    return { label: "Critical", cls: "border border-red-200 bg-red-50 text-red-900" };
  if (t === "ordered") return { label: "Ordered", cls: "border border-blue-200 bg-blue-50 text-blue-900" };
  return { label: "Ordered", cls: "border border-slate-200 bg-slate-100 text-slate-800" };
}

function invBillingBadge(bill: string | null | undefined): { label: string; cls: string } | null {
  const t = s(bill).toLowerCase();
  if (t === "pending_payment") return { label: "Awaiting Payment", cls: "border border-amber-300 bg-amber-50 text-amber-950" };
  if (t === "insurance_covered" || t === "paid" || t === "emergency_override")
    return { label: "Ordered", cls: "border border-blue-200 bg-blue-50 text-blue-900" };
  return null;
}

function treatmentKindBadge(kind: string): { label: string; cls: string } {
  const t = kind.toLowerCase();
  if (t.includes("physio"))
    return { label: "Physio", cls: "border border-violet-200 bg-violet-50 text-violet-900" };
  if (t.includes("vte"))
    return { label: "VTE", cls: "border border-orange-200 bg-orange-50 text-orange-900" };
  if (t.includes("diet"))
    return { label: "Diet", cls: "border border-emerald-200 bg-emerald-50 text-emerald-900" };
  if (t.includes("proced"))
    return { label: "Proc", cls: "border border-slate-200 bg-slate-100 text-slate-800" };
  return { label: "Med", cls: "border border-blue-200 bg-blue-50 text-blue-900" };
}

/** Borderless numeric line input — no type="number". */
function NumericLineInput({
  value,
  onChange,
  disabled,
  className,
  placeholder,
  inputMode = "numeric",
  pattern = "[0-9]*",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  inputMode?: "numeric" | "decimal";
  pattern?: string;
}) {
  return (
    <input
      type="text"
      inputMode={inputMode}
      pattern={pattern}
      disabled={disabled}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
      className={cn(
        "min-w-0 border-0 bg-transparent p-0 font-bold text-slate-900 outline-none ring-0 focus:ring-0",
        className,
      )}
    />
  );
}

export type IpdDailyNotesWorkspaceProps = {
  admissionId: string;
  hospitalId: string;
  admissionData: Record<string, unknown> | null;
  onRefetchAdmission: () => Promise<void>;
  /** Increment from parent after a new consult is requested to refresh the sidebar list. */
  consultRefreshKey?: number;
};

type NoteDraft = {
  pain_score: string;
  appetite: string;
  sleep_ok: boolean | null;
  bowel_ok: boolean | null;
  bladder_ok: boolean | null;
  subjective_text: string;
  heart_rate: string;
  bp_systolic: string;
  bp_diastolic: string;
  respiratory_rate: string;
  temperature_c: string;
  spo2: string;
  condition_status: string;
  objective_text: string;
  wound: WoundJson;
  assessment_text: string;
  plan_narrative: string;
  medical_surgical_notes: string;
};

function emptyDraft(): NoteDraft {
  return {
    pain_score: "",
    appetite: "",
    sleep_ok: null,
    bowel_ok: null,
    bladder_ok: null,
    subjective_text: "",
    heart_rate: "",
    bp_systolic: "",
    bp_diastolic: "",
    respiratory_rate: "",
    temperature_c: "",
    spo2: "",
    condition_status: "Stable",
    objective_text: "",
    wound: { ...DEFAULT_WOUND },
    assessment_text: "",
    plan_narrative: "",
    medical_surgical_notes: "",
  };
}

type VitalsFieldKey =
  | "bp_systolic"
  | "bp_diastolic"
  | "heart_rate"
  | "temperature_c"
  | "respiratory_rate"
  | "spo2"
  | "pain_score";

const VITAL_FIELD_LIST: VitalsFieldKey[] = [
  "bp_systolic",
  "bp_diastolic",
  "heart_rate",
  "temperature_c",
  "respiratory_rate",
  "spo2",
  "pain_score",
];

function vitalsFromIpdRowPartial(row: Record<string, unknown>): Partial<NoteDraft> {
  const patch: Partial<NoteDraft> = {};
  const sys = num(row.bp_systolic);
  const dia = num(row.bp_diastolic);
  if (sys != null) patch.bp_systolic = String(Math.round(sys));
  if (dia != null) patch.bp_diastolic = String(Math.round(dia));
  const hr = num(row.heart_rate);
  if (hr != null) patch.heart_rate = String(Math.round(hr));
  const t = num(row.temperature_c);
  if (t != null) patch.temperature_c = String(t);
  const rr = num(row.respiratory_rate);
  if (rr != null) patch.respiratory_rate = String(Math.round(rr));
  const sp = num(row.spo2);
  if (sp != null) patch.spo2 = String(Math.round(sp));
  const pain = num(row.pain_score);
  if (pain != null) patch.pain_score = String(Math.min(10, Math.max(0, Math.round(pain))));
  return patch;
}

function mergeVitalsFromIpd(
  prevDraft: NoteDraft,
  vrow: Record<string, unknown>,
  prov: Partial<Record<VitalsFieldKey, "nursing" | "doctor">>,
): {
  draft: NoteDraft;
  provenance: Partial<Record<VitalsFieldKey, "nursing" | "doctor">>;
  at: string | null;
} {
  const patch = vitalsFromIpdRowPartial(vrow);
  const nextProv: Partial<Record<VitalsFieldKey, "nursing" | "doctor">> = { ...prov };
  const nextDraft: NoteDraft = { ...prevDraft };
  for (const f of VITAL_FIELD_LIST) {
    if (nextProv[f] === "doctor") continue;
    const dk = f as keyof NoteDraft;
    const p = patch[dk];
    if (p !== undefined && p !== "") {
      nextDraft[dk] = p as never;
      nextProv[f] = "nursing";
    }
  }
  return { draft: nextDraft, provenance: nextProv, at: s(vrow.recorded_at) || null };
}

function rowToDraft(row: Record<string, unknown>): NoteDraft {
  const d = emptyDraft();
  const ps = num(row.pain_score);
  d.pain_score = ps != null ? String(ps) : "";
  d.appetite = s(row.appetite);
  d.sleep_ok = typeof row.sleep_ok === "boolean" ? row.sleep_ok : row.sleep_ok == null ? null : Boolean(row.sleep_ok);
  d.bowel_ok = typeof row.bowel_ok === "boolean" ? row.bowel_ok : row.bowel_ok == null ? null : Boolean(row.bowel_ok);
  d.bladder_ok = typeof row.bladder_ok === "boolean" ? row.bladder_ok : row.bladder_ok == null ? null : Boolean(row.bladder_ok);
  d.subjective_text = s(row.subjective_text);
  d.heart_rate = s(row.heart_rate ?? row.hr);
  d.bp_systolic = s(row.bp_systolic);
  d.bp_diastolic = s(row.bp_diastolic);
  d.respiratory_rate = s(row.respiratory_rate ?? row.rr);
  const t = num(row.temperature_c ?? row.temperature);
  d.temperature_c = t != null ? String(t) : "";
  d.spo2 = s(row.spo2);
  d.condition_status = s(row.condition_status) || "Stable";
  d.objective_text = s(row.objective_text);
  d.wound = parseWoundJson(s(row.wound_status));
  d.assessment_text = s(row.assessment_text);
  d.plan_narrative = s(row.plan_narrative);
  d.medical_surgical_notes = s(row.medical_surgical_notes);
  return d;
}

function hydrateClinicalSnomedFromRow(
  row: Record<string, unknown>,
  setters: {
    setSubjectiveChips: (v: ClinicalChip[]) => void;
    setSubjectiveFreeText: (v: string) => void;
    setExamChips: (v: ClinicalChip[]) => void;
    setObjectiveFreeText: (v: string) => void;
    setDiagnosisEntries: (v: IpdDiagnosisEntry[]) => void;
    setAssessmentFreeText: (v: string) => void;
    setComplaintQuery: (v: string) => void;
    setExamQuery: (v: string) => void;
    setDiagnosisQuery: (v: string) => void;
  },
) {
  const complaintTerms = parseIpdSnomedTermsJson(row.symptoms_json);
  const subjectiveChipsHydrated = complaintTerms.map(ipdSnomedTermToClinicalChip);
  setters.setSubjectiveChips(subjectiveChipsHydrated);
  const legacySubjFree = readLegacyFreeTextFromJson(row.symptoms_json);
  if (legacySubjFree !== undefined && complaintTerms.length > 0) {
    setters.setSubjectiveFreeText(legacySubjFree);
  } else if (complaintTerms.length === 0) {
    setters.setSubjectiveFreeText(s(row.subjective_text));
  } else {
    const chipLine = buildSubjectiveDisplayText(subjectiveChipsHydrated, "");
    setters.setSubjectiveFreeText(recoverFreeTextBelowChipLine(s(row.subjective_text), chipLine));
  }

  let assessTerms = parseIpdSnomedTermsJson(row.snomed_assessment);
  if (assessTerms.length === 0) {
    assessTerms = parseLegacyLocalExamAssessmentTerms(row.local_exam_json);
  }
  const diagnosisHydrated = assessTerms.map(ipdSnomedTermToDiagnosisEntry);
  setters.setDiagnosisEntries(diagnosisHydrated);

  let findingTerms = parseIpdSnomedTermsJson(row.snomed_findings);
  if (findingTerms.length === 0) {
    findingTerms = parseLegacyLocalExamFindingTerms(row.local_exam_json);
  }
  const examChipsHydrated = findingTerms.map(ipdSnomedTermToClinicalChip);
  setters.setExamChips(examChipsHydrated);

  const legacyAo = readLegacyAssessmentObjectiveFreeFromLocalExam(row.local_exam_json);
  if (legacyAo.assessment !== undefined && assessTerms.length > 0) {
    setters.setAssessmentFreeText(legacyAo.assessment);
  } else if (assessTerms.length === 0) {
    setters.setAssessmentFreeText(s(row.assessment_text));
  } else {
    const chipLine = buildAssessmentDisplayText(diagnosisHydrated, "");
    setters.setAssessmentFreeText(recoverFreeTextBelowChipLine(s(row.assessment_text), chipLine));
  }

  if (legacyAo.objective !== undefined && findingTerms.length > 0) {
    setters.setObjectiveFreeText(legacyAo.objective);
  } else if (findingTerms.length === 0) {
    setters.setObjectiveFreeText(s(row.objective_text));
  } else {
    const chipLine = buildObjectiveDisplayText(examChipsHydrated, "");
    setters.setObjectiveFreeText(recoverFreeTextBelowChipLine(s(row.objective_text), chipLine));
  }

  setters.setComplaintQuery("");
  setters.setExamQuery("");
  setters.setDiagnosisQuery("");
}

function noteDateYmd(r: Record<string, unknown>): string {
  const nd = s(r.note_date);
  return nd.length >= 10 ? nd.slice(0, 10) : nd;
}

/** Local calendar YYYY-MM-DD for `note_date` — matches `todayLocalYmd()` for “today” selection. */
function noteDateLocalCalendarYmd(r: Record<string, unknown>): string {
  const raw = s(r.note_date);
  if (!raw) return "";
  const head = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head) && raw.length <= 10) return head;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return head;
  const d = new Date(t);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Timeline: newest clinical day first (by calendar date). */
function getProgressNotes(data: Record<string, unknown> | null): Record<string, unknown>[] {
  const raw = data?.progress_notes;
  if (!Array.isArray(raw)) return [];
  return [...raw].sort((a, b) => {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const da = noteDateYmd(ra);
    const db = noteDateYmd(rb);
    if (da !== db) return db.localeCompare(da);
    const ha = num(ra.hospital_day_number) ?? 0;
    const hb = num(rb.hospital_day_number) ?? 0;
    if (ha !== hb) return hb - ha;
    return s(rb.id).localeCompare(s(ra.id));
  });
}

/** Calendar "today" in local time — matches typical `note_date` YYYY-MM-DD storage. */
function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function IpdDailyNotesWorkspace({
  admissionId,
  hospitalId: hospitalIdFromPage,
  admissionData,
  onRefetchAdmission,
  consultRefreshKey = 0,
}: IpdDailyNotesWorkspaceProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteRow, setNoteRow] = useState<Record<string, unknown> | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft>(emptyDraft);
  const noteDraftRef = useRef<NoteDraft>(emptyDraft());
  const [vitalsFieldSource, setVitalsFieldSource] = useState<Partial<Record<VitalsFieldKey, "nursing" | "doctor">>>({});
  const vitalsFieldSourceRef = useRef<Partial<Record<VitalsFieldKey, "nursing" | "doctor">>>({});
  const [latestNursingVitalsAt, setLatestNursingVitalsAt] = useState<string | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [signBusy, setSignBusy] = useState(false);
  const [admissionConsults, setAdmissionConsults] = useState<Record<string, unknown>[]>([]);
  const [loadingAdmissionConsults, setLoadingAdmissionConsults] = useState(false);
  const [expandedConsultId, setExpandedConsultId] = useState<string | null>(null);
  const [autoTodayNotePending, setAutoTodayNotePending] = useState(false);
  const autoTodayInsertStarted = useRef(false);
  /** When true, keep the user's timeline choice if there is no note for today (otherwise today wins). */
  const userPickedTimelineRef = useRef(false);

  const [subjectiveChips, setSubjectiveChips] = useState<ClinicalChip[]>([]);
  const [subjectiveFreeText, setSubjectiveFreeText] = useState("");
  const [complaintQuery, setComplaintQuery] = useState("");
  const [examChips, setExamChips] = useState<ClinicalChip[]>([]);
  const [objectiveFreeText, setObjectiveFreeText] = useState("");
  const [examQuery, setExamQuery] = useState("");
  const [diagnosisEntries, setDiagnosisEntries] = useState<IpdDiagnosisEntry[]>([]);
  const [assessmentFreeText, setAssessmentFreeText] = useState("");
  const [diagnosisQuery, setDiagnosisQuery] = useState("");

  useEffect(() => {
    noteDraftRef.current = noteDraft;
  }, [noteDraft]);

  useEffect(() => {
    vitalsFieldSourceRef.current = vitalsFieldSource;
  }, [vitalsFieldSource]);

  const markVitalsDoctorField = useCallback((field: VitalsFieldKey) => {
    setVitalsFieldSource((prev) => {
      const next = { ...prev, [field]: "doctor" as const };
      vitalsFieldSourceRef.current = next;
      return next;
    });
  }, []);

  const skipNextDebouncedSave = useRef(true);
  const progressNoteSavePayload = useMemo(() => {
    return {
      ...noteDraft,
      subjective_text: buildSubjectiveDisplayText(subjectiveChips, subjectiveFreeText),
      objective_text: buildObjectiveDisplayText(examChips, objectiveFreeText),
      assessment_text: buildAssessmentDisplayText(diagnosisEntries, assessmentFreeText),
      symptoms_json: buildComplaintSnomedPayload(subjectiveChips),
      snomed_assessment: buildAssessmentSnomedPayload(diagnosisEntries),
      snomed_findings: buildFindingsSnomedPayload(examChips),
    };
  }, [
    noteDraft,
    subjectiveChips,
    subjectiveFreeText,
    examChips,
    objectiveFreeText,
    diagnosisEntries,
    assessmentFreeText,
  ]);
  const debouncedProgressPayload = useDebouncedValue(progressNoteSavePayload, 1000);
  const debouncedFingerprint = useMemo(
    () => JSON.stringify(debouncedProgressPayload),
    [debouncedProgressPayload],
  );

  const admission = asRec(admissionData?.admission) ?? null;
  const patient = patientFromAdmission(admissionData as Record<string, unknown> | null);
  const preAdmission = preAdmissionFrom(admissionData as Record<string, unknown> | null);
  const doctor = asRec(admissionData?.doctor);

  const specialtyName = s(admission?.specialty);
  const voiceSpecialty = s(preAdmission?.specialty) || specialtyName || "General Medicine";
  const isSurgicalCase = (SURGICAL_SPECIALTIES as readonly string[]).includes(specialtyName);
  const surgeryDone = (() => {
    const sd = admission?.surgery_date;
    if (sd == null || s(sd) === "") return false;
    const t = new Date(s(sd)).getTime();
    if (Number.isNaN(t)) return false;
    return new Date(s(sd)) <= new Date();
  })();

  const progressNotes = useMemo(() => getProgressNotes(admissionData), [admissionData]);

  /** `get_ipd_admission` / bundle: hospital may appear on root JSON or nested `admission`. */
  const hospitalIdFromAdmissionData = useMemo(() => {
    const bundle = admissionData as Record<string, unknown> | null;
    if (!bundle) return "";
    const topLevel = s(bundle.hospital_id);
    const fromAdmission =
      s(admission?.hospital_id) || s(admission?.hospitalId) || s(admission?.p_hospital_id);
    return topLevel || fromAdmission;
  }, [admissionData, admission]);

  /** Prefer traced bundle → page (parent already falls back to default) → product default. */
  const resolvedHospitalId = useMemo(() => {
    return hospitalIdFromAdmissionData || s(hospitalIdFromPage) || IPD_DEFAULT_HOSPITAL_ID;
  }, [hospitalIdFromAdmissionData, hospitalIdFromPage]);

  const patientId = useMemo(() => {
    return s(admission?.patient_id) || s(patient?.id);
  }, [admission, patient]);

  const [investigations, setInvestigations] = useState<Record<string, unknown>[]>([]);
  const [treatments, setTreatments] = useState<Record<string, unknown>[]>([]);
  const [nabhRow, setNabhRow] = useState<Record<string, unknown> | null>(null);
  const [ioRow, setIoRow] = useState<Record<string, unknown> | null>(null);
  const [admissionInv, setAdmissionInv] = useState<Record<string, unknown>[]>([]);

  const [addMedOpen, setAddMedOpen] = useState(false);
  const [addOrderOpen, setAddOrderOpen] = useState(false);
  const [newMed, setNewMed] = useState({
    name: "",
    dose: "",
    route: "IV",
    frequency: "BD",
    kind: "medical",
    durationDays: "",
    selectedDrugId: null as string | null,
  });
  const [invSearchQuery, setInvSearchQuery] = useState("");
  const [invResults, setInvResults] = useState<InvCataloguePick[]>([]);
  const [pendingInvTest, setPendingInvTest] = useState<InvCataloguePick | null>(null);
  const [orderInvBusy, setOrderInvBusy] = useState(false);
  const [drugQuery, setDrugQuery] = useState("");
  const [drugResults, setDrugResults] = useState<DrugMasterRow[]>([]);
  const invSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drugSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invDropdownRef = useRef<HTMLDivElement>(null);
  const drugDropdownRef = useRef<HTMLDivElement>(null);

  const [ioDraft, setIoDraft] = useState({ drain: "", urine: "", iv: "", oral: "" });
  const [nabhDraft, setNabhDraft] = useState({
    vte: null as boolean | null,
    fall: null as boolean | null,
    pressure: null as boolean | null,
    consent: null as boolean | null,
    diet: "Normal",
    activity: "Full",
    ivSite: "",
    consultText: "",
  });

  const skipIoSave = useRef(true);
  const skipNabhSave = useRef(true);
  /** Serialize I/O and NABH upserts so concurrent inserts never race on the same unique keys. */
  const ioPersistChainRef = useRef<Promise<void>>(Promise.resolve());
  const nabhPersistChainRef = useRef<Promise<void>>(Promise.resolve());
  const debouncedIo = useDebouncedValue(ioDraft, 500);
  const debouncedNabh = useDebouncedValue(nabhDraft, 500);

  const [subOpen, setSubOpen] = useState(true);
  const [objOpen, setObjOpen] = useState(true);
  const [apOpen, setApOpen] = useState(true);
  const [invOpen, setInvOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(true);
  const [nabhOpen, setNabhOpen] = useState(true);
  const [ioOpen, setIoOpen] = useState(true);

  useEffect(() => {
    userPickedTimelineRef.current = false;
  }, [admissionId]);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      setCurrentUserId(uid);
      if (!uid) return;
      const { data: prof } = await supabase.from("practitioners").select("id").eq("user_id", uid).maybeSingle();
      if (prof?.id) setPractitionerId(String(prof.id));
    })();
  }, []);

  useEffect(() => {
    if (progressNotes.length === 0) {
      setSelectedNoteId(null);
      return;
    }
    const todayYmd = todayLocalYmd();
    setSelectedNoteId((prev) => {
      const todayNote = progressNotes.find(
        (n) => noteDateLocalCalendarYmd(n as Record<string, unknown>) === todayYmd,
      );
      if (todayNote) {
        const id = s((todayNote as Record<string, unknown>).id) || null;
        userPickedTimelineRef.current = false;
        return id;
      }
      const prevValid = prev && progressNotes.some((n) => s((n as Record<string, unknown>).id) === prev);
      if (userPickedTimelineRef.current && prevValid) return prev;
      const defaultNote = progressNotes[0];
      return s((defaultNote as Record<string, unknown>).id) || null;
    });
  }, [progressNotes]);

  /**
   * After admission data (including progress notes) is loaded: if no row has note_date = today,
   * insert a draft note with only the core fields — DB trigger sets hospital_day_number.
   * Then refetch and select today’s note for the default view.
   */
  useEffect(() => {
    if (!admissionId || admissionData == null) return;

    const admission_id = admissionId;
    const patient_id = patientId;
    const hospital_id = resolvedHospitalId;

    if (!admission_id || !patient_id || !hospital_id) {
      // eslint-disable-next-line no-console -- IPD auto-note diagnostics
      console.log("[IPD auto-note] Guard: missing id(s), skipping insert", {
        admission_id,
        patient_id,
        hospital_id,
        hospitalIdFromAdmissionData,
        hospitalIdFromPage,
        admissionDataTopLevelHospitalId: s(
          (admissionData as Record<string, unknown> | null)?.hospital_id,
        ),
        admissionNested: admission
          ? {
              hospital_id: admission.hospital_id,
              hospitalId: admission.hospitalId,
              p_hospital_id: admission.p_hospital_id,
            }
          : null,
      });
      return;
    }

    const todayYmd = todayLocalYmd();
    const hasToday = progressNotes.some(
      (n) => noteDateLocalCalendarYmd(n as Record<string, unknown>) === todayYmd,
    );
    if (hasToday) {
      autoTodayInsertStarted.current = false;
      setAutoTodayNotePending(false);
      return;
    }
    if (autoTodayInsertStarted.current) return;
    autoTodayInsertStarted.current = true;
    let cancelled = false;
    void (async () => {
      setAutoTodayNotePending(true);
      const payload = {
        admission_id,
        patient_id,
        hospital_id,
        note_date: todayYmd,
        status: "draft" as const,
      };
      // eslint-disable-next-line no-console -- IPD auto-note diagnostics (full payload before insert)
      console.log("[IPD auto-note] Full insert payload:", payload);
      const { data, error } = await supabase.from("ipd_progress_notes").insert(payload).select("id").maybeSingle();
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console -- IPD auto-note diagnostics
        console.log("[IPD auto-note] Insert result:", { data, error });
      }
      if (cancelled) return;
      if (error) {
        autoTodayInsertStarted.current = false;
        // eslint-disable-next-line no-console -- surface same failure in console as toast
        console.error("[IPD auto-note] Insert failed:", error);
        const detail = [error.details, error.hint].filter(Boolean).join(" · ");
        toast.error(error.message || "Could not create today's progress note", detail ? { description: detail } : undefined);
        setAutoTodayNotePending(false);
        return;
      }
      const newId = data && typeof data === "object" && "id" in data ? s(data.id) : "";
      await onRefetchAdmission();
      if (cancelled) return;
      userPickedTimelineRef.current = false;
      if (newId) setSelectedNoteId(newId);
      setAutoTodayNotePending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    admission,
    admissionData,
    admissionId,
    hospitalIdFromAdmissionData,
    hospitalIdFromPage,
    onRefetchAdmission,
    patientId,
    progressNotes,
    resolvedHospitalId,
  ]);

  const loadNote = useCallback(
    async (noteId: string) => {
      setLoadingNote(true);
      skipNextDebouncedSave.current = true;
      setVitalsFieldSource({});
      vitalsFieldSourceRef.current = {};
      setLatestNursingVitalsAt(null);
      const { data, error } = await supabase.from("ipd_progress_notes").select("*").eq("id", noteId).maybeSingle();
      if (error) {
        setLoadingNote(false);
        toast.error(error.message);
        return;
      }
      if (data && typeof data === "object") {
        const row = data as Record<string, unknown>;
        setNoteRow(row);
        const baseDraft = rowToDraft(row);
        const { data: vData } = await supabase
          .from("ipd_vitals")
          .select("*")
          .eq("admission_id", admissionId)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (vData && typeof vData === "object") {
          const m = mergeVitalsFromIpd(baseDraft, vData as Record<string, unknown>, {});
          setNoteDraft(m.draft);
          noteDraftRef.current = m.draft;
          setVitalsFieldSource(m.provenance);
          vitalsFieldSourceRef.current = m.provenance;
          setLatestNursingVitalsAt(m.at);
        } else {
          setNoteDraft(baseDraft);
          noteDraftRef.current = baseDraft;
        }
        hydrateClinicalSnomedFromRow(row, {
          setSubjectiveChips,
          setSubjectiveFreeText,
          setExamChips,
          setObjectiveFreeText,
          setDiagnosisEntries,
          setAssessmentFreeText,
          setComplaintQuery,
          setExamQuery,
          setDiagnosisQuery,
        });
      } else {
        setNoteRow(null);
        setNoteDraft(emptyDraft());
        noteDraftRef.current = emptyDraft();
        hydrateClinicalSnomedFromRow(
          {},
          {
            setSubjectiveChips,
            setSubjectiveFreeText,
            setExamChips,
            setObjectiveFreeText,
            setDiagnosisEntries,
            setAssessmentFreeText,
            setComplaintQuery,
            setExamQuery,
            setDiagnosisQuery,
          },
        );
      }
      setLoadingNote(false);
    },
    [admissionId],
  );

  useEffect(() => {
    if (!selectedNoteId) {
      setNoteRow(null);
      setNoteDraft(emptyDraft());
      noteDraftRef.current = emptyDraft();
      setVitalsFieldSource({});
      vitalsFieldSourceRef.current = {};
      setLatestNursingVitalsAt(null);
      hydrateClinicalSnomedFromRow(
        {},
        {
          setSubjectiveChips,
          setSubjectiveFreeText,
          setExamChips,
          setObjectiveFreeText,
          setDiagnosisEntries,
          setAssessmentFreeText,
          setComplaintQuery,
          setExamQuery,
          setDiagnosisQuery,
        },
      );
      return;
    }
    void loadNote(selectedNoteId);
  }, [selectedNoteId, loadNote]);

  useEffect(() => {
    if (!admissionId || !selectedNoteId) return;
    const channel = supabase
      .channel(`ipd-vitals-${admissionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ipd_vitals", filter: `admission_id=eq.${admissionId}` },
        () => {
          void (async () => {
            const { data: vRow } = await supabase
              .from("ipd_vitals")
              .select("*")
              .eq("admission_id", admissionId)
              .order("recorded_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (!vRow || typeof vRow !== "object") return;
            skipNextDebouncedSave.current = true;
            const prev = noteDraftRef.current;
            const m = mergeVitalsFromIpd(prev, vRow as Record<string, unknown>, vitalsFieldSourceRef.current);
            noteDraftRef.current = m.draft;
            vitalsFieldSourceRef.current = m.provenance;
            setNoteDraft(m.draft);
            setVitalsFieldSource(m.provenance);
            setLatestNursingVitalsAt(m.at);
          })();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [admissionId, selectedNoteId]);

  const signed = s(noteRow?.status).toLowerCase() === "signed";
  /** Only SOAP narrative / coded text blocks — not investigations, meds, NABH, or I/O. */
  const soapTextLocked = signed;
  const [amendmentBanner, setAmendmentBanner] = useState(false);

  useEffect(() => {
    setAmendmentBanner(false);
  }, [selectedNoteId]);

  useEffect(() => {
    if (!selectedNoteId) return;
    if (skipNextDebouncedSave.current) {
      skipNextDebouncedSave.current = false;
      return;
    }
    void (async () => {
      const d = debouncedProgressPayload;
      const patch: Record<string, unknown> = {
        pain_score: d.pain_score ? parseFloat(d.pain_score) : null,
        appetite: d.appetite || null,
        sleep_ok: d.sleep_ok,
        bowel_ok: d.bowel_ok,
        bladder_ok: d.bladder_ok,
        subjective_text: d.subjective_text || null,
        symptoms_json: d.symptoms_json,
        heart_rate: d.heart_rate ? parseFloat(d.heart_rate) : null,
        bp_systolic: d.bp_systolic ? parseFloat(d.bp_systolic) : null,
        bp_diastolic: d.bp_diastolic ? parseFloat(d.bp_diastolic) : null,
        respiratory_rate: d.respiratory_rate ? parseFloat(d.respiratory_rate) : null,
        temperature_c: d.temperature_c ? parseFloat(d.temperature_c) : null,
        spo2: d.spo2 ? parseFloat(d.spo2) : null,
        condition_status: d.condition_status || null,
        objective_text: d.objective_text || null,
        wound_status: JSON.stringify(d.wound),
        assessment_text: d.assessment_text || null,
        snomed_assessment: d.snomed_assessment,
        snomed_findings: d.snomed_findings,
        plan_narrative: d.plan_narrative || null,
        medical_surgical_notes: d.medical_surgical_notes || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("ipd_progress_notes").update(patch).eq("id", selectedNoteId);
      if (error) toast.error(error.message);
    })();
  }, [debouncedFingerprint, selectedNoteId]);

  const loadSecondaryForNote = useCallback(
    async (noteId: string, noteDateIso: string) => {
      const nd = noteDateIso.slice(0, 10);
      const [invR, txR, nabR, ioR] = await Promise.all([
        supabase.from("ipd_investigation_orders").select("*").eq("progress_note_id", noteId).order("created_at", { ascending: false }),
        supabase.from("ipd_treatments").select("*").eq("progress_note_id", noteId).order("ordered_date", { ascending: false }),
        supabase.from("ipd_nabh_checklist").select("*").eq("progress_note_id", noteId).maybeSingle(),
        supabase
          .from("ipd_io_records")
          .select("*")
          .eq("progress_note_id", noteId)
          .eq("record_date", nd)
          .maybeSingle(),
      ]);
      if (!invR.error) setInvestigations((invR.data ?? []) as Record<string, unknown>[]);
      if (!txR.error) setTreatments((txR.data ?? []) as Record<string, unknown>[]);
      if (!nabR.error && nabR.data) {
        const nab = nabR.data as Record<string, unknown>;
        setNabhRow(nab);
        setNabhDraft({
          vte: typeof nab.vte_prophylaxis_given === "boolean" ? nab.vte_prophylaxis_given : null,
          fall: typeof nab.fall_risk_assessed === "boolean" ? nab.fall_risk_assessed : null,
          pressure: typeof nab.pressure_sore_checked === "boolean" ? nab.pressure_sore_checked : null,
          consent: typeof nab.consent_valid === "boolean" ? nab.consent_valid : null,
          diet: s(nab.diet_order) || "Normal",
          activity: s(nab.activity_order ?? nab.activity) || "Full",
          ivSite: s(nab.iv_access_site),
          consultText: (() => {
            const c = nab.consults_requested;
            if (Array.isArray(c)) return c.map((x) => s(x)).filter(Boolean).join(", ");
            if (typeof c === "string") {
              try {
                const j = JSON.parse(c) as unknown;
                if (Array.isArray(j)) return j.map((x) => s(x)).filter(Boolean).join(", ");
              } catch {
                return c;
              }
            }
            return "";
          })(),
        });
      } else {
        setNabhRow(null);
        setNabhDraft({
          vte: null,
          fall: null,
          pressure: null,
          consent: null,
          diet: "Normal",
          activity: "Full",
          ivSite: "",
          consultText: "",
        });
      }
      skipIoSave.current = true;
      skipNabhSave.current = true;
      if (!ioR.error && ioR.data) {
        const io = ioR.data as Record<string, unknown>;
        setIoRow(io);
        setIoDraft({
          drain: s(io.drain_output_ml),
          urine: s(io.urine_output_ml),
          iv: s(io.iv_fluid_ml),
          oral: s(io.oral_intake_ml),
        });
      } else {
        setIoRow(null);
        setIoDraft({ drain: "", urine: "", iv: "", oral: "" });
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedNoteId || !noteRow || s(noteRow.id) !== selectedNoteId) return;
    const nd = s(noteRow.note_date);
    if (!nd) return;
    void loadSecondaryForNote(selectedNoteId, nd);
  }, [selectedNoteId, noteRow, loadSecondaryForNote]);

  useEffect(() => {
    if (!admissionId) return;
    void (async () => {
      const { data, error } = await supabase
        .from("ipd_investigation_orders")
        .select("*")
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: false });
      if (!error && data) setAdmissionInv(data as Record<string, unknown>[]);
    })();
  }, [admissionId, admissionData]);

  useEffect(() => {
    if (!admissionId) return;
    let cancelled = false;
    setLoadingAdmissionConsults(true);
    void (async () => {
      const { data, error } = await rpcGetAdmissionConsults(supabase, admissionId);
      if (cancelled) return;
      setLoadingAdmissionConsults(false);
      if (error) {
        console.warn("[admission consults]", error.message);
        setAdmissionConsults([]);
        return;
      }
      setAdmissionConsults(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [admissionId, consultRefreshKey]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (invDropdownRef.current && !invDropdownRef.current.contains(e.target as Node)) {
        setInvResults([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (drugDropdownRef.current && !drugDropdownRef.current.contains(e.target as Node)) {
        setDrugResults([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const debouncedIoFp = useMemo(() => JSON.stringify(debouncedIo), [debouncedIo]);
  const debouncedNabhFp = useMemo(() => JSON.stringify(debouncedNabh), [debouncedNabh]);

  useEffect(() => {
    if (!selectedNoteId || !noteRow || !patientId) return;
    if (skipIoSave.current) {
      skipIoSave.current = false;
      return;
    }
    const nd = s(noteRow.note_date).slice(0, 10);
    if (!nd) return;

    const capture = debouncedIo;
    const capNoteId = selectedNoteId;
    const capAdmissionId = admissionId;
    const capPatientId = patientId;
    const capHospitalId = resolvedHospitalId;

    ioPersistChainRef.current = ioPersistChainRef.current
      .then(async () => {
        const drain = parseFloat(capture.drain) || 0;
        const urine = parseFloat(capture.urine) || 0;
        const iv = parseFloat(capture.iv) || 0;
        const oral = parseFloat(capture.oral) || 0;
        const row: Record<string, unknown> = {
          hospital_id: capHospitalId,
          admission_id: capAdmissionId,
          progress_note_id: capNoteId,
          patient_id: capPatientId,
          record_date: nd,
          drain_output_ml: drain,
          urine_output_ml: urine,
          iv_fluid_ml: iv,
          oral_intake_ml: oral,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("ipd_io_records").upsert(row, {
          onConflict: "admission_id,record_date",
        });
        if (error && !isPostgresDuplicateKey(error)) {
          toast.error(error.message);
        }
      })
      .catch(() => {});
  }, [debouncedIoFp, selectedNoteId, noteRow, patientId, resolvedHospitalId, admissionId]);

  useEffect(() => {
    if (!selectedNoteId || !noteRow || !currentUserId || !patientId) return;
    if (skipNabhSave.current) {
      skipNabhSave.current = false;
      return;
    }
    const nd = s(noteRow.note_date).slice(0, 10);
    if (!nd) return;

    const cap = debouncedNabh;
    const capNoteId = selectedNoteId;
    const capAdmissionId = admissionId;
    const capPatientId = patientId;
    const capHospitalId = resolvedHospitalId;
    const capUserId = currentUserId;

    nabhPersistChainRef.current = nabhPersistChainRef.current
      .then(async () => {
        const consultJson: unknown = cap.consultText.trim()
          ? cap.consultText
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : [];
        const row: Record<string, unknown> = {
          hospital_id: capHospitalId,
          admission_id: capAdmissionId,
          progress_note_id: capNoteId,
          patient_id: capPatientId,
          checklist_date: nd,
          completed_by: capUserId,
          vte_prophylaxis_given: cap.vte,
          fall_risk_assessed: cap.fall,
          pressure_sore_checked: cap.pressure,
          consent_valid: cap.consent,
          diet_order: cap.diet,
          activity_order: cap.activity,
          iv_access_site: cap.ivSite || null,
          consults_requested: consultJson,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("ipd_nabh_checklist").upsert(row, {
          onConflict: "progress_note_id",
        });
        if (error && !isPostgresDuplicateKey(error)) {
          toast.error(error.message);
        }
      })
      .catch(() => {});
  }, [
    debouncedNabhFp,
    selectedNoteId,
    noteRow,
    currentUserId,
    patientId,
    resolvedHospitalId,
    admissionId,
  ]);

  const handleSign = async () => {
    if (!selectedNoteId || !currentUserId) {
      toast.error("Cannot sign note.");
      return;
    }
    setSignBusy(true);
    const { error } = await supabase
      .from("ipd_progress_notes")
      .update({
        status: "signed",
        signed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedNoteId);
    setSignBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Note signed");
    setAmendmentBanner(false);
    await loadNote(selectedNoteId);
    await onRefetchAdmission();
  };

  const handleAmend = async () => {
    if (!selectedNoteId) return;
    setSignBusy(true);
    const { error } = await supabase
      .from("ipd_progress_notes")
      .update({
        status: "draft",
        signed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedNoteId);
    setSignBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAmendmentBanner(true);
    await loadNote(selectedNoteId);
    await onRefetchAdmission();
  };

  const diagnosis =
    s(admission?.primary_diagnosis_display) || s(preAdmission?.primary_diagnosis_display) || "—";
  const diagnosisIcd10 =
    s(admission?.primary_diagnosis_icd10) || s(preAdmission?.primary_diagnosis_icd10) || null;
  const admittedFmt = formatClinicalDate(admission?.admitted_at);
  const surgeryRaw = s(admission?.surgery_date);
  const surgeryDisplay = surgeryRaw ? formatClinicalDate(surgeryRaw) : "—";
  const surgeonName = s(doctor?.full_name);
  const estDischarge = formatClinicalDate(admission?.expected_discharge_date);
  const coverageLabel = admission?.coverage_id ? "TPA" : "Self pay";

  const allergyText = (() => {
    const raw = patient?.known_allergies;
    if (raw == null || raw === "") return null;
    if (Array.isArray(raw)) return raw.map((x) => s(x)).filter(Boolean).join(", ") || null;
    return s(raw) || null;
  })();

  const wardRec = asRec(admissionData?.ward);
  const bedRec = asRec(admissionData?.bed);
  const wardBedLine = [s(wardRec?.name), s(bedRec?.bed_number) ? `Bed ${s(bedRec?.bed_number)}` : ""]
    .filter(Boolean)
    .join(", ");
  const headerDateFull = noteRow?.note_date ? formatClinicalDate(s(noteRow.note_date)) : "—";
  const headerDoc = s(asRec(noteRow?.doctor)?.full_name) || s(noteRow?.authored_by_name) || s(doctor?.full_name);
  const podLabel = num(noteRow?.post_op_day);
  const painN = Math.min(10, Math.max(0, parseInt(noteDraft.pain_score, 10) || 0));

  const criticalAlerts = admissionInv.filter(
    (x) => Boolean(x.is_critical) && x.critical_acknowledged_at == null && s(x.status).toLowerCase() !== "cancelled",
  );

  const conditionFlag =
    noteDraft.condition_status === "Deteriorating" || noteDraft.condition_status === "Critical";

  const pendingResults = admissionInv.filter((x) => {
    const st = s(x.status).toLowerCase();
    return st === "ordered" || st === "pending";
  });

  const ioBalance =
    (parseFloat(ioDraft.iv) || 0) +
    (parseFloat(ioDraft.oral) || 0) -
    ((parseFloat(ioDraft.drain) || 0) + (parseFloat(ioDraft.urine) || 0));

  const bumpPain = (d: number) => {
    setNoteDraft((prev) => {
      const n = Math.min(10, Math.max(0, (parseInt(prev.pain_score, 10) || 0) + d));
      return { ...prev, pain_score: String(n) };
    });
  };

  const refetchInvestigations = useCallback(async () => {
    if (!selectedNoteId) return;
    const { data, error } = await supabase
      .from("ipd_investigation_orders")
      .select("*")
      .eq("progress_note_id", selectedNoteId)
      .order("created_at", { ascending: false });
    if (!error && data) setInvestigations(data as Record<string, unknown>[]);
    const { data: admData, error: admErr } = await supabase
      .from("ipd_investigation_orders")
      .select("*")
      .eq("admission_id", admissionId)
      .order("created_at", { ascending: false });
    if (!admErr && admData) setAdmissionInv(admData as Record<string, unknown>[]);
  }, [selectedNoteId, admissionId]);

  const searchInvestigations = useCallback(
    async (query: string) => {
      const searchTerm = sanitizeIlike(query);
      if (searchTerm.length < 2) {
        setInvResults([]);
        return;
      }
      const normalised = normalizeInvestigationSearchTerm(searchTerm);
      const p1 = `%${normalised}%`;
      const p2 = `%${searchTerm}%`;
      const searchOr = `test_name.ilike.${p1},short_code.ilike.${p1},test_name.ilike.${p2},short_code.ilike.${p2}`;
      const { data, error } = await supabase
        .from("test_catalogue")
        .select(
          "id, test_name, short_code, category, loinc_code, snomed_code, snomed_display, hospital_id, sample_type, requires_fasting, expected_tat_hours, is_in_house, external_lab_name, list_price",
        )
        .eq("is_active", true)
        .or(searchOr)
        .order("test_name")
        .limit(24);
      if (error) {
        toast.error(error.message);
        setInvResults([]);
        return;
      }
      const hid = resolvedHospitalId;
      const rows = ((data ?? []) as InvCataloguePick[]).filter(
        (r) => r.hospital_id == null || s(r.hospital_id) === hid,
      );
      setInvResults(rows.slice(0, 15));
    },
    [resolvedHospitalId],
  );

  const openOrderInvestigationModal = (test: InvCataloguePick) => {
    if (!selectedNoteId || !patientId) {
      toast.error("Select a note first.");
      return;
    }
    setPendingInvTest(test);
  };

  const confirmPlaceInvestigationOrder = async (priority: "routine" | "urgent" | "stat") => {
    const test = pendingInvTest;
    if (!test || !selectedNoteId || !patientId || !currentUserId) {
      toast.error("Missing data for order.");
      return;
    }
    setOrderInvBusy(true);
    const orderedBy = practitionerId ?? currentUserId;
    const dayN = dayNumForNote(progressNotes, selectedNoteId);
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase.rpc("place_investigation_order", {
      p_hospital_id: resolvedHospitalId,
      p_admission_id: admissionId,
      p_patient_id: patientId,
      p_progress_note_id: selectedNoteId,
      p_test_name: test.test_name,
      p_test_category: s(test.category) || "General",
      p_loinc_code: test.loinc_code ?? "",
      p_priority: priority,
      p_ordered_by: orderedBy,
      p_investigation_id: test.id,
      p_ordered_on_day: Math.max(1, dayN),
      p_ordered_date: today,
    });
    setOrderInvBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const payload = data as { billing_status?: string } | null;
    const bill = s(payload?.billing_status).toLowerCase();
    if (bill === "pending_payment") {
      toast.success("Order placed — awaiting payment at reception");
    } else {
      toast.success("Order sent to lab");
    }
    setPendingInvTest(null);
    setInvSearchQuery("");
    setInvResults([]);
    await refetchInvestigations();
    if (noteRow?.note_date) void loadSecondaryForNote(selectedNoteId, s(noteRow.note_date));
    void onRefetchAdmission();
  };

  const searchDrugs = useCallback(
    async (query: string) => {
      const q = sanitizeIlike(query);
      if (q.length < 2) {
        setDrugResults([]);
        return;
      }
      const pat = `%${q}%`;
      const { data, error } = await supabase
        .from("drugs")
        .select("id, generic_name, brand_name, dosage_form, strength, mrp")
        .eq("hospital_id", resolvedHospitalId)
        .eq("is_active", true)
        .or(`generic_name.ilike.${pat},brand_name.ilike.${pat}`)
        .limit(10);
      if (error) {
        toast.error(error.message);
        setDrugResults([]);
        return;
      }
      setDrugResults((data ?? []) as DrugMasterRow[]);
    },
    [resolvedHospitalId],
  );

  const handleSaveTreatment = async () => {
    if (!selectedNoteId || !newMed.name.trim() || !patientId) {
      toast.error("Missing data for treatment.");
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const durationDays =
      newMed.durationDays.trim() === "" ? null : parseInt(newMed.durationDays.replace(/\D/g, ""), 10);
    const { error } = await supabase.from("ipd_treatments").insert({
      admission_id: admissionId,
      progress_note_id: selectedNoteId,
      patient_id: patientId,
      hospital_id: resolvedHospitalId,
      treatment_kind: newMed.kind,
      name: newMed.name.trim(),
      dose: newMed.dose || null,
      route: newMed.route,
      frequency: newMed.frequency,
      duration_days: durationDays != null && Number.isFinite(durationDays) ? durationDays : null,
      ordered_date: today,
      start_date: today,
      status: "active",
      ordering_practitioner_id: currentUserId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAddMedOpen(false);
    setDrugQuery("");
    setDrugResults([]);
    setNewMed({
      name: "",
      dose: "",
      route: "IV",
      frequency: "BD",
      kind: "medical",
      durationDays: "",
      selectedDrugId: null,
    });
    if (noteRow?.note_date) void loadSecondaryForNote(selectedNoteId, s(noteRow.note_date));
    void onRefetchAdmission();
  };

  const signedAtDisplay = noteRow?.signed_at ? fmtTimeShort(s(noteRow.signed_at)) : "";

  return (
    <div
      className={cn(
        "grid h-[min(100vh-14rem,920px)] min-h-[520px] w-full grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_260px] lg:gap-4",
        PAGE_BG,
      )}
    >
      {/* Timeline */}
      <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl", PANEL_LEFT)}>
        <div className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
          Admission timeline
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {progressNotes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
              No progress notes yet.
            </p>
          ) : (
            progressNotes.map((row) => {
              const r = row as Record<string, unknown>;
              const id = s(r.id);
              const active = id === selectedNoteId;
              const dayN = num(r.hospital_day_number) ?? 0;
              const title = `Day ${Math.max(1, dayN)}`;
              const nd = s(r.note_date);
              const docRec = asRec(r.doctor);
              const docName = docRec ? s(docRec.full_name) : s(r.doctor_name ?? r.authored_by_name);
              const tags = Array.isArray(r.day_tags) ? (r.day_tags as unknown[]) : [];
              const surgeryDay = Boolean(r.is_surgery_day);
              const cond = s(r.condition_status);
              const txC = num(r.treatment_count ?? r.tx_count) ?? 0;
              const invC = num(r.investigation_count ?? r.inv_count ?? r.order_count) ?? 0;
              return (
                <button
                  key={id || nd}
                  type="button"
                  onClick={() => {
                    userPickedTimelineRef.current = true;
                    setSelectedNoteId(id);
                  }}
                  className={cn(
                    "relative w-full overflow-hidden rounded-xl p-2.5 text-left text-xs shadow-sm transition",
                    active
                      ? "border-l-[3px] border-l-sky-500 bg-sky-50"
                      : "border-l-[3px] border-l-transparent bg-slate-100 hover:bg-slate-200",
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="font-semibold text-slate-900">{title}</p>
                    {surgeryDay ? (
                      <span title="Surgery day" className="text-orange-400" aria-hidden>
                        <Sparkles className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-600">{fmtDayShort(nd)}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600">{docName || "—"}</p>
                  {tags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tags.map((t, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-[10px] text-orange-800"
                        >
                          {s(t)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {(txC > 0 || invC > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {txC > 0 ? (
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] text-slate-700">
                          {txC} Rx
                        </span>
                      ) : null}
                      {invC > 0 ? (
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] text-slate-700">
                          {invC} order{invC !== 1 ? "s" : ""}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {cond ? (
                    <div className={cn("mt-2 h-1 w-full rounded-full", timelineConditionBarClass(cond))} title={cond} />
                  ) : (
                    <div className="mt-2 h-1 w-full rounded-full bg-slate-300" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Center */}
      <main className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl", PANEL_MAIN)}>
        {autoTodayNotePending && !selectedNoteId ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-2/3 bg-slate-200" />
            <Skeleton className="h-32 w-full bg-slate-200" />
            <p className="text-center text-xs text-slate-500">Preparing today&apos;s progress note…</p>
          </div>
        ) : !selectedNoteId ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sm text-slate-600">
            Select a day from the timeline
          </div>
        ) : loadingNote && !noteRow ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-2/3 bg-slate-200" />
            <Skeleton className="h-32 w-full bg-slate-200" />
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900">
                      Day {Math.max(1, num(noteRow?.hospital_day_number) ?? 0)} Progress Note
                      {podLabel != null ? (
                        <span className="ml-2 text-base font-semibold text-sky-600">· POD {podLabel}</span>
                      ) : null}
                    </h2>
                    {signed ? (
                      <>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                          Signed ✓{signedAtDisplay ? ` ${signedAtDisplay}` : ""}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 border-slate-300 px-2 text-xs text-slate-800"
                          disabled={signBusy}
                          onClick={() => void handleAmend()}
                        >
                          Amend
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {headerDateFull} · {headerDoc ? `Dr. ${headerDoc}` : "—"} · {wardBedLine || "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!signed ? (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-sky-600 text-white hover:bg-sky-500"
                      disabled={signBusy || !selectedNoteId}
                      onClick={() => void handleSign()}
                    >
                      Sign Note
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {amendmentBanner ? (
              <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950">
                Note reopened for amendment
              </div>
            ) : null}

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {/* Subjective */}
              <section className={cn("overflow-hidden rounded-xl", NESTED_SECTION_BG)}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setSubOpen((o) => !o)}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700">
                    Subjective · Patient complaints today
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", subOpen ? "rotate-180" : "")} />
                </button>
                {subOpen ? (
                  <div className="space-y-5 border-t border-slate-200 px-4 pb-4 pt-3">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Pain (0–10)</span>
                      <div className="mt-2 flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => bumpPain(-1)}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Minus className="h-5 w-5" />
                        </button>
                        <NumericLineInput
                          value={noteDraft.pain_score}
                          onChange={(v) =>
                            setNoteDraft((d) => ({
                              ...d,
                              pain_score: String(Math.min(10, Math.max(0, parseInt(v, 10) || 0))),
                            }))
                          }
                          className="w-16 text-center text-4xl font-bold tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() => bumpPain(1)}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      </div>
                      <div className="mt-3 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 transition-all"
                          style={{ width: `${Math.max(3, painN * 10)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {(
                        [
                          ["sleep_ok", "Sleep", noteDraft.sleep_ok],
                          ["bowel_ok", "Bowel", noteDraft.bowel_ok],
                          ["bladder_ok", "Bladder", noteDraft.bladder_ok],
                        ] as const
                      ).map(([key, label, val]) => (
                        <div key={key} className="flex flex-col gap-1.5">
                          <span className="text-[10px] text-slate-500">{label}</span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setNoteDraft((d) => ({ ...d, [key]: true }))}
                              className={cn(
                                "rounded-full px-3 py-1 text-[11px] font-medium",
                                val === true
                                  ? "bg-emerald-600 text-white"
                                  : "border border-slate-600 bg-transparent text-slate-400",
                              )}
                            >
                              ✓ Ok
                            </button>
                            <button
                              type="button"
                              onClick={() => setNoteDraft((d) => ({ ...d, [key]: false }))}
                              className={cn(
                                "rounded-full px-3 py-1 text-[11px] font-medium",
                                val === false
                                  ? "bg-rose-600/90 text-white"
                                  : "border border-slate-600 bg-transparent text-slate-400",
                              )}
                            >
                              ✗ Poor
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Appetite</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {APPETITE.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setNoteDraft((d) => ({ ...d, appetite: d.appetite === a ? "" : a }))}
                            className={cn(
                              "rounded-full px-4 py-1.5 text-xs font-medium transition",
                              noteDraft.appetite === a
                                ? "bg-emerald-600 text-white shadow"
                                : "border border-slate-300 text-slate-600 hover:border-slate-400",
                            )}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <IpdSubjectiveSnomedBlock
                        signed={soapTextLocked}
                        specialty={voiceSpecialty}
                        practitionerId={practitionerId}
                        indiaRefset={SNOMED_INDIA_IPD ?? null}
                        chips={subjectiveChips}
                        onSetChips={setSubjectiveChips}
                        complaintQuery={complaintQuery}
                        onComplaintQuery={setComplaintQuery}
                        freeText={subjectiveFreeText}
                        onFreeText={setSubjectiveFreeText}
                      />
                    </div>
                  </div>
                ) : null}
              </section>

              {/* Objective */}
              <section className={cn("overflow-hidden rounded-xl", NESTED_SECTION_BG)}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setObjOpen((o) => !o)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                      Objective · Vitals + Examination
                    </span>
                    {latestNursingVitalsAt &&
                    VITAL_FIELD_LIST.some((f) => vitalsFieldSource[f] === "nursing") ? (
                      <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[9px] font-semibold text-sky-800">
                        Auto-synced from nursing ·{" "}
                        {formatDistanceToNow(new Date(latestNursingVitalsAt), { addSuffix: true })}
                      </span>
                    ) : null}
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", objOpen ? "rotate-180" : "")} />
                </button>
                {objOpen ? (
                  <div className="space-y-5 border-t border-slate-200 px-4 pb-4 pt-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="border-b border-slate-200 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">BP</p>
                        <div className="mt-1 flex items-baseline gap-0.5">
                          <NumericLineInput
                            value={noteDraft.bp_systolic}
                            onChange={(v) => {
                              markVitalsDoctorField("bp_systolic");
                              setNoteDraft((d) => ({ ...d, bp_systolic: v.replace(/\D/g, "").slice(0, 3) }));
                            }}
                            className="w-12 text-xl font-bold"
                          />
                          <span className="text-lg font-bold text-slate-900">/</span>
                          <NumericLineInput
                            value={noteDraft.bp_diastolic}
                            onChange={(v) => {
                              markVitalsDoctorField("bp_diastolic");
                              setNoteDraft((d) => ({ ...d, bp_diastolic: v.replace(/\D/g, "").slice(0, 3) }));
                            }}
                            className="w-12 text-xl font-bold"
                          />
                        </div>
                        <p className="mt-0.5 text-[10px] text-slate-500">mmHg</p>
                        {vitalsFieldSource.bp_systolic === "nursing" || vitalsFieldSource.bp_diastolic === "nursing" ? (
                          <p className="mt-0.5 text-[9px] text-sky-800">
                            Auto-synced
                            {latestNursingVitalsAt
                              ? ` · ${formatDistanceToNow(new Date(latestNursingVitalsAt), { addSuffix: true })}`
                              : ""}
                          </p>
                        ) : vitalsFieldSource.bp_systolic === "doctor" && vitalsFieldSource.bp_diastolic === "doctor" ? (
                          <p className="mt-0.5 text-[9px] text-slate-500">Doctor-entered</p>
                        ) : vitalsFieldSource.bp_systolic === "doctor" || vitalsFieldSource.bp_diastolic === "doctor" ? (
                          <p className="mt-0.5 text-[9px] text-slate-500">Doctor-entered (partial)</p>
                        ) : null}
                      </div>
                      <div className="border-b border-slate-200 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">HR</p>
                        <NumericLineInput
                          value={noteDraft.heart_rate}
                          onChange={(v) => {
                            markVitalsDoctorField("heart_rate");
                            setNoteDraft((d) => ({ ...d, heart_rate: v.replace(/\D/g, "").slice(0, 3) }));
                          }}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">bpm</p>
                        {vitalsFieldSource.heart_rate === "nursing" ? (
                          <p className="mt-0.5 text-[9px] text-sky-800">
                            Auto-synced
                            {latestNursingVitalsAt
                              ? ` · ${formatDistanceToNow(new Date(latestNursingVitalsAt), { addSuffix: true })}`
                              : ""}
                          </p>
                        ) : vitalsFieldSource.heart_rate === "doctor" ? (
                          <p className="mt-0.5 text-[9px] text-slate-500">Doctor-entered</p>
                        ) : null}
                      </div>
                      <div className="border-b border-slate-200 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">SpO₂</p>
                        <NumericLineInput
                          value={noteDraft.spo2}
                          onChange={(v) => {
                            markVitalsDoctorField("spo2");
                            setNoteDraft((d) => ({ ...d, spo2: v.replace(/\D/g, "").slice(0, 3) }));
                          }}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">%</p>
                        {vitalsFieldSource.spo2 === "nursing" ? (
                          <p className="mt-0.5 text-[9px] text-sky-800">
                            Auto-synced
                            {latestNursingVitalsAt
                              ? ` · ${formatDistanceToNow(new Date(latestNursingVitalsAt), { addSuffix: true })}`
                              : ""}
                          </p>
                        ) : vitalsFieldSource.spo2 === "doctor" ? (
                          <p className="mt-0.5 text-[9px] text-slate-500">Doctor-entered</p>
                        ) : null}
                      </div>
                      <div className="border-b border-slate-200 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Temp</p>
                        <NumericLineInput
                          value={noteDraft.temperature_c}
                          onChange={(v) => {
                            markVitalsDoctorField("temperature_c");
                            setNoteDraft((d) => ({
                              ...d,
                              temperature_c: v.replace(/[^\d.]/g, "").slice(0, 5),
                            }));
                          }}
                          inputMode="decimal"
                          pattern="[0-9.]*"
                          className={cn(
                            "mt-1 block w-full text-2xl font-bold",
                            num(noteDraft.temperature_c) != null && num(noteDraft.temperature_c)! >= 38
                              ? "text-rose-600"
                              : "text-slate-900",
                          )}
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">°C</p>
                        {vitalsFieldSource.temperature_c === "nursing" ? (
                          <p className="mt-0.5 text-[9px] text-sky-800">
                            Auto-synced
                            {latestNursingVitalsAt
                              ? ` · ${formatDistanceToNow(new Date(latestNursingVitalsAt), { addSuffix: true })}`
                              : ""}
                          </p>
                        ) : vitalsFieldSource.temperature_c === "doctor" ? (
                          <p className="mt-0.5 text-[9px] text-slate-500">Doctor-entered</p>
                        ) : null}
                      </div>
                      <div className="border-b border-slate-200 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">RR</p>
                        <NumericLineInput
                          value={noteDraft.respiratory_rate}
                          onChange={(v) => {
                            markVitalsDoctorField("respiratory_rate");
                            setNoteDraft((d) => ({ ...d, respiratory_rate: v.replace(/\D/g, "").slice(0, 3) }));
                          }}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">/min</p>
                        {vitalsFieldSource.respiratory_rate === "nursing" ? (
                          <p className="mt-0.5 text-[9px] text-sky-800">
                            Auto-synced
                            {latestNursingVitalsAt
                              ? ` · ${formatDistanceToNow(new Date(latestNursingVitalsAt), { addSuffix: true })}`
                              : ""}
                          </p>
                        ) : vitalsFieldSource.respiratory_rate === "doctor" ? (
                          <p className="mt-0.5 text-[9px] text-slate-500">Doctor-entered</p>
                        ) : null}
                      </div>
                      <div className="border-b border-slate-200 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Pain</p>
                        <NumericLineInput
                          value={noteDraft.pain_score}
                          onChange={(v) => {
                            markVitalsDoctorField("pain_score");
                            setNoteDraft((d) => ({
                              ...d,
                              pain_score: String(
                                Math.min(10, Math.max(0, parseInt(v.replace(/\D/g, "").slice(0, 2) || "0", 10) || 0)),
                              ),
                            }));
                          }}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">/10 VAS</p>
                        {vitalsFieldSource.pain_score === "nursing" ? (
                          <p className="mt-0.5 text-[9px] text-sky-800">
                            Auto-synced
                            {latestNursingVitalsAt
                              ? ` · ${formatDistanceToNow(new Date(latestNursingVitalsAt), { addSuffix: true })}`
                              : ""}
                          </p>
                        ) : vitalsFieldSource.pain_score === "doctor" ? (
                          <p className="mt-0.5 text-[9px] text-slate-500">Doctor-entered</p>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        Today&apos;s condition
                      </span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {CONDITIONS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setNoteDraft((d) => ({ ...d, condition_status: c }))}
                            className={cn("rounded-full px-3 py-1.5 text-xs font-medium", conditionChipClass(c, noteDraft.condition_status === c))}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <IpdExaminationSnomedBlock
                        signed={soapTextLocked}
                        specialty={voiceSpecialty}
                        practitionerId={practitionerId}
                        indiaRefset={SNOMED_INDIA_IPD ?? null}
                        chips={examChips}
                        onSetChips={setExamChips}
                        examQuery={examQuery}
                        onExamQuery={setExamQuery}
                        freeText={objectiveFreeText}
                        onFreeText={setObjectiveFreeText}
                      />
                    </div>
                    <div className="rounded-lg bg-slate-100 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        Wound / Surgical Site
                      </p>
                      {isSurgicalCase && surgeryDone ? (
                        <div className="mt-3 space-y-3">
                          <div>
                            <p className="text-[10px] text-slate-500">Discharge</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {DISCHARGE_OPTS.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() =>
                                    setNoteDraft((d) => ({ ...d, wound: { ...d.wound, discharge: opt } }))
                                  }
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.discharge === opt
                                      ? "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600",
                                  )}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500">Sutures</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {SUTURE_OPTS.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => setNoteDraft((d) => ({ ...d, wound: { ...d.wound, sutures: opt } }))}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.sutures === opt
                                      ? "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600",
                                  )}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500">Swelling</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {SWELL_OPTS.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => setNoteDraft((d) => ({ ...d, wound: { ...d.wound, swelling: opt } }))}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.swelling === opt
                                      ? opt === "Mild"
                                        ? "bg-amber-500 text-white"
                                        : "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600",
                                  )}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500">Erythema</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ERYTHEMA_OPTS.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => setNoteDraft((d) => ({ ...d, wound: { ...d.wound, erythema: opt } }))}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.erythema === opt
                                      ? "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600",
                                  )}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : isSurgicalCase ? (
                        <p style={{ fontSize: 12, color: "#64748b", paddingTop: 8 }}>
                          Wound assessment will be available after surgery is performed.
                        </p>
                      ) : (
                        <p style={{ fontSize: 12, color: "#64748b", paddingTop: 8 }}>
                          Surgical site assessment not applicable for this admission.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>

              {/* Assessment & Plan */}
              <section className={cn("overflow-hidden rounded-xl", NESTED_SECTION_BG)}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setApOpen((o) => !o)}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                    Assessment &amp; Plan
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", apOpen ? "rotate-180" : "")} />
                </button>
                {apOpen ? (
                  <div className="space-y-5 border-t border-slate-200 px-4 pb-4 pt-3">
                    <div>
                      <IpdAssessmentSnomedBlock
                        signed={soapTextLocked}
                        specialty={voiceSpecialty}
                        practitionerId={practitionerId}
                        indiaRefset={SNOMED_INDIA_IPD ?? null}
                        entries={diagnosisEntries}
                        onSetEntries={setDiagnosisEntries}
                        diagnosisQuery={diagnosisQuery}
                        onDiagnosisQuery={setDiagnosisQuery}
                        freeText={assessmentFreeText}
                        onFreeText={setAssessmentFreeText}
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          Plan narrative
                        </span>
                        <div className={cn(soapTextLocked && "pointer-events-none opacity-50")}>
                          <VoiceDictationButton
                            contextType="ipd_progress_note"
                            ipdVoiceField="plan"
                            specialty={s(preAdmission?.specialty)}
                            doctorId={practitionerId ?? undefined}
                            indiaRefset={SNOMED_INDIA_IPD ?? undefined}
                            ipdVoiceBaseText={noteDraft.plan_narrative}
                            variant="slate"
                            onTranscriptUpdate={(text) => setNoteDraft((d) => ({ ...d, plan_narrative: text }))}
                            className="scale-90"
                          />
                        </div>
                      </div>
                      <Textarea
                        readOnly={soapTextLocked}
                        value={noteDraft.plan_narrative}
                        onChange={(e) => setNoteDraft((d) => ({ ...d, plan_narrative: e.target.value }))}
                        placeholder="Plan narrative / discharge planning notes…"
                        className={cn(
                          "min-h-[88px] resize-none border-0 border-b border-slate-200 bg-white px-0 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-0",
                          soapTextLocked && "cursor-default bg-slate-100 focus-visible:ring-0",
                        )}
                      />
                    </div>

                    {/* Investigations */}
                    <div className="rounded-lg bg-slate-100 p-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setInvOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800">
                          Investigations · Orders &amp; results
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddOrderOpen((o) => {
                                const next = !o;
                                if (next) {
                                  setInvSearchQuery("");
                                  setInvResults([]);
                                }
                                return next;
                              });
                            }}
                            onKeyDown={(e) =>
                              e.key === "Enter" &&
                              setAddOrderOpen((o) => {
                                const next = !o;
                                if (next) {
                                  setInvSearchQuery("");
                                  setInvResults([]);
                                }
                                return next;
                              })
                            }
                            className="rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-sky-500"
                          >
                            + Order
                          </span>
                          <ChevronDown className={cn("h-4 w-4 text-slate-500", invOpen ? "rotate-180" : "")} />
                        </div>
                      </button>
                      {invOpen ? (
                        <div className="mt-3 space-y-2">
                          {addOrderOpen ? (
                            <div ref={invDropdownRef} className="relative rounded-lg border border-slate-200 p-2">
                              <input
                                type="text"
                                placeholder="Search investigations (e.g. CBC, X-ray knee, HbA1c)..."
                                value={invSearchQuery}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setInvSearchQuery(v);
                                  if (invSearchTimerRef.current) clearTimeout(invSearchTimerRef.current);
                                  invSearchTimerRef.current = setTimeout(() => {
                                    void searchInvestigations(v);
                                  }, 250);
                                }}
                                className="w-full border-0 border-b border-slate-300 bg-transparent py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-50"
                              />
                              {invResults.length > 0 ? (
                                <div className="absolute left-0 right-0 z-50 mt-1 max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                  {invResults.map((inv) => (
                                    <div
                                      key={inv.id}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          void openOrderInvestigationModal(inv);
                                        }
                                      }}
                                      onClick={() => {
                                        void openOrderInvestigationModal(inv);
                                      }}
                                      className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-100"
                                    >
                                      <span className="min-w-0 flex-1 text-[13px] text-slate-900">
                                        <span className="block">{inv.test_name}</span>
                                        {s(inv.short_code) ? (
                                          <span className="block text-[11px] text-slate-500">
                                            {s(inv.short_code)}
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                                        {s(inv.category) || "—"}
                                      </span>
                                      <span className="max-w-[100px] truncate text-right text-[10px] text-slate-500" title={s(inv.snomed_display)}>
                                        {s(inv.snomed_display) || "—"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {investigations.length === 0 ? (
                            <p className="py-2 text-center text-xs text-slate-500">No investigations ordered today</p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow className="border-slate-200 hover:bg-transparent">
                                  <TableHead className="text-[10px] uppercase text-slate-500">Test</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Ordered</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Result</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {investigations.map((inv) => {
                                  const st = s(inv.status ?? inv.order_status);
                                  const bill = invBillingBadge(inv.billing_status as string | undefined);
                                  const pill = bill ?? invStatusBadge(st);
                                  const showBillNote =
                                    bill && s(inv.billing_status).toLowerCase() === "pending_payment";
                                  const res = [s(inv.result_value), s(inv.result_unit)].filter(Boolean).join(" ");
                                  const crit = Boolean(inv.is_critical);
                                  return (
                                    <TableRow
                                      key={s(inv.id)}
                                      className={cn(
                                        "border-slate-200",
                                        crit ? "border-l-4 border-l-red-500 bg-red-50" : "",
                                      )}
                                    >
                                      <TableCell className="font-medium text-slate-900">
                                        {s(inv.test_name ?? inv.name)}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-600">
                                        {fmtDayShort(s(inv.ordered_at ?? inv.created_at))}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-700">{res || "—"}</TableCell>
                                      <TableCell>
                                        <div className="flex flex-col gap-1">
                                          <span className={cn("w-fit rounded-full border px-2 py-0.5 text-[10px]", pill.cls)}>
                                            {pill.label}
                                          </span>
                                          {showBillNote ? (
                                            <span className="text-[9px] text-slate-500">Payment pending at reception</span>
                                          ) : null}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {/* Plan / Medications */}
                    <div className="rounded-lg bg-slate-100 p-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setPlanOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800">Plan · Medications &amp; orders</span>
                        <div className="flex items-center gap-2">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddMedOpen((o) => {
                                const next = !o;
                                if (next) {
                                  setDrugQuery("");
                                  setDrugResults([]);
                                  setNewMed({
                                    name: "",
                                    dose: "",
                                    route: "IV",
                                    frequency: "BD",
                                    kind: "medical",
                                    durationDays: "",
                                    selectedDrugId: null,
                                  });
                                }
                                return next;
                              });
                            }}
                            className="rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-violet-500"
                          >
                            + Add medication
                          </span>
                          <ChevronDown className={cn("h-4 w-4 text-slate-500", planOpen ? "rotate-180" : "")} />
                        </div>
                      </button>
                      {planOpen ? (
                        <div className="mt-3 space-y-2">
                          {addMedOpen ? (
                            <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-6">
                              <div ref={drugDropdownRef} className="relative min-w-0 sm:col-span-2 lg:col-span-2">
                                <input
                                  type="text"
                                  placeholder="Drug name or generic..."
                                  value={drugQuery}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setDrugQuery(v);
                                    setNewMed((m) => ({ ...m, name: v }));
                                    if (drugSearchTimerRef.current) clearTimeout(drugSearchTimerRef.current);
                                    drugSearchTimerRef.current = setTimeout(() => {
                                      void searchDrugs(v);
                                    }, 250);
                                  }}
                                  className="w-full border-0 border-b border-slate-300 bg-transparent py-1 text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
                                />
                                {newMed.selectedDrugId ? (
                                  <p className="mt-1 text-[10px] text-slate-500">Linked to pharmacy catalogue</p>
                                ) : null}
                                {drugResults.length > 0 ? (
                                  <div className="absolute left-0 right-0 z-50 mt-1 max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                    {drugResults.map((drug) => {
                                      const brand = s(drug.brand_name);
                                      const generic = s(drug.generic_name);
                                      const primary =
                                        brand && generic
                                          ? `${brand} (${generic})`
                                          : brand || generic || "—";
                                      const strength = s(drug.strength);
                                      const form = s(drug.dosage_form);
                                      const secondaryLeft = [strength, form].filter(Boolean).join(" · ");
                                      const mrpNum = parseDrugMrpPositive(drug.mrp);
                                      const priceRight = mrpNum != null ? `₹${mrpNum}` : null;
                                      return (
                                        <div
                                          key={drug.id}
                                          role="button"
                                          tabIndex={0}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                              e.preventDefault();
                                              const nm = s(drug.generic_name) || s(drug.brand_name);
                                              setNewMed((m) => ({
                                                ...m,
                                                name: nm,
                                                dose: s(drug.strength) || "",
                                                selectedDrugId: s(drug.id),
                                              }));
                                              setDrugQuery(nm);
                                              setDrugResults([]);
                                            }
                                          }}
                                          onClick={() => {
                                            const nm = s(drug.generic_name) || s(drug.brand_name);
                                            setNewMed((m) => ({
                                              ...m,
                                              name: nm,
                                              dose: s(drug.strength) || "",
                                              selectedDrugId: s(drug.id),
                                            }));
                                            setDrugQuery(nm);
                                            setDrugResults([]);
                                          }}
                                          className="cursor-pointer border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-100"
                                        >
                                          <span className="block text-[13px] font-medium text-slate-900">
                                            {primary}
                                          </span>
                                          <div className="mt-0.5 flex items-start justify-between gap-2 text-[11px]">
                                            <span className="min-w-0 text-slate-500">{secondaryLeft}</span>
                                            {priceRight ? (
                                              <span className="shrink-0 text-right text-gray-400">{priceRight}</span>
                                            ) : null}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                              <input
                                type="text"
                                placeholder="Dose"
                                value={newMed.dose}
                                onChange={(e) => setNewMed((m) => ({ ...m, dose: e.target.value }))}
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300"
                              />
                              <select
                                value={newMed.route}
                                onChange={(e) => setNewMed((m) => ({ ...m, route: e.target.value }))}
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300"
                              >
                                {["IV", "PO", "SC", "IM", "Topical"].map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={newMed.frequency}
                                onChange={(e) => setNewMed((m) => ({ ...m, frequency: e.target.value }))}
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300"
                              >
                                {["OD", "BD", "TID", "QID", "SOS", "PRN"].map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="Days"
                                value={newMed.durationDays}
                                onChange={(e) =>
                                  setNewMed((m) => ({ ...m, durationDays: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                                }
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300"
                              />
                              <select
                                value={newMed.kind}
                                onChange={(e) => setNewMed((m) => ({ ...m, kind: e.target.value }))}
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300"
                              >
                                {[
                                  ["medical", "Med"],
                                  ["physio", "Physio"],
                                  ["diet", "Diet"],
                                  ["procedure", "Procedure"],
                                  ["vte", "VTE"],
                                ].map(([v, lab]) => (
                                  <option key={v} value={v}>
                                    {lab}
                                  </option>
                                ))}
                              </select>
                              <Button
                                type="button"
                                size="sm"
                                className="bg-violet-600 lg:col-span-1"
                                onClick={() => void handleSaveTreatment()}
                              >
                                Save
                              </Button>
                            </div>
                          ) : null}
                          {treatments.length === 0 ? (
                            <p className="py-2 text-center text-xs text-slate-500">No treatments for this day</p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow className="border-slate-200 hover:bg-transparent">
                                  <TableHead className="text-[10px] uppercase text-slate-500">Kind</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Name / dose</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Route · freq</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Duration</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {treatments.map((tx) => {
                                  const k = treatmentKindBadge(s(tx.treatment_kind ?? tx.kind));
                                  return (
                                    <TableRow key={s(tx.id)} className="border-slate-200">
                                      <TableCell>
                                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", k.cls)}>
                                          {k.label}
                                        </span>
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-800">
                                        {s(tx.name)} {tx.dose ? <span className="text-slate-500">· {s(tx.dose)}</span> : null}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-600">
                                        {s(tx.route)} · {s(tx.frequency)}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-600">{s(tx.duration_days ?? tx.days) || "—"}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          )}
                          <button
                            type="button"
                            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-800"
                            onClick={() => {
                              setDrugQuery("");
                              setDrugResults([]);
                              setNewMed({
                                name: "",
                                dose: "",
                                route: "IV",
                                frequency: "BD",
                                kind: "medical",
                                durationDays: "",
                                selectedDrugId: null,
                              });
                              setAddMedOpen(true);
                            }}
                          >
                            + Add treatment / procedure / diet order
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {/* NABH */}
                    <div className="rounded-lg bg-slate-100 p-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setNabhOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800">Nursing orders &amp; NABH checklist</span>
                        <ChevronDown className={cn("h-4 w-4 text-slate-500", nabhOpen ? "rotate-180" : "")} />
                      </button>
                      {nabhOpen ? (
                        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Mandatory daily checks</p>
                            <div className="mt-2 space-y-2">
                              {(
                                [
                                  ["vte", "VTE prophylaxis given", nabhDraft.vte],
                                  ["fall", "Fall risk reassessed", nabhDraft.fall],
                                  ["pressure", "Pressure sore check", nabhDraft.pressure],
                                  ["consent", "Consent valid", nabhDraft.consent],
                                ] as const
                              ).map(([key, label, val]) => (
                                <label key={key} className="flex cursor-pointer items-center justify-between gap-2">
                                  <span className="text-xs text-slate-700">{label}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setNabhDraft((d) => ({
                                        ...d,
                                        [key]: val === true ? false : true,
                                      }))
                                    }
                                    className={cn(
                                      "flex h-7 w-7 items-center justify-center rounded-md border text-xs font-bold",
                                      val === true
                                        ? "border-emerald-500 bg-emerald-600 text-white"
                                        : "border-slate-300 bg-slate-100 text-slate-500",
                                    )}
                                  >
                                    {val === true ? "✓" : ""}
                                  </button>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Diet &amp; activity</p>
                            <div>
                              <p className="text-[10px] text-slate-500">Diet</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {DIET_TAGS.map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => setNabhDraft((d) => ({ ...d, diet: t }))}
                                    className={cn(
                                      "rounded-full px-2.5 py-1 text-[11px]",
                                      nabhDraft.diet === t
                                        ? "bg-emerald-100 text-emerald-900"
                                        : "border border-slate-300 text-slate-600",
                                    )}
                                  >
                                    {t}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500">Activity</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {ACTIVITY_TAGS.map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => setNabhDraft((d) => ({ ...d, activity: t }))}
                                    className={cn(
                                      "rounded-full px-2.5 py-1 text-[11px]",
                                      nabhDraft.activity === t
                                        ? "bg-sky-100 text-sky-900"
                                        : "border border-slate-300 text-slate-600",
                                    )}
                                  >
                                    {t}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500">IV access site</p>
                              <input
                                type="text"
                                value={nabhDraft.ivSite}
                                onChange={(e) => setNabhDraft((d) => ({ ...d, ivSite: e.target.value }))}
                                className="mt-1 w-full border-0 border-b border-slate-300 bg-transparent py-1 text-sm text-slate-900 outline-none"
                              />
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500">Consult (comma-separated)</p>
                              <input
                                type="text"
                                value={nabhDraft.consultText}
                                onChange={(e) => setNabhDraft((d) => ({ ...d, consultText: e.target.value }))}
                                className="mt-1 w-full border-0 border-b border-slate-300 bg-transparent py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                                placeholder="Physio, Anaesthesia…"
                              />
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* I/O */}
                    <div className="rounded-lg bg-slate-100 p-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setIoOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800">Drain / I&amp;O (24h)</span>
                        <ChevronDown className={cn("h-4 w-4 text-slate-500", ioOpen ? "rotate-180" : "")} />
                      </button>
                      {ioOpen ? (
                        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-3 text-sm">
                            <div className="flex justify-between border-b border-slate-200 pb-1">
                              <span className="text-slate-500">Drain output</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900">
                                <NumericLineInput
                                  value={ioDraft.drain}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, drain: v.replace(/\D/g, "") }))}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-200 pb-1">
                              <span className="text-slate-500">Urine out</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900">
                                <NumericLineInput
                                  value={ioDraft.urine}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, urine: v.replace(/\D/g, "") }))}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                          </div>
                          <div className="space-y-3 text-sm">
                            <div className="flex justify-between border-b border-slate-200 pb-1">
                              <span className="text-slate-500">IV fluids in</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900">
                                <NumericLineInput
                                  value={ioDraft.iv}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, iv: v.replace(/\D/g, "") }))}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-200 pb-1">
                              <span className="text-slate-500">Oral intake</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900">
                                <NumericLineInput
                                  value={ioDraft.oral}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, oral: v.replace(/\D/g, "") }))}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                            <div className="flex justify-between pt-1">
                              <span className="font-semibold text-slate-600">Balance</span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-sm font-bold",
                                  ioBalance >= 0
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-rose-100 text-rose-800",
                                )}
                              >
                                {ioBalance} ml
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        )}
      </main>

      {/* Right */}
      <aside className={cn("flex min-h-0 flex-col overflow-y-auto rounded-xl", PANEL_RIGHT)}>
        <div className="border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
          Context
        </div>
        <div className="flex min-h-0 flex-1 flex-col space-y-4 p-3 text-xs">
          <div>
            <p className="font-bold text-slate-900">Admission summary</p>
            <dl className="mt-2 space-y-1.5 text-slate-600">
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Diagnosis</dt>
                <dd className="text-slate-800">
                  <DiagnosisWithIcd text={diagnosis} icd10={diagnosisIcd10} />
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Admitted</dt>
                <dd className="text-slate-800">{admittedFmt}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold tracking-wide text-slate-500">SURGERY DATE</dt>
                <dd className="text-slate-800">{surgeryDisplay}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Surgeon</dt>
                <dd className="text-slate-800">{surgeonName || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Est. discharge</dt>
                <dd className="text-slate-800">{estDischarge}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Insurance / TPA</dt>
                <dd className="text-slate-800">{coverageLabel}</dd>
              </div>
            </dl>
          </div>

          <div>
            <p className="font-bold text-slate-900">Alerts</p>
            <div className="mt-2 space-y-2">
              {allergyText ? (
                <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-2.5">
                  <p className="text-[11px] font-semibold text-red-200">⚠ Allergy</p>
                  <p className="mt-1 text-[11px] leading-snug text-red-100/90">{allergyText}</p>
                </div>
              ) : null}
              {criticalAlerts.map((inv) => {
                const nid = s(inv.progress_note_id);
                const dayN = dayNumForNote(progressNotes, nid);
                const tname = s(inv.test_name ?? inv.name);
                const rval = [s(inv.result_value), s(inv.result_unit)].filter(Boolean).join(" ");
                const tm = fmtTimeShort(s(inv.ordered_at ?? inv.created_at ?? ""));
                return (
                  <div key={s(inv.id)} className="rounded-xl border border-red-500/40 bg-red-950/30 p-2.5">
                    <p className="text-[11px] font-semibold text-red-200">{tname} critical ↑</p>
                    <p className="mt-1 text-[10px] text-red-100/80">
                      {rval || "—"} · Day {dayN || "—"} · {tm}
                    </p>
                  </div>
                );
              })}
              {conditionFlag ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-2.5">
                  <p className="text-[11px] font-semibold text-amber-200">Condition flagged</p>
                  <p className="mt-1 text-[10px] text-amber-100/90">Review patient immediately</p>
                </div>
              ) : null}
              {!allergyText && criticalAlerts.length === 0 && !conditionFlag ? (
                <p className="text-slate-500">No active alerts</p>
              ) : null}
            </div>
          </div>

          <div>
            <p className="font-bold text-slate-900">Pending results</p>
            {pendingResults.length === 0 ? (
              <p className="mt-1 text-slate-500">None</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {pendingResults.map((p) => {
                  const st = s(p.status);
                  const pill = invStatusBadge(st);
                  return (
                    <li key={s(p.id)} className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                      <span className="truncate">{s(p.test_name ?? p.name)}</span>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px]", pill.cls)}>{pill.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <p className="font-bold text-slate-900">Today&apos;s condition trend</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {progressNotes.map((pn) => {
                const r = pn as Record<string, unknown>;
                const dn = Math.max(1, num(r.hospital_day_number) ?? 0);
                const cs = s(r.condition_status);
                return (
                  <span
                    key={s(r.id)}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      trendChipClass(cs),
                    )}
                  >
                    D{dn}
                    <span className="opacity-90">{shortConditionLabel(cs)}</span>
                  </span>
                );
              })}
            </div>
          </div>

          <div>
            <p className="font-bold text-slate-900">Consultants on case</p>
            {loadingAdmissionConsults ? (
              <p className="mt-2 text-slate-500">Loading…</p>
            ) : admissionConsults.length === 0 ? (
              <p className="mt-2 text-slate-500">No consult requests yet</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {admissionConsults.map((c) => {
                  const cid = s(c.id ?? c.consult_id);
                  const docName =
                    s(c.consulting_doctor_name) ||
                    s(c.doctor_name) ||
                    s(asRec(c.consulting_doctor)?.full_name);
                  const spec = s(c.consulting_specialty) || s(c.specialty);
                  const dept = s(c.department_name) || s(asRec(c.department)?.name);
                  const header =
                    docName && spec ? `${docName} · ${spec}` : docName || (dept ? `Dept: ${dept}` : "Consult");
                  const st = s(c.status).toLowerCase();
                  const urgency = s(c.urgency).toLowerCase();
                  const reason = s(c.reason_for_consult) || s(c.reason);
                  const notes = s(c.consult_notes);
                  const reqAt = s(c.requested_at ?? c.created_at);
                  const statusCls =
                    st === "responded"
                      ? "border-emerald-500/40 bg-emerald-50 text-emerald-900"
                      : st === "accepted"
                        ? "border-sky-500/40 bg-sky-50 text-sky-900"
                        : "border-amber-500/40 bg-amber-50 text-amber-900";
                  const statusLabel = st ? st.charAt(0).toUpperCase() + st.slice(1) : "—";
                  return (
                    <li
                      key={cid || reason + reqAt}
                      className="rounded-xl border border-slate-200 bg-white p-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-1">
                        <p className="text-[11px] font-semibold leading-snug text-slate-900">{header}</p>
                        <div className="flex flex-wrap gap-1">
                          <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase", statusCls)}>
                            {statusLabel}
                          </span>
                          {urgency === "stat" ? (
                            <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white">STAT</span>
                          ) : urgency === "urgent" ? (
                            <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white">Urgent</span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-600">{reason || "—"}</p>
                      <p className="mt-1 text-[9px] text-slate-400">{formatRequestedAgo(reqAt)}</p>
                      {st === "responded" && notes ? (
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          <button
                            type="button"
                            className="text-[10px] font-semibold text-sky-600"
                            onClick={() => setExpandedConsultId((x) => (x === cid ? null : cid))}
                          >
                            {expandedConsultId === cid ? "Hide response" : "View response"}
                          </button>
                          {expandedConsultId === cid ? (
                            <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-slate-700">
                              {notes}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-auto border-t border-slate-200 pt-4">
            {!signed ? (
              <>
                <p className="text-[11px] text-slate-500">Note unsigned · locks in 8h</p>
                <Button
                  type="button"
                  className="mt-2 w-full bg-sky-600 py-5 text-sm font-semibold text-white hover:bg-sky-500"
                  disabled={signBusy || !selectedNoteId}
                  onClick={() => void handleSign()}
                >
                  e-Sign &amp; lock Day {Math.max(1, num(noteRow?.hospital_day_number) ?? 0)} note
                </Button>
              </>
            ) : (
              <p className="rounded-lg bg-emerald-100 px-3 py-2 text-center text-sm font-semibold text-emerald-900">
                Signed ✓ {signedAtDisplay}
              </p>
            )}
          </div>
        </div>
      </aside>

      <OrderInvestigationModal
        open={Boolean(pendingInvTest)}
        test={pendingInvTest}
        coverageId={admission?.coverage_id != null && String(admission.coverage_id).trim() !== "" ? String(admission.coverage_id) : null}
        coverageLabel={coverageLabel}
        onCancel={() => setPendingInvTest(null)}
        onConfirm={(p) => void confirmPlaceInvestigationOrder(p)}
        busy={orderInvBusy}
      />
    </div>
  );
}
