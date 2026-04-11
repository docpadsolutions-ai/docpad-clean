"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Minus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../../../lib/supabase";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { cn } from "../../../../lib/utils";
import { formatClinicalDate, patientFromAdmission, preAdmissionFrom } from "../../../lib/ipdAdmissionDisplay";
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

/** Light: match OPD encounter (`bg-slate-50`). Dark: unchanged slate shell. */
const PAGE_BG = "bg-slate-50 dark:bg-[#0f172a]";
/** Column / main shell — must be theme-aware (was hardcoded dark only). */
const CARD_BG =
  "border border-slate-200 bg-white shadow-sm dark:border-transparent dark:bg-[#1e293b] dark:shadow-none";
/** Nested SOAP blocks — slight contrast on light */
const NESTED_SECTION_BG =
  "border border-slate-200 bg-slate-50 shadow-sm dark:border-transparent dark:bg-[#1e293b] dark:shadow-none";

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

type InvPriceMaster = {
  id: string;
  test_name: string;
  test_category: string | null;
  loinc_code: string | null;
  final_price: number | string | null;
};

type DrugMasterRow = {
  id: string;
  generic_name: string | null;
  brand_name: string | null;
  dosage_form: string | null;
  strength: string | null;
  mrp: number | string | null;
};

function sanitizeIlike(q: string): string {
  return q.trim().replace(/[%_]/g, "").slice(0, 120);
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
    return "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-500/40 dark:bg-transparent dark:text-slate-300 dark:hover:border-slate-400";
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
    return "border border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-200";
  if (t.includes("stable"))
    return "border border-sky-500/40 bg-sky-50 text-sky-900 dark:bg-sky-500/25 dark:text-sky-200";
  if (t.includes("plateau"))
    return "border border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200";
  if (t.includes("deteriorat"))
    return "border border-orange-500/40 bg-orange-50 text-orange-900 dark:bg-orange-500/25 dark:text-orange-200";
  if (t.includes("critical"))
    return "border border-red-500/40 bg-red-50 text-red-900 dark:bg-red-500/25 dark:text-red-200";
  return "border border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-600/40 dark:text-slate-300 dark:border-slate-500/30";
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
  if (t.includes("report"))
    return { label: "Reported", cls: "border border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/25 dark:text-blue-200" };
  if (t.includes("pend"))
    return { label: "Pending", cls: "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/25 dark:text-amber-200" };
  if (t.includes("crit"))
    return { label: "Critical", cls: "border border-red-200 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/25 dark:text-red-200" };
  return { label: "Ordered", cls: "border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-500/40 dark:bg-slate-600/50 dark:text-slate-200" };
}

function treatmentKindBadge(kind: string): { label: string; cls: string } {
  const t = kind.toLowerCase();
  if (t.includes("physio"))
    return { label: "Physio", cls: "border border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/25 dark:text-violet-200" };
  if (t.includes("vte"))
    return { label: "VTE", cls: "border border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/40 dark:bg-orange-500/25 dark:text-orange-200" };
  if (t.includes("diet"))
    return { label: "Diet", cls: "border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/25 dark:text-emerald-200" };
  if (t.includes("proced"))
    return { label: "Proc", cls: "border border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-500/40 dark:bg-slate-500/40 dark:text-slate-200" };
  return { label: "Med", cls: "border border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/25 dark:text-blue-200" };
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
        "min-w-0 border-0 bg-transparent p-0 font-bold text-slate-900 outline-none ring-0 focus:ring-0 dark:text-white",
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

function getProgressNotes(data: Record<string, unknown> | null): Record<string, unknown>[] {
  const raw = data?.progress_notes;
  if (!Array.isArray(raw)) return [];
  return [...raw].sort((a, b) => {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const da = num(ra.hospital_day_number) ?? 0;
    const db = num(rb.hospital_day_number) ?? 0;
    if (da !== db) return da - db;
    return s(ra.note_date).localeCompare(s(rb.note_date));
  });
}

export default function IpdDailyNotesWorkspace({
  admissionId,
  hospitalId,
  admissionData,
  onRefetchAdmission,
}: IpdDailyNotesWorkspaceProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteRow, setNoteRow] = useState<Record<string, unknown> | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft>(emptyDraft);
  const [loadingNote, setLoadingNote] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [addDayBusy, setAddDayBusy] = useState(false);
  const [signBusy, setSignBusy] = useState(false);

  const [subjectiveChips, setSubjectiveChips] = useState<ClinicalChip[]>([]);
  const [subjectiveFreeText, setSubjectiveFreeText] = useState("");
  const [complaintQuery, setComplaintQuery] = useState("");
  const [examChips, setExamChips] = useState<ClinicalChip[]>([]);
  const [objectiveFreeText, setObjectiveFreeText] = useState("");
  const [examQuery, setExamQuery] = useState("");
  const [diagnosisEntries, setDiagnosisEntries] = useState<IpdDiagnosisEntry[]>([]);
  const [assessmentFreeText, setAssessmentFreeText] = useState("");
  const [diagnosisQuery, setDiagnosisQuery] = useState("");

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

  const patientId = s(asRec(admissionData?.admission)?.patient_id);

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
  const [invResults, setInvResults] = useState<InvPriceMaster[]>([]);
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
  const debouncedIo = useDebouncedValue(ioDraft, 800);
  const debouncedNabh = useDebouncedValue(nabhDraft, 800);

  const [subOpen, setSubOpen] = useState(true);
  const [objOpen, setObjOpen] = useState(true);
  const [apOpen, setApOpen] = useState(true);
  const [invOpen, setInvOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(true);
  const [nabhOpen, setNabhOpen] = useState(true);
  const [ioOpen, setIoOpen] = useState(true);

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
    const firstId = s((progressNotes[0] as Record<string, unknown>).id);
    setSelectedNoteId((prev) => {
      if (prev && progressNotes.some((n) => s((n as Record<string, unknown>).id) === prev)) return prev;
      return firstId || null;
    });
  }, [progressNotes]);

  const loadNote = useCallback(async (noteId: string) => {
    setLoadingNote(true);
    skipNextDebouncedSave.current = true;
    const { data, error } = await supabase.from("ipd_progress_notes").select("*").eq("id", noteId).maybeSingle();
    setLoadingNote(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data && typeof data === "object") {
      const row = data as Record<string, unknown>;
      setNoteRow(row);
      setNoteDraft(rowToDraft(row));
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
  }, []);

  useEffect(() => {
    if (!selectedNoteId) {
      setNoteRow(null);
      setNoteDraft(emptyDraft());
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

  const signed = s(noteRow?.status).toLowerCase() === "signed";

  useEffect(() => {
    if (!selectedNoteId || signed) return;
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
  }, [debouncedFingerprint, selectedNoteId, signed]);

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
    if (!selectedNoteId || signed || !noteRow || !patientId) return;
    if (skipIoSave.current) {
      skipIoSave.current = false;
      return;
    }
    const nd = s(noteRow.note_date).slice(0, 10);
    if (!nd) return;
    void (async () => {
      const drain = parseFloat(debouncedIo.drain) || 0;
      const urine = parseFloat(debouncedIo.urine) || 0;
      const iv = parseFloat(debouncedIo.iv) || 0;
      const oral = parseFloat(debouncedIo.oral) || 0;
      const row: Record<string, unknown> = {
        hospital_id: hospitalId,
        admission_id: admissionId,
        progress_note_id: selectedNoteId,
        patient_id: patientId,
        record_date: nd,
        drain_output_ml: drain,
        urine_output_ml: urine,
        iv_fluid_ml: iv,
        oral_intake_ml: oral,
        updated_at: new Date().toISOString(),
      };
      if (ioRow?.id) row.id = ioRow.id;
      const { error } = await supabase.from("ipd_io_records").upsert(row, { onConflict: "admission_id,record_date" });
      if (error) toast.error(error.message);
    })();
  }, [debouncedIoFp, selectedNoteId, signed, noteRow, patientId, hospitalId, admissionId, ioRow?.id]);

  useEffect(() => {
    if (!selectedNoteId || signed || !noteRow || !currentUserId || !patientId) return;
    if (skipNabhSave.current) {
      skipNabhSave.current = false;
      return;
    }
    const nd = s(noteRow.note_date).slice(0, 10);
    if (!nd) return;
    void (async () => {
      let consultJson: unknown = debouncedNabh.consultText.trim()
        ? debouncedNabh.consultText
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
      const row: Record<string, unknown> = {
        hospital_id: hospitalId,
        admission_id: admissionId,
        progress_note_id: selectedNoteId,
        patient_id: patientId,
        checklist_date: nd,
        completed_by: currentUserId,
        vte_prophylaxis_given: debouncedNabh.vte,
        fall_risk_assessed: debouncedNabh.fall,
        pressure_sore_checked: debouncedNabh.pressure,
        consent_valid: debouncedNabh.consent,
        diet_order: debouncedNabh.diet,
        activity_order: debouncedNabh.activity,
        iv_access_site: debouncedNabh.ivSite || null,
        consults_requested: consultJson,
        updated_at: new Date().toISOString(),
      };
      if (nabhRow?.id) row.id = nabhRow.id;
      const { error } = await supabase.from("ipd_nabh_checklist").upsert(row, { onConflict: "progress_note_id" });
      if (error) toast.error(error.message);
    })();
  }, [
    debouncedNabhFp,
    selectedNoteId,
    signed,
    noteRow,
    currentUserId,
    patientId,
    hospitalId,
    admissionId,
    nabhRow?.id,
  ]);

  const handleAddDay = async () => {
    if (!currentUserId) {
      toast.error("Not signed in.");
      return;
    }
    setAddDayBusy(true);
    const { data: rpcData, error } = await supabase.rpc("get_or_create_progress_note", {
      p_admission_id: admissionId,
      p_hospital_id: hospitalId,
      p_authored_by: currentUserId,
    });
    setAddDayBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    let newNoteId: string | null = null;
    if (typeof rpcData === "string" && rpcData.trim()) newNoteId = rpcData.trim();
    else if (rpcData && typeof rpcData === "object" && !Array.isArray(rpcData) && "id" in rpcData) {
      newNoteId = s((rpcData as Record<string, unknown>).id);
    }
    await onRefetchAdmission();
    if (newNoteId) setSelectedNoteId(newNoteId);
  };

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
    await loadNote(selectedNoteId);
    await onRefetchAdmission();
  };

  const diagnosis =
    s(admission?.primary_diagnosis_display) || s(preAdmission?.primary_diagnosis_display) || "—";
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

  const consultList = (() => {
    const raw = nabhRow?.consults_requested;
    if (Array.isArray(raw)) return raw.map((x) => s(x)).filter(Boolean);
    if (typeof raw === "string" && raw.trim()) {
      try {
        const j = JSON.parse(raw) as unknown;
        if (Array.isArray(j)) return j.map((x) => s(x)).filter(Boolean);
      } catch {
        return raw.split(",").map((x) => x.trim()).filter(Boolean);
      }
    }
    return [];
  })();

  const ioBalance =
    (parseFloat(ioDraft.iv) || 0) +
    (parseFloat(ioDraft.oral) || 0) -
    ((parseFloat(ioDraft.drain) || 0) + (parseFloat(ioDraft.urine) || 0));

  const bumpPain = (d: number) => {
    if (signed) return;
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
      const q = sanitizeIlike(query);
      if (q.length < 2) {
        setInvResults([]);
        return;
      }
      const { data, error } = await supabase
        .from("investigation_price_master")
        .select("id, test_name, test_category, loinc_code, final_price")
        .eq("hospital_id", hospitalId)
        .ilike("test_name", `%${q}%`)
        .limit(10);
      if (error) {
        toast.error(error.message);
        setInvResults([]);
        return;
      }
      setInvResults((data ?? []) as InvPriceMaster[]);
    },
    [hospitalId],
  );

  const orderInvestigation = async (test: InvPriceMaster) => {
    if (!selectedNoteId || !patientId) {
      toast.error("Select a note first.");
      return;
    }
    const { error } = await supabase.rpc("order_dpn_investigation", {
      p_admission_id: admissionId,
      p_hospital_id: hospitalId,
      p_patient_id: patientId,
      p_note_id: selectedNoteId,
      p_test_name: test.test_name,
      p_test_category: s(test.test_category) || "General",
      p_priority: "routine",
      p_loinc_code: test.loinc_code ?? "",
      p_ordered_by: currentUserId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
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
        .eq("hospital_id", hospitalId)
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
    [hospitalId],
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
      hospital_id: hospitalId,
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
      <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl", CARD_BG)}>
        <div className="border-b border-slate-200 dark:border-slate-700/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Admission timeline
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {progressNotes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-600">
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
                  onClick={() => setSelectedNoteId(id)}
                  className={cn(
                    "relative w-full overflow-hidden rounded-xl p-2.5 text-left text-xs shadow-sm transition",
                    active
                      ? "border-l-[3px] border-l-sky-500 bg-sky-50 dark:bg-slate-700/90"
                      : "border-l-[3px] border-l-transparent bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800",
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
                    {surgeryDay ? (
                      <span title="Surgery day" className="text-orange-400" aria-hidden>
                        <Sparkles className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">{fmtDayShort(nd)}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-400">{docName || "—"}</p>
                  {tags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {tags.map((t, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-[10px] text-orange-800 dark:text-orange-200"
                        >
                          {s(t)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {(txC > 0 || invC > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {txC > 0 ? (
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] text-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                          {txC} Rx
                        </span>
                      ) : null}
                      {invC > 0 ? (
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] text-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                          {invC} order{invC !== 1 ? "s" : ""}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {cond ? (
                    <div className={cn("mt-2 h-1 w-full rounded-full", timelineConditionBarClass(cond))} title={cond} />
                  ) : (
                    <div className="mt-2 h-1 w-full rounded-full bg-slate-300 dark:bg-slate-600/50" />
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-slate-200 dark:border-slate-700/80 p-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-transparent dark:text-slate-200 dark:hover:bg-slate-700/50"
            disabled={addDayBusy || !currentUserId}
            onClick={() => void handleAddDay()}
          >
            + Add Day
          </Button>
        </div>
      </aside>

      {/* Center */}
      <main className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl", CARD_BG)}>
        {!selectedNoteId ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-sm text-slate-600 dark:text-slate-500">
            Select a day from the timeline or create a new note
          </div>
        ) : loadingNote && !noteRow ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-2/3 bg-slate-200 dark:bg-slate-700" />
            <Skeleton className="h-32 w-full bg-slate-200 dark:bg-slate-700" />
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700/80 dark:bg-[#1e293b]/95">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Day {Math.max(1, num(noteRow?.hospital_day_number) ?? 0)} Progress Note
                      {podLabel != null ? (
                        <span className="ml-2 text-base font-semibold text-sky-600 dark:text-sky-400">· POD {podLabel}</span>
                      ) : null}
                    </h2>
                    {signed ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-300">
                        Signed ✓{signedAtDisplay ? ` ${signedAtDisplay}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {headerDateFull} · {headerDoc ? `Dr. ${headerDoc}` : "—"} · {wardBedLine || "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {signed ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-200"
                      disabled={signBusy}
                      onClick={() => void handleAmend()}
                    >
                      Amend
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-sky-600 text-white hover:bg-sky-500"
                      disabled={signBusy || !selectedNoteId}
                      onClick={() => void handleSign()}
                    >
                      Sign Note
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {/* Subjective */}
              <section className={cn("overflow-hidden rounded-xl", NESTED_SECTION_BG)}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setSubOpen((o) => !o)}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                    Subjective · Patient complaints today
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", subOpen ? "rotate-180" : "")} />
                </button>
                {subOpen ? (
                  <div className="space-y-5 border-t border-slate-200 dark:border-slate-700/60 px-4 pb-4 pt-3">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Pain (0–10)</span>
                      <div className="mt-2 flex items-center gap-4">
                        <button
                          type="button"
                          disabled={signed}
                          onClick={() => bumpPain(-1)}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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
                          disabled={signed}
                          className="w-16 text-center text-4xl font-bold tabular-nums"
                        />
                        <button
                          type="button"
                          disabled={signed}
                          onClick={() => bumpPain(1)}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      </div>
                      <div className="mt-3 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
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
                              disabled={signed}
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
                              disabled={signed}
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
                            disabled={signed}
                            onClick={() => setNoteDraft((d) => ({ ...d, appetite: d.appetite === a ? "" : a }))}
                            className={cn(
                              "rounded-full px-4 py-1.5 text-xs font-medium transition",
                              noteDraft.appetite === a
                                ? "bg-emerald-600 text-white shadow"
                                : "border border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500",
                            )}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <IpdSubjectiveSnomedBlock
                        signed={signed}
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
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      Objective · Vitals + Examination
                    </span>
                    <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[9px] font-semibold text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">
                      Auto-synced from nursing
                    </span>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", objOpen ? "rotate-180" : "")} />
                </button>
                {objOpen ? (
                  <div className="space-y-5 border-t border-slate-200 dark:border-slate-700/60 px-4 pb-4 pt-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="border-b border-slate-200 dark:border-slate-600/80 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">BP</p>
                        <div className="mt-1 flex items-baseline gap-0.5">
                          <NumericLineInput
                            value={noteDraft.bp_systolic}
                            onChange={(v) => setNoteDraft((d) => ({ ...d, bp_systolic: v.replace(/\D/g, "").slice(0, 3) }))}
                            disabled={signed}
                            className="w-12 text-xl font-bold"
                          />
                          <span className="text-lg font-bold text-slate-900 dark:text-white">/</span>
                          <NumericLineInput
                            value={noteDraft.bp_diastolic}
                            onChange={(v) => setNoteDraft((d) => ({ ...d, bp_diastolic: v.replace(/\D/g, "").slice(0, 3) }))}
                            disabled={signed}
                            className="w-12 text-xl font-bold"
                          />
                        </div>
                        <p className="mt-0.5 text-[10px] text-slate-500">mmHg</p>
                      </div>
                      <div className="border-b border-slate-200 dark:border-slate-600/80 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">HR</p>
                        <NumericLineInput
                          value={noteDraft.heart_rate}
                          onChange={(v) => setNoteDraft((d) => ({ ...d, heart_rate: v.replace(/\D/g, "").slice(0, 3) }))}
                          disabled={signed}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">bpm</p>
                      </div>
                      <div className="border-b border-slate-200 dark:border-slate-600/80 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">SpO₂</p>
                        <NumericLineInput
                          value={noteDraft.spo2}
                          onChange={(v) => setNoteDraft((d) => ({ ...d, spo2: v.replace(/\D/g, "").slice(0, 3) }))}
                          disabled={signed}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">%</p>
                      </div>
                      <div className="border-b border-slate-200 dark:border-slate-600/80 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Temp</p>
                        <NumericLineInput
                          value={noteDraft.temperature_c}
                          onChange={(v) =>
                            setNoteDraft((d) => ({
                              ...d,
                              temperature_c: v.replace(/[^\d.]/g, "").slice(0, 5),
                            }))
                          }
                          disabled={signed}
                          inputMode="decimal"
                          pattern="[0-9.]*"
                          className={cn(
                            "mt-1 block w-full text-2xl font-bold",
                            num(noteDraft.temperature_c) != null && num(noteDraft.temperature_c)! >= 38
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-slate-900 dark:text-white",
                          )}
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">°C</p>
                      </div>
                      <div className="border-b border-slate-200 dark:border-slate-600/80 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">RR</p>
                        <NumericLineInput
                          value={noteDraft.respiratory_rate}
                          onChange={(v) => setNoteDraft((d) => ({ ...d, respiratory_rate: v.replace(/\D/g, "").slice(0, 3) }))}
                          disabled={signed}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">/min</p>
                      </div>
                      <div className="border-b border-slate-200 dark:border-slate-600/80 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Pain</p>
                        <NumericLineInput
                          value={noteDraft.pain_score}
                          onChange={(v) =>
                            setNoteDraft((d) => ({
                              ...d,
                              pain_score: String(
                                Math.min(10, Math.max(0, parseInt(v.replace(/\D/g, "").slice(0, 2) || "0", 10) || 0)),
                              ),
                            }))
                          }
                          disabled={signed}
                          className="mt-1 block w-full text-2xl font-bold"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">/10 VAS</p>
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
                            disabled={signed}
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
                        signed={signed}
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
                    <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800/50">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
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
                                  disabled={signed}
                                  onClick={() =>
                                    setNoteDraft((d) => ({ ...d, wound: { ...d.wound, discharge: opt } }))
                                  }
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.discharge === opt
                                      ? "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
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
                                  disabled={signed}
                                  onClick={() => setNoteDraft((d) => ({ ...d, wound: { ...d.wound, sutures: opt } }))}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.sutures === opt
                                      ? "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
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
                                  disabled={signed}
                                  onClick={() => setNoteDraft((d) => ({ ...d, wound: { ...d.wound, swelling: opt } }))}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.swelling === opt
                                      ? opt === "Mild"
                                        ? "bg-amber-500 text-white"
                                        : "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
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
                                  disabled={signed}
                                  onClick={() => setNoteDraft((d) => ({ ...d, wound: { ...d.wound, erythema: opt } }))}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px]",
                                    noteDraft.wound.erythema === opt
                                      ? "bg-emerald-600 text-white"
                                      : "border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
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
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                    Assessment &amp; Plan
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", apOpen ? "rotate-180" : "")} />
                </button>
                {apOpen ? (
                  <div className="space-y-5 border-t border-slate-200 dark:border-slate-700/60 px-4 pb-4 pt-3">
                    <div>
                      <IpdAssessmentSnomedBlock
                        signed={signed}
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
                      <Textarea
                        disabled={signed}
                        value={noteDraft.plan_narrative}
                        onChange={(e) => setNoteDraft((d) => ({ ...d, plan_narrative: e.target.value }))}
                        placeholder="Plan narrative / discharge planning notes…"
                        className="min-h-[88px] resize-none border-0 border-b border-slate-200 bg-white px-0 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-0 dark:border-slate-600/80 dark:bg-slate-800/40 dark:text-white dark:placeholder:text-slate-600"
                      />
                    </div>

                    {/* Investigations */}
                    <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800/40">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setInvOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
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
                            <div ref={invDropdownRef} className="relative rounded-lg border border-slate-200 p-2 dark:border-slate-600/80">
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
                                disabled={signed}
                                className="w-full border-0 border-b border-slate-300 bg-transparent py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-50 dark:border-slate-600 dark:text-white dark:placeholder:text-slate-500"
                              />
                              {invResults.length > 0 ? (
                                <div className="absolute left-0 right-0 z-50 mt-1 max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-[#334155] dark:bg-[#1e293b] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                                  {invResults.map((inv) => (
                                    <div
                                      key={inv.id}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          if (!signed) void orderInvestigation(inv);
                                        }
                                      }}
                                      onClick={() => {
                                        if (!signed) void orderInvestigation(inv);
                                      }}
                                      className={cn(
                                        "flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-100 dark:border-b-[#1e293b] dark:hover:bg-[#334155]",
                                        signed && "cursor-default",
                                      )}
                                    >
                                      <span className="flex-1 text-[13px] text-slate-900 dark:text-white">{inv.test_name}</span>
                                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-[#0f172a] dark:text-slate-400">
                                        {s(inv.test_category) || "—"}
                                      </span>
                                      <span className="min-w-[50px] text-right text-xs text-emerald-600 dark:text-emerald-400">
                                        ₹{inv.final_price != null && inv.final_price !== "" ? String(inv.final_price) : "—"}
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
                                <TableRow className="border-slate-200 hover:bg-transparent dark:border-slate-700">
                                  <TableHead className="text-[10px] uppercase text-slate-500">Test</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Ordered</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Result</TableHead>
                                  <TableHead className="text-[10px] uppercase text-slate-500">Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {investigations.map((inv) => {
                                  const st = s(inv.status ?? inv.order_status);
                                  const pill = invStatusBadge(st);
                                  const res = [s(inv.result_value), s(inv.result_unit)].filter(Boolean).join(" ");
                                  const crit = Boolean(inv.is_critical);
                                  return (
                                    <TableRow
                                      key={s(inv.id)}
                                      className={cn(
                                        "border-slate-200 dark:border-slate-700/80",
                                        crit ? "border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/20" : "",
                                      )}
                                    >
                                      <TableCell className="font-medium text-slate-900 dark:text-slate-200">
                                        {s(inv.test_name ?? inv.name)}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                                        {fmtDayShort(s(inv.ordered_at ?? inv.created_at))}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-700 dark:text-slate-300">{res || "—"}</TableCell>
                                      <TableCell>
                                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", pill.cls)}>
                                          {pill.label}
                                        </span>
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
                    <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800/40">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setPlanOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Plan · Medications &amp; orders</span>
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
                            <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-600/80">
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
                                  className="w-full border-0 border-b border-slate-300 bg-transparent py-1 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-600 dark:text-white dark:placeholder:text-slate-500"
                                />
                                {newMed.selectedDrugId ? (
                                  <p className="mt-1 text-[10px] text-slate-500">Linked to pharmacy catalogue</p>
                                ) : null}
                                {drugResults.length > 0 ? (
                                  <div className="absolute left-0 right-0 z-50 mt-1 max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-[#334155] dark:bg-[#1e293b] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                                    {drugResults.map((drug) => {
                                      const line = `${s(drug.generic_name)} (${s(drug.brand_name)}) · ${s(drug.dosage_form)} ${s(drug.strength)} · ₹${drug.mrp != null && drug.mrp !== "" ? String(drug.mrp) : "—"}`;
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
                                          className="cursor-pointer border-b border-slate-100 px-3 py-2 text-[13px] text-slate-900 last:border-b-0 hover:bg-slate-100 dark:border-b-[#1e293b] dark:text-white dark:hover:bg-[#334155]"
                                        >
                                          <span className="block w-full text-left">{line}</span>
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
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300 dark:bg-slate-900/60 dark:text-white dark:ring-slate-600"
                              />
                              <select
                                value={newMed.route}
                                onChange={(e) => setNewMed((m) => ({ ...m, route: e.target.value }))}
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300 dark:bg-slate-900/60 dark:text-white dark:ring-slate-600"
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
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300 dark:bg-slate-900/60 dark:text-white dark:ring-slate-600"
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
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300 dark:bg-slate-900/60 dark:text-white dark:ring-slate-600"
                              />
                              <select
                                value={newMed.kind}
                                onChange={(e) => setNewMed((m) => ({ ...m, kind: e.target.value }))}
                                className="h-9 rounded-md border-0 bg-slate-100 px-2 text-sm text-slate-900 ring-1 ring-slate-300 dark:bg-slate-900/60 dark:text-white dark:ring-slate-600"
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
                                <TableRow className="border-slate-200 hover:bg-transparent dark:border-slate-700">
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
                                    <TableRow key={s(tx.id)} className="border-slate-200 dark:border-slate-700/80">
                                      <TableCell>
                                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", k.cls)}>
                                          {k.label}
                                        </span>
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-800 dark:text-slate-200">
                                        {s(tx.name)} {tx.dose ? <span className="text-slate-500 dark:text-slate-400">· {s(tx.dose)}</span> : null}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                                        {s(tx.route)} · {s(tx.frequency)}
                                      </TableCell>
                                      <TableCell className="text-xs text-slate-600 dark:text-slate-400">{s(tx.duration_days ?? tx.days) || "—"}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          )}
                          <button
                            type="button"
                            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"
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
                    <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800/40">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setNabhOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Nursing orders &amp; NABH checklist</span>
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
                                  <span className="text-xs text-slate-700 dark:text-slate-300">{label}</span>
                                  <button
                                    type="button"
                                    disabled={signed}
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
                                        : "border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-600",
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
                                    disabled={signed}
                                    onClick={() => setNabhDraft((d) => ({ ...d, diet: t }))}
                                    className={cn(
                                      "rounded-full px-2.5 py-1 text-[11px]",
                                      nabhDraft.diet === t
                                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100"
                                        : "border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
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
                                    disabled={signed}
                                    onClick={() => setNabhDraft((d) => ({ ...d, activity: t }))}
                                    className={cn(
                                      "rounded-full px-2.5 py-1 text-[11px]",
                                      nabhDraft.activity === t
                                        ? "bg-sky-100 text-sky-900 dark:bg-sky-500/30 dark:text-sky-100"
                                        : "border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400",
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
                                disabled={signed}
                                value={nabhDraft.ivSite}
                                onChange={(e) => setNabhDraft((d) => ({ ...d, ivSite: e.target.value }))}
                                className="mt-1 w-full border-0 border-b border-slate-300 bg-transparent py-1 text-sm text-slate-900 outline-none dark:border-slate-600 dark:text-white"
                              />
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500">Consult (comma-separated)</p>
                              <input
                                type="text"
                                disabled={signed}
                                value={nabhDraft.consultText}
                                onChange={(e) => setNabhDraft((d) => ({ ...d, consultText: e.target.value }))}
                                className="mt-1 w-full border-0 border-b border-slate-300 bg-transparent py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-600 dark:text-white dark:placeholder:text-slate-500"
                                placeholder="Physio, Anaesthesia…"
                              />
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* I/O */}
                    <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800/40">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left"
                        onClick={() => setIoOpen((o) => !o)}
                      >
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Drain / I&amp;O (24h)</span>
                        <ChevronDown className={cn("h-4 w-4 text-slate-500", ioOpen ? "rotate-180" : "")} />
                      </button>
                      {ioOpen ? (
                        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-3 text-sm">
                            <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/80 pb-1">
                              <span className="text-slate-500">Drain output</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900 dark:text-white">
                                <NumericLineInput
                                  value={ioDraft.drain}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, drain: v.replace(/\D/g, "") }))}
                                  disabled={signed}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/80 pb-1">
                              <span className="text-slate-500">Urine out</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900 dark:text-white">
                                <NumericLineInput
                                  value={ioDraft.urine}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, urine: v.replace(/\D/g, "") }))}
                                  disabled={signed}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                          </div>
                          <div className="space-y-3 text-sm">
                            <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/80 pb-1">
                              <span className="text-slate-500">IV fluids in</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900 dark:text-white">
                                <NumericLineInput
                                  value={ioDraft.iv}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, iv: v.replace(/\D/g, "") }))}
                                  disabled={signed}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/80 pb-1">
                              <span className="text-slate-500">Oral intake</span>
                              <span className="flex items-baseline gap-1 font-bold text-slate-900 dark:text-white">
                                <NumericLineInput
                                  value={ioDraft.oral}
                                  onChange={(v) => setIoDraft((d) => ({ ...d, oral: v.replace(/\D/g, "") }))}
                                  disabled={signed}
                                  className="w-16 text-right text-lg"
                                />
                                <span className="text-xs font-normal text-slate-500">ml</span>
                              </span>
                            </div>
                            <div className="flex justify-between pt-1">
                              <span className="font-semibold text-slate-600 dark:text-slate-400">Balance</span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-sm font-bold",
                                  ioBalance >= 0
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                                    : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
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
      <aside className={cn("flex min-h-0 flex-col overflow-y-auto rounded-xl", CARD_BG)}>
        <div className="border-b border-slate-200 dark:border-slate-700/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Context
        </div>
        <div className="flex min-h-0 flex-1 flex-col space-y-4 p-3 text-xs">
          <div>
            <p className="font-bold text-slate-900 dark:text-white">Admission summary</p>
            <dl className="mt-2 space-y-1.5 text-slate-600 dark:text-slate-400">
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Diagnosis</dt>
                <dd className="text-slate-800 dark:text-slate-100">{diagnosis}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Admitted</dt>
                <dd className="text-slate-800 dark:text-slate-100">{admittedFmt}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold tracking-wide text-slate-500">SURGERY DATE</dt>
                <dd className="text-slate-800 dark:text-slate-100">{surgeryDisplay}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Surgeon</dt>
                <dd className="text-slate-800 dark:text-slate-100">{surgeonName || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Est. discharge</dt>
                <dd className="text-slate-800 dark:text-slate-100">{estDischarge}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-slate-500">Insurance / TPA</dt>
                <dd className="text-slate-800 dark:text-slate-100">{coverageLabel}</dd>
              </div>
            </dl>
          </div>

          <div>
            <p className="font-bold text-slate-900 dark:text-white">Alerts</p>
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
            <p className="font-bold text-slate-900 dark:text-white">Pending results</p>
            {pendingResults.length === 0 ? (
              <p className="mt-1 text-slate-500">None</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {pendingResults.map((p) => {
                  const st = s(p.status);
                  const pill = invStatusBadge(st);
                  return (
                    <li key={s(p.id)} className="flex items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                      <span className="truncate">{s(p.test_name ?? p.name)}</span>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px]", pill.cls)}>{pill.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <p className="font-bold text-slate-900 dark:text-white">Today&apos;s condition trend</p>
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
            <p className="font-bold text-slate-900 dark:text-white">Consultants on case</p>
            {consultList.length === 0 ? (
              <p className="mt-1 text-slate-500">None</p>
            ) : (
              <ul className="mt-2 list-inside list-disc text-slate-700 dark:text-slate-300">
                {consultList.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-auto border-t border-slate-200 dark:border-slate-700/80 pt-4">
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
              <p className="rounded-lg bg-emerald-100 px-3 py-2 text-center text-sm font-semibold text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300">
                Signed ✓ {signedAtDisplay}
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
