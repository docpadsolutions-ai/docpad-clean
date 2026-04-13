"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import VoiceDictationButton from "@/app/components/VoiceDictationButton";
import SnomedSearch, { type SnomedConcept } from "@/app/components/SnomedSearch";
import { SNOMED_ECL_CLINICAL_FINDING } from "@/app/lib/ipdSnomedEcl";
import { DiagnosisWithIcd } from "@/app/components/clinical/DiagnosisWithIcd";
import { extractDischargeClinicalNlp, type DischargeNlpExtraction } from "@/app/lib/geminiDischargeNlp";
import { preAdmissionFrom } from "@/app/lib/ipdAdmissionDisplay";
import { readIndiaRefsetKeyFromEnv } from "@/app/lib/snomedUiConfig";
import {
  fetchDischargeAiCompileContext,
  rpcCompileDischargeSummary,
  rpcUpsertDischargeSummary,
  type CompileDischargeSummaryResult,
  type UpsertDischargeSummaryPayload,
} from "@/app/lib/ipdData";
import { wardBedLabelFromAdmission } from "@/app/lib/ipdAdmissionDisplay";
import { parseDischargeAiSections } from "@/app/lib/dischargeSummaryUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function numMoney(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatInrCompact(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export type MedicationRow = {
  id: string;
  drugName: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
};

/** Matches prompt — arrays for diagnosis / procedures where RPC accepts joined or JSON. */
export interface DischargeFormState {
  dischargeCondition: "stable" | "improved" | "lama" | "expired" | "";
  dischargeType: "regular" | "lama" | "referral" | "death" | "";
  dischargeDate: string;
  followUpDate: string;
  hospitalCourseSummary: string;
  investigationsSummary: string;
  finalDiagnosisDisplay: string[];
  finalDiagnosisIcd10: string[];
  /** Parallel SNOMED / ICD rows for final diagnoses (conceptId may be empty if not coded). */
  snomedAssessmentCodes: Array<{ conceptId: string; term: string; icd10?: string }>;
  proceduresDone: string[];
  dischargeMedications: MedicationRow[];
  dischargeInstructions: string;
  dietAdvice: string;
  activityRestrictions: string;
  woundCareInstructions: string;
  implantDetails: Record<string, unknown> | null;
  postOpProtocol: string;
  physiotherapyPlan: string;
  procedureNotes: string;
  implantsUsedText: string;
  urgentCareText: string;
}

const DEFAULT_URGENT =
  "Seek emergency care immediately if: fever >101°F, wound redness/discharge, severe pain unrelieved by medication, difficulty breathing, or any other concern.";

function newMedRow(): MedicationRow {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}`,
    drugName: "",
    dose: "",
    route: "PO",
    frequency: "BD",
    duration: "",
  };
}

function emptyForm(): DischargeFormState {
  return {
    dischargeCondition: "",
    dischargeType: "regular",
    dischargeDate: "",
    followUpDate: "",
    hospitalCourseSummary: "",
    investigationsSummary: "",
    finalDiagnosisDisplay: [],
    finalDiagnosisIcd10: [],
    snomedAssessmentCodes: [],
    proceduresDone: [],
    dischargeMedications: [],
    dischargeInstructions: "",
    dietAdvice: "",
    activityRestrictions: "As per treating doctor's advice",
    woundCareInstructions: "Keep wound dry, suture removal on follow-up date",
    implantDetails: null,
    postOpProtocol: "",
    physiotherapyPlan: "",
    procedureNotes: "",
    implantsUsedText: "",
    urgentCareText: DEFAULT_URGENT,
  };
}

function latestProgressNoteId(notes: Array<Record<string, unknown>>): string | null {
  if (!notes.length) return null;
  const sorted = [...notes].sort(
    (a, b) => Number(b.hospital_day_number ?? 0) - Number(a.hospital_day_number ?? 0),
  );
  const id = sorted[0]?.id;
  return id != null ? String(id) : null;
}

function medicationsFromLastDay(
  treatments: Array<Record<string, unknown>>,
  notes: Array<Record<string, unknown>>,
): MedicationRow[] {
  const lastId = latestProgressNoteId(notes);
  if (!lastId) return [];
  const medKinds = ["medical", "med", "rx", "drug"];
  return treatments
    .filter((t) => {
      if (s(t.progress_note_id) !== lastId) return false;
      const k = s(t.treatment_kind ?? t.kind).toLowerCase();
      return medKinds.some((m) => k.includes(m)) || (!k && s(t.name));
    })
    .map((t) => ({
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `m-${s(t.id)}`,
      drugName: s(t.name ?? t.drug_name ?? t.generic_name),
      dose: s(t.dose ?? t.strength),
      route: s(t.route) || "PO",
      frequency: s(t.frequency) || "BD",
      duration: s(t.duration_days ?? t.days ?? ""),
    }))
    .filter((m) => m.drugName);
}

/** RPC expects TEXT[] — never pass joined strings, "—", or empty string arrays. */
const sanitizeArray = (val: unknown): string[] | null => {
  if (!val) return null;
  if (Array.isArray(val)) return val.filter(Boolean).length > 0 ? val.filter(Boolean) : null;
  if (typeof val === "string" && val.trim() && val !== "—") return [val.trim()];
  return null;
};

function coerceDraftStringArrayField(draftVal: unknown, admissionFallback: string[]): string[] {
  if (draftVal == null) return admissionFallback;
  if (Array.isArray(draftVal)) {
    const arr = (draftVal as unknown[]).map((x) => String(x).trim()).filter((x) => x.length > 0);
    return arr.length > 0 ? arr : admissionFallback;
  }
  const one = String(draftVal).trim();
  if (!one || one === "—") return admissionFallback;
  return [one];
}

function rowsFromDiagnosisArrays(
  display: string[],
  icd10: string[],
): DischargeFormState["snomedAssessmentCodes"] {
  const n = Math.max(display.length, icd10.length);
  const rows: DischargeFormState["snomedAssessmentCodes"] = [];
  for (let i = 0; i < n; i++) {
    const term = s(display[i]);
    const icd = s(icd10[i]);
    if (!term && !icd) continue;
    rows.push({ conceptId: "", term: term || icd, icd10: icd || undefined });
  }
  return rows;
}

function isBlankDiagnosisForm(f: DischargeFormState): boolean {
  return f.finalDiagnosisDisplay.length === 0 || f.finalDiagnosisDisplay.every((x) => !s(x));
}

function applyDischargeNlpPatch(f: DischargeFormState, ext: DischargeNlpExtraction): DischargeFormState {
  const next: DischargeFormState = { ...f };
  if (isBlankDiagnosisForm(next) && ext.diagnoses.length > 0) {
    const labels = ext.diagnoses.map((x) => s(x)).filter(Boolean);
    if (labels.length > 0) {
      next.finalDiagnosisDisplay = labels;
      next.finalDiagnosisIcd10 = labels.map(() => "");
      next.snomedAssessmentCodes = labels.map((term) => ({ conceptId: "", term }));
    }
  }
  if (next.proceduresDone.length === 0 && ext.procedures.length > 0) {
    next.proceduresDone = ext.procedures.map((x) => s(x)).filter(Boolean);
  }
  if (!next.dischargeCondition && ext.discharge_condition) {
    const dc = ext.discharge_condition;
    if (dc === "stable" || dc === "improved" || dc === "lama" || dc === "expired") {
      next.dischargeCondition = dc;
    }
  }
  if (next.implantDetails == null && ext.implants.length > 0 && !s(next.implantsUsedText)) {
    next.implantsUsedText = ext.implants.join("; ");
  }
  return next;
}

function buildNlpSourceText(f: DischargeFormState): string {
  const parts = [
    f.hospitalCourseSummary,
    f.investigationsSummary,
    f.dischargeInstructions,
    f.dietAdvice,
    f.activityRestrictions,
  ]
    .map((x) => s(x))
    .filter(Boolean);
  return parts.join("\n\n").trim();
}

function seedFormFromCompiled(data: CompileDischargeSummaryResult | null): DischargeFormState {
  const base = emptyForm();
  if (!data) return base;

  const admission = asRec(data.admission) ?? {};
  const draft = asRec(data.draft);
  const notes = Array.isArray(data.progress_notes)
    ? (data.progress_notes as Array<Record<string, unknown>>)
    : [];
  const treatments = Array.isArray(data.treatments)
    ? (data.treatments as Array<Record<string, unknown>>)
    : [];
  if (draft) {
    const fbDisp = admission.primary_diagnosis_display ? [String(admission.primary_diagnosis_display)] : [];
    const fbIcd = admission.primary_diagnosis_icd10 ? [String(admission.primary_diagnosis_icd10)] : [];
    const dxDisp = coerceDraftStringArrayField(draft.final_diagnosis_display, fbDisp);
    const dxIcd = coerceDraftStringArrayField(draft.final_diagnosis_icd10, fbIcd);
    return {
      ...base,
      dischargeCondition: (s(draft.discharge_condition) as DischargeFormState["dischargeCondition"]) || "",
      dischargeType: (s(draft.discharge_type) as DischargeFormState["dischargeType"]) || "regular",
      dischargeDate: s(draft.discharge_date).slice(0, 10),
      followUpDate: s(draft.follow_up_date).slice(0, 10),
      hospitalCourseSummary: s(draft.hospital_course_summary),
      investigationsSummary: s(draft.investigations_summary),
      finalDiagnosisDisplay: dxDisp,
      finalDiagnosisIcd10: dxIcd,
      snomedAssessmentCodes: rowsFromDiagnosisArrays(dxDisp, dxIcd),
      proceduresDone: Array.isArray(draft.procedures_done)
        ? (draft.procedures_done as unknown[]).map((x) => String(x))
        : [],
      dischargeMedications: parseMedDraft(draft.discharge_medications),
      dischargeInstructions: s(draft.discharge_instructions),
      dietAdvice: s(draft.diet_advice),
      activityRestrictions: s(draft.activity_restrictions) || base.activityRestrictions,
      woundCareInstructions: s(draft.wound_care_instructions) || base.woundCareInstructions,
      implantDetails:
        draft.implant_details && typeof draft.implant_details === "object"
          ? (draft.implant_details as Record<string, unknown>)
          : null,
      postOpProtocol: s(draft.post_op_protocol),
      physiotherapyPlan: s(draft.physiotherapy_plan),
      procedureNotes: s(draft.procedure_notes ?? draft.procedure_notes_text),
      implantsUsedText: s(draft.implants_used ?? draft.implant_details_text),
      urgentCareText: s(draft.urgent_care_instructions) || DEFAULT_URGENT,
    };
  }

  const meds = medicationsFromLastDay(treatments, notes);
  const surgery = asRec(data.surgery);

  const dxD = admission.primary_diagnosis_display ? [String(admission.primary_diagnosis_display)] : [];
  const dxI = admission.primary_diagnosis_icd10 ? [String(admission.primary_diagnosis_icd10)] : [];
  return {
    ...base,
    finalDiagnosisDisplay: dxD,
    finalDiagnosisIcd10: dxI,
    snomedAssessmentCodes: rowsFromDiagnosisArrays(dxD, dxI),
    hospitalCourseSummary: s(data.generated_hospital_course ?? data.hospital_course_draft) || "",
    investigationsSummary: s(data.generated_investigations_summary ?? data.investigations_summary_draft) || "",
    dischargeMedications: meds.length ? meds : [],
    procedureNotes: s(surgery?.notes),
    implantsUsedText: s(surgery?.implants),
    proceduresDone: s(surgery?.procedure_name) ? [s(surgery?.procedure_name)] : [],
  };
}

function parseMedDraft(raw: unknown): MedicationRow[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((r) => {
      const o = asRec(r) ?? {};
      return {
        id: s(o.id) || (crypto.randomUUID?.() ?? `m-${Date.now()}`),
        drugName: s(o.drugName ?? o.name ?? o.drug_name),
        dose: s(o.dose),
        route: s(o.route) || "PO",
        frequency: s(o.frequency) || "BD",
        duration: s(o.duration),
      };
    });
  }
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(j)) return parseMedDraft(j);
  } catch {
    /* ignore */
  }
  return [];
}

function formToUpsertPayload(
  admissionId: string,
  status: "draft" | "finalized",
  form: DischargeFormState,
  opts?: { signedBy?: string | null },
): UpsertDischargeSummaryPayload {
  const proceduresForRpc =
    form.proceduresDone.length > 0
      ? form.proceduresDone
      : form.procedureNotes.trim()
        ? [form.procedureNotes.trim()]
        : null;
  const signedBy = opts?.signedBy?.trim() || null;
  return {
    p_admission_id: admissionId,
    p_status: status,
    p_discharge_condition: form.dischargeCondition || null,
    p_discharge_date: form.dischargeDate || null,
    p_discharge_type: form.dischargeType || null,
    p_hospital_course_summary: form.hospitalCourseSummary || null,
    p_investigations_summary: form.investigationsSummary || null,
    p_discharge_medications: form.dischargeMedications,
    p_discharge_instructions: form.dischargeInstructions || null,
    p_follow_up_date: form.followUpDate || null,
    p_diet_advice: form.dietAdvice || null,
    p_activity_restrictions: form.activityRestrictions || null,
    p_wound_care_instructions: form.woundCareInstructions || null,
    p_implant_details:
      form.implantDetails ??
      (form.implantsUsedText.trim() ? form.implantsUsedText : null),
    p_post_op_protocol: form.postOpProtocol || null,
    p_physiotherapy_plan: form.physiotherapyPlan || null,
    p_final_diagnosis_icd10: sanitizeArray(form.finalDiagnosisIcd10),
    p_final_diagnosis_display: sanitizeArray(form.finalDiagnosisDisplay),
    p_procedures_done: sanitizeArray(proceduresForRpc),
    ...(status === "finalized" && signedBy
      ? { p_signed_by: signedBy, p_signed_at: new Date().toISOString() }
      : {}),
  };
}

type Phase = "loading" | "ready" | "finalizing";

type AiCompilePhase = "idle" | "loading" | "done";

function computeLosDays(admittedRaw: string, dischargeRaw: string): number {
  const a = Date.parse(admittedRaw.slice(0, 10));
  const b = Date.parse(dischargeRaw.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

function DischargeCompileAiButton({
  phase,
  disabled,
  disabledTitle,
  onClick,
}: {
  phase: AiCompilePhase;
  disabled: boolean;
  disabledTitle?: string;
  onClick: () => void;
}) {
  const tip = disabled && disabledTitle ? disabledTitle : undefined;
  if (phase === "loading") {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled
        className="pointer-events-none shrink-0 gap-1.5 border-indigo-200 bg-indigo-50 text-indigo-800"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        <span className="hidden sm:inline">Compiling clinical summary...</span>
        <span className="sm:hidden">Compiling...</span>
      </Button>
    );
  }
  if (phase === "done") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        title={tip}
        className="h-7 shrink-0 px-2 text-xs text-gray-500 hover:bg-gray-100"
      >
        ✓ Regenerate
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={tip}
      className="shrink-0 gap-1 bg-indigo-600 text-white hover:bg-indigo-700"
    >
      ✨ Generate with AI
    </Button>
  );
}

/** Shared field styles for inputs / textareas in this modal (theme-aware). */
const fieldBase =
  "border border-gray-300 bg-white text-gray-900 shadow-sm placeholder:text-gray-400 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500";

const modalPanelClass =
  "relative z-[121] flex h-full w-full max-w-[720px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-2xl";

const saveDraftBtnClass =
  "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50";

const labelClass = "text-sm font-medium text-gray-700";

const radioLabelClass = "flex items-center gap-1.5 text-sm text-gray-700";

const DX_CHIP_WRAP =
  "inline-flex max-w-full items-stretch overflow-hidden rounded-full border border-gray-200 bg-gray-100 shadow-sm";
const DX_CHIP_MAIN =
  "inline-flex min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent px-2.5 py-1.5 text-left text-[12px] font-medium text-gray-900";
const DX_CHIP_REMOVE =
  "shrink-0 border-0 border-l border-gray-200 bg-transparent px-2 py-1.5 text-gray-400 transition hover:bg-red-100 hover:text-red-700";

export type SttFieldKey =
  | "hospitalCourseSummary"
  | "dischargeInstructions"
  | "dietAdvice"
  | "activityRestrictions"
  | "woundCareInstructions"
  | "postOpProtocol"
  | "physiotherapyPlan";

function DischargeTextareaWithMic({
  fieldKey,
  value,
  onChange,
  rows,
  placeholder,
  specialty,
  doctorId,
  recording,
  showTranscribedBadge,
  onRecordingStateChange,
  onMergedFinal,
}: {
  fieldKey: SttFieldKey;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  placeholder?: string;
  specialty: string;
  doctorId?: string | null;
  recording: boolean;
  showTranscribedBadge: boolean;
  onRecordingStateChange: (v: boolean) => void;
  onMergedFinal?: (merged: string) => void;
}) {
  return (
    <div className="relative" data-stt-field={fieldKey}>
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        {showTranscribedBadge ? (
          <span className="pointer-events-none rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 opacity-90">
            Transcribed
          </span>
        ) : null}
        <div className="pointer-events-auto [&_button]:text-gray-400 [&_button:hover]:bg-transparent [&_button:hover]:text-blue-500">
          <VoiceDictationButton
            contextType="ipd_progress_note"
            specialty={specialty}
            doctorId={doctorId ?? undefined}
            ipdVoiceBaseText={value}
            variant="default"
            onRecordingStateChange={onRecordingStateChange}
            onTranscriptUpdate={(text, isFinal) => {
              onChange(text);
              if (isFinal) {
                onMergedFinal?.(text);
              }
            }}
            className="!gap-0"
          />
        </div>
      </div>
      <Textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          fieldBase,
          recording && "animate-pulse border-blue-500 ring-2 ring-blue-500/35",
          "min-h-[88px] pr-12",
        )}
      />
    </div>
  );
}

export type DischargeSummaryModalProps = {
  isOpen: boolean;
  admissionId: string;
  onClose: () => void;
  onDischarged: () => void;
  /** Same bundle as IPD daily notes — specialty / SNOMED refset for voice + search. */
  admissionData?: Record<string, unknown> | null;
};

export function DischargeSummaryModal({
  isOpen,
  admissionId,
  onClose,
  onDischarged,
  admissionData = null,
}: DischargeSummaryModalProps) {
  const router = useRouter();
  const panelId = useId();
  const [phase, setPhase] = useState<Phase>("loading");
  const [compileErr, setCompileErr] = useState<string | null>(null);
  const [compiled, setCompiled] = useState<CompileDischargeSummaryResult | null>(null);
  const [form, setForm] = useState<DischargeFormState>(() => emptyForm());
  const [aiCompilePhase, setAiCompilePhase] = useState<AiCompilePhase>("idle");
  const [pendingFinalize, setPendingFinalize] = useState(false);
  const skipNextAutosave = useRef(true);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [diagnosisQuery, setDiagnosisQuery] = useState("");
  const [isTranscribing, setIsTranscribing] = useState<Record<string, boolean>>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [transcribedFlash, setTranscribedFlash] = useState<SttFieldKey | null>(null);

  const admissionBundle = admissionData;
  const preAdmission = preAdmissionFrom(admissionBundle);
  const admissionRowForVoice = asRec(admissionBundle?.admission);
  const voiceSpecialty = s(preAdmission?.specialty) || s(admissionRowForVoice?.specialty) || "General Medicine";
  const indiaRefset = readIndiaRefsetKeyFromEnv();

  const defaultOpen = useMemo(
    () => ({
      patient: false,
      diagnosis: true,
      course: true,
      investigations: false,
      surgery: true,
      meds: true,
      instructions: true,
      urgent: true,
    }),
    [],
  );
  const [openSec, setOpenSec] = useState(defaultOpen);

  const surgeryData = useMemo(() => asRec(compiled?.surgery), [compiled]);

  const toggle = useCallback((key: keyof typeof defaultOpen) => {
    setOpenSec((o) => ({ ...o, [key]: !o[key] }));
  }, []);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      if (!uid) return;
      const { data: prof } = await supabase.from("practitioners").select("id").eq("user_id", uid).maybeSingle();
      if (prof?.id) setPractitionerId(String(prof.id));
    })();
  }, []);

  useEffect(() => {
    if (!transcribedFlash) return;
    const t = window.setTimeout(() => setTranscribedFlash(null), 2000);
    return () => window.clearTimeout(t);
  }, [transcribedFlash]);

  const setFieldRecording = useCallback((key: string, rec: boolean) => {
    setIsTranscribing((m) => ({ ...m, [key]: rec }));
  }, []);

  const runDischargeNlpOnText = useCallback(async (noteText: string, showToast: boolean) => {
    const text = noteText.trim();
    if (!text) return;
    setExtractionError(null);
    setIsExtracting(true);
    try {
      const ext = await extractDischargeClinicalNlp(text);
      setForm((f) => applyDischargeNlpPatch(f, ext));
      if (showToast) toast.success("Clinical data extracted — please review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extraction failed";
      setExtractionError(msg);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const handleExtractDiagnosesClick = useCallback(async () => {
    const src = form.hospitalCourseSummary.trim() || buildNlpSourceText(form);
    if (!src) {
      toast.error("Add hospital course or discharge text to extract diagnoses.");
      return;
    }
    await runDischargeNlpOnText(src, true);
  }, [form, runDischargeNlpOnText]);

  const handleHospitalCourseMergedFinal = useCallback(
    (merged: string) => {
      setTranscribedFlash("hospitalCourseSummary");
      void runDischargeNlpOnText(merged, true);
    },
    [runDischargeNlpOnText],
  );

  const handleDxSelect = useCallback((concept: SnomedConcept) => {
    const term = concept.term.trim();
    if (!term) return;
    setForm((f) => {
      if (f.finalDiagnosisDisplay.some((t) => t.toLowerCase() === term.toLowerCase())) return f;
      const icd = concept.icd10?.trim() || "";
      return {
        ...f,
        finalDiagnosisDisplay: [...f.finalDiagnosisDisplay, term],
        finalDiagnosisIcd10: [...f.finalDiagnosisIcd10, icd],
        snomedAssessmentCodes: [
          ...f.snomedAssessmentCodes,
          { conceptId: concept.conceptId.trim(), term, icd10: icd || undefined },
        ],
      };
    });
    setDiagnosisQuery("");
  }, []);

  const removeDiagnosisAt = useCallback((index: number) => {
    setForm((f) => ({
      ...f,
      finalDiagnosisDisplay: f.finalDiagnosisDisplay.filter((_, j) => j !== index),
      finalDiagnosisIcd10: f.finalDiagnosisIcd10.filter((_, j) => j !== index),
      snomedAssessmentCodes: f.snomedAssessmentCodes.filter((_, j) => j !== index),
    }));
  }, []);

  const load = useCallback(async () => {
    if (!admissionId) return;
    setPhase("loading");
    setCompileErr(null);
    skipNextAutosave.current = true;
    const { data, error } = await rpcCompileDischargeSummary(supabase, admissionId);
    if (error) {
      setCompileErr(error.message);
      setPhase("ready");
      return;
    }
    setCompiled(data);
    const next = seedFormFromCompiled(data);
    setForm(next);
    const hasAiText = Boolean(s(next.hospitalCourseSummary) || s(next.investigationsSummary));
    setAiCompilePhase(hasAiText ? "done" : "idle");
    setPhase("ready");
    setTimeout(() => {
      skipNextAutosave.current = false;
    }, 0);
  }, [admissionId]);

  useEffect(() => {
    if (!isOpen || !admissionId) return;
    void load();
  }, [isOpen, admissionId, load]);

  const patient = asRec(compiled?.patient);
  const admission = asRec(compiled?.admission);
  const notes = useMemo(
    () =>
      Array.isArray(compiled?.progress_notes)
        ? (compiled!.progress_notes as Array<Record<string, unknown>>)
        : [],
    [compiled],
  );

  const runUpsert = useCallback(
    async (status: "draft" | "finalized") => {
      const payload = formToUpsertPayload(admissionId, status, form, {
        signedBy: status === "finalized" ? practitionerId : null,
      });
      const { error } = await rpcUpsertDischargeSummary(supabase, payload);
      if (error) throw error;
    },
    [admissionId, form, practitionerId],
  );

  const handleCompileDischargeAi = useCallback(async () => {
    if (notes.length === 0) return;
    const revertPhase = aiCompilePhase;
    setAiCompilePhase("loading");
    try {
      const { data: ctx, error: ctxErr } = await fetchDischargeAiCompileContext(supabase, admissionId);
      if (ctxErr || !ctx) throw ctxErr ?? new Error("Failed to load clinical data");

      const pat = asRec(compiled?.patient) ?? asRec(admissionBundle?.patient);
      const adm = asRec(compiled?.admission) ?? asRec(admissionBundle?.admission);
      const doc = ctx.doctor_admissions_summary;

      const patientName = s(pat?.full_name ?? pat?.name) || "Unknown";
      const ageYears = s(pat?.age ?? pat?.age_years) || "—";
      const sex = s(pat?.gender) ?? "";
      const admittedDate = s(adm?.admission_date).slice(0, 10) || "—";
      const dischargeDate = form.dischargeDate || new Date().toISOString().slice(0, 10);
      const losDays = computeLosDays(admittedDate, dischargeDate);
      const admittingDiagnosis =
        s(doc?.admitting_diagnosis ?? doc?.primary_diagnosis_display) || s(adm?.primary_diagnosis_display);
      const specialty = s(doc?.specialty) || s(preAdmission?.specialty) || s(adm?.specialty) || "General";

      const res = await fetch("/api/ipd/compile-discharge-clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName,
          ageYears,
          sex,
          admittedDate,
          dischargeDate,
          losDays,
          admittingDiagnosis,
          specialty,
          progressNotes: ctx.progress_notes,
          investigations: ctx.investigation_orders,
          treatments: ctx.treatments,
        }),
      });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "AI compilation failed");
      const text = s(json.text);
      if (!text) throw new Error("Empty AI response");
      const { hospitalCourse, investigationsSummary } = parseDischargeAiSections(text);
      setForm((f) => ({
        ...f,
        hospitalCourseSummary: hospitalCourse,
        investigationsSummary: investigationsSummary || f.investigationsSummary,
      }));
      setAiCompilePhase("done");
      toast.success("Clinical summary compiled — please review");
    } catch (e) {
      setAiCompilePhase(revertPhase);
      toast.error(e instanceof Error ? e.message : "Compilation failed");
    }
  }, [
    admissionId,
    admissionBundle,
    aiCompilePhase,
    compiled,
    form.dischargeDate,
    notes.length,
    preAdmission?.specialty,
  ]);

  useEffect(() => {
    if (!isOpen || phase !== "ready" || skipNextAutosave.current) return;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await runUpsert("draft");
        } catch (e) {
          console.warn("discharge draft save:", e);
        }
      })();
    }, 2000);
    return () => window.clearTimeout(t);
  }, [form, isOpen, phase, runUpsert]);

  const handleSaveDraft = useCallback(async () => {
    try {
      await runUpsert("draft");
      toast.success("Draft saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }, [runUpsert]);

  const canFinalize = Boolean(form.dischargeCondition) && Boolean(form.dischargeDate);

  const handleFinalizeClick = useCallback(() => {
    if (!canFinalize) {
      toast.message("Fill discharge condition and discharge date first");
      return;
    }
    setPendingFinalize(true);
  }, [canFinalize]);

  const handleConfirmFinalize = useCallback(async () => {
    setPhase("finalizing");
    try {
      await runUpsert("finalized");

      const dischargeIso = form.dischargeDate
        ? `${form.dischargeDate}T12:00:00.000Z`
        : new Date().toISOString();

      const admRow = asRec(compiled?.admission) ?? asRec(admissionBundle?.admission);
      const bedId = s(admRow?.bed_id);

      const { error: admErr } = await supabase
        .from("ipd_admissions")
        .update({ status: "discharged", discharged_at: dischargeIso })
        .eq("id", admissionId);
      if (admErr) throw new Error(admErr.message);

      if (bedId) {
        const { error: bedErr } = await supabase.from("ipd_beds").update({ status: "available" }).eq("id", bedId);
        if (bedErr) console.warn("[discharge] bed release:", bedErr.message);
      }

      try {
        const { data: invoiceIdRaw, error: compileErr } = await supabase.rpc("compile_discharge_invoice", {
          p_admission_id: admissionId,
        });
        if (compileErr) {
          console.error("[discharge] compile_discharge_invoice:", compileErr);
          toast.error(
            "Discharge saved, but the billing invoice could not be compiled automatically. You can complete billing separately.",
          );
        } else if (invoiceIdRaw != null && String(invoiceIdRaw).trim() !== "") {
          const idStr = String(invoiceIdRaw).trim();
          const { data: invRow, error: invFetchErr } = await supabase
            .from("invoices")
            .select("total_gross")
            .eq("id", idStr)
            .maybeSingle();
          if (invFetchErr) {
            console.warn("[discharge] invoice total_gross fetch:", invFetchErr);
          }
          const grossOk = invRow != null && !invFetchErr;
          const gross = numMoney(invRow?.total_gross);
          const title = grossOk
            ? `Discharge invoice compiled — ${formatInrCompact(gross)}`
            : "Discharge invoice compiled";
          toast.success(title, {
            action: {
              label: "View Invoice",
              onClick: () => router.push(`/billing/invoices?highlight=${encodeURIComponent(idStr)}`),
            },
          });
        }
      } catch (e) {
        console.error("[discharge] compile_discharge_invoice:", e);
        toast.error(
          "Discharge saved, but the billing invoice could not be compiled automatically. You can complete billing separately.",
        );
      }

      const bedEmb = asRec(admRow?.bed);
      const bedFromBundle = asRec(admissionBundle?.bed);
      const bedNum = s(bedEmb?.bed_number) || s(bedFromBundle?.bed_number) || "—";

      toast.success(`Patient discharged. Bed ${bedNum} now available.`);
      setPendingFinalize(false);
      onDischarged();
      onClose();
      router.push("/dashboard/ipd");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Finalize failed");
    } finally {
      setPhase("ready");
    }
  }, [runUpsert, onDischarged, onClose, router, form.dischargeDate, compiled?.admission, admissionBundle, admissionId]);

  const headerPatient = s(patient?.full_name ?? patient?.name);
  const uhid = s(patient?.uhid ?? patient?.mrn ?? patient?.patient_code);
  const ageGender = [s(patient?.age), s(patient?.gender)].filter(Boolean).join(" · ");
  const admNo = s(admission?.admission_number ?? admission?.id ?? admissionId).slice(0, 8);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/50" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        id={panelId}
        role="dialog"
        aria-modal
        className={modalPanelClass}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 flex-col border-b border-gray-200 bg-white">
          <div className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold text-gray-900">{headerPatient || "Patient"}</h2>
                {uhid ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    UHID {uhid}
                  </span>
                ) : null}
                {ageGender ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {ageGender}
                  </span>
                ) : null}
                <span className="text-xs text-gray-500">Adm. #{admNo}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Auto-compiled from IPD record — review before finalizing
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={saveDraftBtnClass}
                onClick={() => void handleSaveDraft()}
                disabled={phase === "loading"}
              >
                Save Draft
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={phase === "loading" || !canFinalize || phase === "finalizing"}
                onClick={handleFinalizeClick}
              >
                Finalize Discharge
              </Button>
              <button
                type="button"
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {pendingFinalize ? (
            <div className="border-t border-gray-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-medium text-amber-950">
                You are about to finalize and lock this discharge summary. This cannot be undone. The patient&apos;s admission
                will be marked as discharged.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={saveDraftBtnClass}
                  onClick={() => setPendingFinalize(false)}
                >
                  Go back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  onClick={() => void handleConfirmFinalize()}
                  disabled={phase === "finalizing"}
                >
                  Confirm &amp; Finalize
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {compileErr ? (
          <p className="border-b border-gray-200 bg-red-50 px-4 py-2 text-xs text-red-800">
            {compileErr}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {phase === "loading" ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <Collapsible
                title="Patient & Admission"
                open={openSec.patient}
                onToggle={() => toggle("patient")}
              >
                <dl className="grid grid-cols-1 gap-2 text-gray-900 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-gray-500">Admitted</dt>
                    <dd>{s(admission?.admission_date).slice(0, 10) || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Ward / Bed</dt>
                    <dd>{wardBedLabelFromAdmission(admission)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Admission type / class</dt>
                    <dd>
                      {[s(admission?.admission_type), s(admission?.admission_class)].filter(Boolean).join(" · ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Primary diagnosis (on admission)</dt>
                    <dd>{s(admission?.primary_diagnosis_display) || "—"}</dd>
                  </div>
                </dl>
              </Collapsible>

              <Collapsible
                title="Final Diagnosis"
                open={openSec.diagnosis}
                onToggle={() => toggle("diagnosis")}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className={labelClass}>Final diagnosis (SNOMED)</Label>
                    <button
                      type="button"
                      onClick={() => void handleExtractDiagnosesClick()}
                      disabled={isExtracting}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Extract diagnoses
                    </button>
                  </div>
                  {extractionError ? (
                    <p className="text-xs text-amber-700">{extractionError}</p>
                  ) : null}
                  {form.finalDiagnosisDisplay.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {form.finalDiagnosisDisplay.map((label, i) => (
                        <span key={`dx-${i}-${label}`} className={cn(DX_CHIP_WRAP, "items-center")}>
                          <span
                            className={DX_CHIP_MAIN}
                            title={
                              form.snomedAssessmentCodes[i]?.conceptId?.trim()
                                ? `SNOMED: ${form.snomedAssessmentCodes[i]!.conceptId}`
                                : "SNOMED optional"
                            }
                          >
                            <span className="min-w-0">
                              <DiagnosisWithIcd
                                text={label}
                                icd10={form.finalDiagnosisIcd10[i]?.trim() || null}
                              />
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => removeDiagnosisAt(i)}
                            className={DX_CHIP_REMOVE}
                            aria-label={`Remove ${label}`}
                          >
                            <span className="text-sm leading-none">×</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-[11px] text-gray-500">Search and add coded diagnoses</p>
                  <SnomedSearch
                    placeholder="Search diagnosis (SNOMED)…"
                    hierarchy="diagnosis"
                    allowFreeTextNoCode
                    ecl={SNOMED_ECL_CLINICAL_FINDING}
                    cacheFilter="finding_diagnosis"
                    conceptCacheType="finding"
                    value={diagnosisQuery}
                    onChange={setDiagnosisQuery}
                    onSelect={handleDxSelect}
                    indiaRefset={indiaRefset || undefined}
                    specialty={voiceSpecialty}
                    doctorId={practitionerId ?? undefined}
                  />
                </div>
              </Collapsible>

              <Collapsible
                title="Hospital Course Summary"
                open={openSec.course}
                onToggle={() => toggle("course")}
                titleActions={
                  <DischargeCompileAiButton
                    phase={aiCompilePhase}
                    disabled={notes.length === 0}
                    disabledTitle={notes.length === 0 ? "Add progress notes first" : undefined}
                    onClick={() => void handleCompileDischargeAi()}
                  />
                }
                headerRight={
                  isExtracting ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" aria-label="Extracting" />
                  ) : null
                }
              >
                <DischargeTextareaWithMic
                  fieldKey="hospitalCourseSummary"
                  rows={8}
                  placeholder="Summarize hospital course…"
                  specialty={voiceSpecialty}
                  doctorId={practitionerId}
                  value={form.hospitalCourseSummary}
                  onChange={(v) => setForm((f) => ({ ...f, hospitalCourseSummary: v }))}
                  recording={Boolean(isTranscribing.hospitalCourseSummary)}
                  showTranscribedBadge={transcribedFlash === "hospitalCourseSummary"}
                  onRecordingStateChange={(rec) => setFieldRecording("hospitalCourseSummary", rec)}
                  onMergedFinal={handleHospitalCourseMergedFinal}
                />
                <p className="text-xs text-gray-500">
                  Generate with AI from progress notes ({notes.length} day{notes.length === 1 ? "" : "s"}), or dictate and edit
                  freely.
                </p>
              </Collapsible>

              <Collapsible
                title="Investigations Summary"
                open={openSec.investigations}
                onToggle={() => toggle("investigations")}
                titleActions={
                  <DischargeCompileAiButton
                    phase={aiCompilePhase}
                    disabled={notes.length === 0}
                    disabledTitle={notes.length === 0 ? "Add progress notes first" : undefined}
                    onClick={() => void handleCompileDischargeAi()}
                  />
                }
              >
                <Textarea
                  rows={6}
                  value={form.investigationsSummary}
                  onChange={(e) => setForm((f) => ({ ...f, investigationsSummary: e.target.value }))}
                  placeholder="Trend-based summary of labs and imaging…"
                  className={cn(fieldBase, "min-h-[120px]")}
                />
                <p className="text-xs text-gray-500">
                  Populated with the same AI compile as hospital course. Edit freely.
                </p>
              </Collapsible>

              {surgeryData ? (
                <Collapsible
                  title="Surgical Procedure"
                  open={openSec.surgery}
                  onToggle={() => toggle("surgery")}
                >
                  <dl className="mb-3 grid gap-2 text-gray-900 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-gray-500">Procedure</dt>
                      <dd>{s(surgeryData.procedure_name ?? surgeryData.name)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Date</dt>
                      <dd>{s(surgeryData.surgery_date ?? surgeryData.scheduled_date).slice(0, 10) || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Anaesthesia</dt>
                      <dd>{s(surgeryData.anaesthesia_type)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-500">Surgeon</dt>
                      <dd>{s(surgeryData.surgeon_name)}</dd>
                    </div>
                  </dl>
                  <Label className={labelClass}>Procedure notes</Label>
                  <Textarea
                    className={cn("mt-1", fieldBase)}
                    rows={3}
                    value={form.procedureNotes}
                    onChange={(e) => setForm((f) => ({ ...f, procedureNotes: e.target.value }))}
                  />
                  <Label className={cn(labelClass, "mt-2 block")}>Implants</Label>
                  <Textarea
                    className={cn("mt-1", fieldBase)}
                    rows={2}
                    value={form.implantsUsedText}
                    onChange={(e) => setForm((f) => ({ ...f, implantsUsedText: e.target.value }))}
                  />
                </Collapsible>
              ) : null}

              <Collapsible
                title="Discharge Medications"
                open={openSec.meds}
                onToggle={() => toggle("meds")}
              >
                <div className="space-y-2">
                  {form.dischargeMedications.map((m) => (
                    <div
                      key={m.id}
                      className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-2 sm:grid-cols-6"
                    >
                      <Input
                        placeholder="Drug"
                        value={m.drugName}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            dischargeMedications: f.dischargeMedications.map((x) =>
                              x.id === m.id ? { ...x, drugName: e.target.value } : x,
                            ),
                          }))
                        }
                        className={cn(fieldBase, "sm:col-span-2")}
                      />
                      <Input
                        placeholder="Dose"
                        value={m.dose}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            dischargeMedications: f.dischargeMedications.map((x) =>
                              x.id === m.id ? { ...x, dose: e.target.value } : x,
                            ),
                          }))
                        }
                        className={fieldBase}
                      />
                      <Input
                        placeholder="Route"
                        value={m.route}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            dischargeMedications: f.dischargeMedications.map((x) =>
                              x.id === m.id ? { ...x, route: e.target.value } : x,
                            ),
                          }))
                        }
                        className={fieldBase}
                      />
                      <Input
                        placeholder="Frequency"
                        value={m.frequency}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            dischargeMedications: f.dischargeMedications.map((x) =>
                              x.id === m.id ? { ...x, frequency: e.target.value } : x,
                            ),
                          }))
                        }
                        className={fieldBase}
                      />
                      <div className="flex gap-1 sm:col-span-1">
                        <Input
                          placeholder="Duration"
                          value={m.duration}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              dischargeMedications: f.dischargeMedications.map((x) =>
                                x.id === m.id ? { ...x, duration: e.target.value } : x,
                              ),
                            }))
                          }
                          className={fieldBase}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-red-600"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              dischargeMedications: f.dischargeMedications.filter((x) => x.id !== m.id),
                            }))
                          }
                        >
                          ✕
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={saveDraftBtnClass}
                    onClick={() => setForm((f) => ({ ...f, dischargeMedications: [...f.dischargeMedications, newMedRow()] }))}
                  >
                    + Add drug
                  </Button>
                </div>
              </Collapsible>

              <Collapsible
                title="Discharge Instructions"
                open={openSec.instructions}
                onToggle={() => toggle("instructions")}
              >
                <div className="space-y-3">
                  <div>
                    <span className={cn(labelClass, "mb-1 block")}>Discharge condition</span>
                    <div className="flex flex-wrap gap-3">
                      {(["stable", "improved", "lama", "expired"] as const).map((v) => (
                        <label key={v} className={radioLabelClass}>
                          <input
                            type="radio"
                            name="dc"
                            checked={form.dischargeCondition === v}
                            onChange={() => setForm((f) => ({ ...f, dischargeCondition: v }))}
                            className="border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className={cn(labelClass, "mb-1 block")}>Discharge type</span>
                    <div className="flex flex-wrap gap-3">
                      {(["regular", "lama", "referral", "death"] as const).map((v) => (
                        <label key={v} className={radioLabelClass}>
                          <input
                            type="radio"
                            name="dt"
                            checked={form.dischargeType === v}
                            onChange={() => setForm((f) => ({ ...f, dischargeType: v }))}
                            className="border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className={labelClass}>Discharge date</Label>
                      <Input
                        type="date"
                        value={form.dischargeDate}
                        onChange={(e) => setForm((f) => ({ ...f, dischargeDate: e.target.value }))}
                        className={cn("mt-1", fieldBase)}
                      />
                    </div>
                    <div>
                      <Label className={labelClass}>Follow-up date</Label>
                      <Input
                        type="date"
                        value={form.followUpDate}
                        onChange={(e) => setForm((f) => ({ ...f, followUpDate: e.target.value }))}
                        className={cn("mt-1", fieldBase)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className={labelClass}>Diet advice</Label>
                    <div className="mt-1">
                      <DischargeTextareaWithMic
                        fieldKey="dietAdvice"
                        rows={2}
                        specialty={voiceSpecialty}
                        doctorId={practitionerId}
                        value={form.dietAdvice}
                        onChange={(v) => setForm((f) => ({ ...f, dietAdvice: v }))}
                        recording={Boolean(isTranscribing.dietAdvice)}
                        showTranscribedBadge={transcribedFlash === "dietAdvice"}
                        onRecordingStateChange={(rec) => setFieldRecording("dietAdvice", rec)}
                        onMergedFinal={() => setTranscribedFlash("dietAdvice")}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className={labelClass}>Activity restrictions</Label>
                    <div className="mt-1">
                      <DischargeTextareaWithMic
                        fieldKey="activityRestrictions"
                        rows={2}
                        specialty={voiceSpecialty}
                        doctorId={practitionerId}
                        value={form.activityRestrictions}
                        onChange={(v) => setForm((f) => ({ ...f, activityRestrictions: v }))}
                        recording={Boolean(isTranscribing.activityRestrictions)}
                        showTranscribedBadge={transcribedFlash === "activityRestrictions"}
                        onRecordingStateChange={(rec) => setFieldRecording("activityRestrictions", rec)}
                        onMergedFinal={() => setTranscribedFlash("activityRestrictions")}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className={labelClass}>Wound care</Label>
                    <div className="mt-1">
                      <DischargeTextareaWithMic
                        fieldKey="woundCareInstructions"
                        rows={2}
                        specialty={voiceSpecialty}
                        doctorId={practitionerId}
                        value={form.woundCareInstructions}
                        onChange={(v) => setForm((f) => ({ ...f, woundCareInstructions: v }))}
                        recording={Boolean(isTranscribing.woundCareInstructions)}
                        showTranscribedBadge={transcribedFlash === "woundCareInstructions"}
                        onRecordingStateChange={(rec) => setFieldRecording("woundCareInstructions", rec)}
                        onMergedFinal={() => setTranscribedFlash("woundCareInstructions")}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className={labelClass}>Post-op protocol</Label>
                    <div className="mt-1">
                      <DischargeTextareaWithMic
                        fieldKey="postOpProtocol"
                        rows={2}
                        specialty={voiceSpecialty}
                        doctorId={practitionerId}
                        value={form.postOpProtocol}
                        onChange={(v) => setForm((f) => ({ ...f, postOpProtocol: v }))}
                        recording={Boolean(isTranscribing.postOpProtocol)}
                        showTranscribedBadge={transcribedFlash === "postOpProtocol"}
                        onRecordingStateChange={(rec) => setFieldRecording("postOpProtocol", rec)}
                        onMergedFinal={() => setTranscribedFlash("postOpProtocol")}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className={labelClass}>Physiotherapy plan</Label>
                    <div className="mt-1">
                      <DischargeTextareaWithMic
                        fieldKey="physiotherapyPlan"
                        rows={2}
                        specialty={voiceSpecialty}
                        doctorId={practitionerId}
                        value={form.physiotherapyPlan}
                        onChange={(v) => setForm((f) => ({ ...f, physiotherapyPlan: v }))}
                        recording={Boolean(isTranscribing.physiotherapyPlan)}
                        showTranscribedBadge={transcribedFlash === "physiotherapyPlan"}
                        onRecordingStateChange={(rec) => setFieldRecording("physiotherapyPlan", rec)}
                        onMergedFinal={() => setTranscribedFlash("physiotherapyPlan")}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className={labelClass}>Additional discharge instructions</Label>
                    <div className="mt-1">
                      <DischargeTextareaWithMic
                        fieldKey="dischargeInstructions"
                        rows={2}
                        specialty={voiceSpecialty}
                        doctorId={practitionerId}
                        value={form.dischargeInstructions}
                        onChange={(v) => setForm((f) => ({ ...f, dischargeInstructions: v }))}
                        recording={Boolean(isTranscribing.dischargeInstructions)}
                        showTranscribedBadge={transcribedFlash === "dischargeInstructions"}
                        onRecordingStateChange={(rec) => setFieldRecording("dischargeInstructions", rec)}
                        onMergedFinal={() => setTranscribedFlash("dischargeInstructions")}
                      />
                    </div>
                  </div>
                </div>
              </Collapsible>

              <Collapsible
                title="When to seek urgent care (NABH AAC.13)"
                open={openSec.urgent}
                onToggle={() => toggle("urgent")}
              >
                <Textarea
                  rows={4}
                  value={form.urgentCareText}
                  onChange={(e) => setForm((f) => ({ ...f, urgentCareText: e.target.value }))}
                  className={cn(fieldBase)}
                />
              </Collapsible>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Collapsible({
  title,
  open,
  onToggle,
  children,
  headerRight,
  titleActions,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  headerRight?: ReactNode;
  titleActions?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="flex w-full items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-[13px] font-semibold uppercase tracking-wide text-gray-500">
            {title}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-gray-500 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {titleActions ? (
            <span
              className="flex items-center"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {titleActions}
            </span>
          ) : null}
          {headerRight}
        </div>
      </div>
      {open ? (
        <div className="space-y-3 bg-white px-4 py-4 text-sm text-gray-900">
          {children}
        </div>
      ) : null}
    </div>
  );
}
