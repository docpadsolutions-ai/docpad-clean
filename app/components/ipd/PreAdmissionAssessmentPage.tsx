"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, Mic, ScanLine } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { IPD_DEFAULT_HOSPITAL_ID } from "@/app/lib/ipdConstants";
import {
  type IpdPreAdmissionAssessmentInsert,
  insertIpdPreAdmissionAssessment,
  updateIpdPreAdmissionAssessment,
} from "@/app/lib/ipdData";
import {
  fetchOpdEncounterViaAdmissionChain,
  mapOpdEncounterToAssessmentDraft,
  pickEmbedded,
} from "@/app/lib/ipdPreAdmissionPrefill";
import AdmissionConsentChecklistModal from "@/app/components/ipd/AdmissionConsentChecklistModal";
import SystemicExaminationSection from "@/app/components/ipd/systemic-examination-section";
import { IpdTreatmentsTable } from "@/app/components/ipd/IpdTreatmentsTable";
import VoiceDictationButton, { type ClinicalFinding } from "@/app/components/VoiceDictationButton";
import {
  GEMINI_SCREEN_CONTEXT_PRE_ADMISSION,
} from "@/app/lib/voiceScreenContexts";
import { readIndiaRefsetKeyFromEnv } from "@/app/lib/snomedUiConfig";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SNOMED_INDIA = readIndiaRefsetKeyFromEnv();

/** Display label for assessment metadata row (matches Figma reference hospital name). */
const ASSESSMENT_HOSPITAL_DISPLAY = "OrthoCare Hospital";

const fieldBase =
  "border-0 border-b border-gray-200 rounded-none bg-transparent placeholder:text-gray-400 focus:border-blue-500 focus:ring-0 focus-visible:ring-0 text-gray-900 text-sm shadow-none";
const textareaBase =
  "border-0 border-b border-gray-200 rounded-none bg-transparent placeholder:text-gray-400 focus:border-blue-500 focus:ring-0 focus-visible:ring-0 text-gray-900 text-sm min-h-[80px] resize-none shadow-none";

const iconBtn =
  "inline-flex shrink-0 items-center justify-center p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function intOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function floatOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function computeBmi(heightCmStr: string, weightKgStr: string): number | null {
  const h = floatOrNull(heightCmStr);
  const w = floatOrNull(weightKgStr);
  if (h == null || w == null || h <= 0) return null;
  const m = h / 100;
  const b = w / (m * m);
  return Math.round(b * 10) / 10;
}

/** Postgres `text[]` (and similar) — Supabase expects native JS arrays, never JSON strings. */
function stringArrayFromFormField(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const j = JSON.parse(t) as unknown;
      if (Array.isArray(j)) return j.map((x) => str(x)).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toggleSet<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

type Opqrst = {
  onset: string;
  provocation: string;
  palliation: string;
  quality: string;
  region: string;
  severityNow: string;
  severityWorst: string;
  severityBaseline: string;
  timing: string;
  associated: string;
  negatives: string;
};

const emptyOpqrst = (): Opqrst => ({
  onset: "",
  provocation: "",
  palliation: "",
  quality: "",
  region: "",
  severityNow: "",
  severityWorst: "",
  severityBaseline: "",
  timing: "",
  associated: "",
  negatives: "",
});

const SPECIALTIES = [
  "Orthopedic Surgery",
  "General Medicine",
  "General Surgery",
  "Cardiology",
  "Neurology",
  "Nephrology",
  "Pulmonology",
  "Other",
];

/** Figma: blue circle “S”, emerald circle “O”, purple rounded badge “A/P”. */
type SoapVisual = "subjective" | "objective" | "ap";

function SoapBadge({ visual }: { visual: SoapVisual }) {
  if (visual === "ap") {
    return (
      <span
        className="inline-flex h-9 min-w-[2.75rem] shrink-0 items-center justify-center rounded-lg bg-violet-600 px-2 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm ring-1 ring-violet-950/10"
        aria-hidden
      >
        A/P
      </span>
    );
  }
  if (visual === "subjective") {
    return (
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white shadow-sm ring-1 ring-blue-900/10"
        aria-hidden
      >
        S
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white shadow-sm ring-1 ring-emerald-900/10"
      aria-hidden
    >
      O
    </span>
  );
}

function FigmaChip({ selected, children, onClick }: { selected: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2",
        selected
          ? "bg-blue-50 border-blue-500 text-blue-700 font-medium"
          : "border-gray-200 text-gray-500 hover:border-blue-400",
      )}
    >
      {children}
    </button>
  );
}

type SectionKey =
  | "specialty"
  | "cc"
  | "hpi"
  | "symptom"
  | "ros"
  | "context"
  | "vitals"
  | "exam"
  | "ap";

function CollapsibleSoapSection({
  sectionKey,
  expanded,
  onToggle,
  complete,
  soap,
  sectionLabel,
  title,
  subtitle,
  children,
}: {
  sectionKey: SectionKey;
  expanded: boolean;
  onToggle: () => void;
  complete: boolean;
  soap: SoapVisual;
  /** Figma: uppercase micro-label (hidden when empty — e.g. Assessment & Plan uses badge + title only). */
  sectionLabel?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={expanded}
        aria-controls={`section-${sectionKey}`}
      >
        <span className="mt-1 text-gray-400" aria-hidden>
          {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </span>
        <SoapBadge visual={soap} />
        <div className="min-w-0 flex-1">
          {sectionLabel ? (
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{sectionLabel}</p>
          ) : null}
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p> : null}
        </div>
        {complete ? (
          <span className="mt-1 shrink-0" title="Section complete">
            <Check className="h-5 w-5 text-emerald-500" strokeWidth={2.5} aria-hidden />
          </span>
        ) : (
          <span className="w-5 shrink-0" aria-hidden />
        )}
      </button>
      {expanded ? (
        <div id={`section-${sectionKey}`} className="mt-6 space-y-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function TextareaWithVoice({
  value,
  onChange,
  interim,
  onInterim,
  rows,
  placeholder,
  contextType,
  specialty,
  doctorId,
  encounterId,
  onExtractionComplete,
  minHeightClass,
  actionsRight,
  geminiScreenContextAppend,
}: {
  value: string;
  onChange: (v: string) => void;
  interim: string;
  onInterim: (v: string) => void;
  rows: number;
  placeholder?: string;
  contextType: string;
  specialty: string;
  doctorId?: string;
  encounterId?: string;
  onExtractionComplete?: (payload: unknown) => void;
  minHeightClass?: string;
  /** Extra icon buttons (e.g. copy) shown next to mic */
  actionsRight?: ReactNode;
  /** Appended to Gemini system prompt for complaint/examination STT pipeline (same as OPD). */
  geminiScreenContextAppend?: string;
}) {
  const display = interim ? `${value}${value && interim ? "\n" : ""}${interim}` : value;
  return (
    <div className="relative">
      <Textarea
        value={display}
        readOnly={!!interim}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={cn(textareaBase, "pr-24", minHeightClass)}
      />
      <div className="absolute right-0 top-0 flex items-center gap-0.5">
        <VoiceDictationButton
          contextType={contextType}
          specialty={specialty}
          doctorId={doctorId}
          encounterId={encounterId}
          indiaRefset={SNOMED_INDIA ?? undefined}
          geminiScreenContextAppend={geminiScreenContextAppend}
          onTranscriptUpdate={(text, isFinal) => {
            if (isFinal) {
              if (text.trim()) onChange(value + (value.trim() ? "\n" : "") + text.trim());
              onInterim("");
            } else {
              onInterim(text);
            }
          }}
          onExtractionComplete={onExtractionComplete}
          className={cn(iconBtn, "h-9 w-9 p-2")}
        />
        {actionsRight}
      </div>
    </div>
  );
}

function InputWithVoice({
  value,
  onChange,
  interim,
  onInterim,
  placeholder,
  contextType,
  specialty,
  doctorId,
  encounterId,
  geminiScreenContextAppend,
}: {
  value: string;
  onChange: (v: string) => void;
  interim: string;
  onInterim: (v: string) => void;
  placeholder?: string;
  contextType: string;
  specialty: string;
  doctorId?: string;
  encounterId?: string;
  geminiScreenContextAppend?: string;
}) {
  const display = interim ? `${value}${interim}` : value;
  return (
    <div className="relative">
      <Input
        value={display}
        readOnly={!!interim}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldBase, "h-10 pr-14")}
      />
      <div className="absolute right-0 top-0">
        <VoiceDictationButton
          contextType={contextType}
          specialty={specialty}
          doctorId={doctorId}
          encounterId={encounterId}
          indiaRefset={SNOMED_INDIA ?? undefined}
          geminiScreenContextAppend={geminiScreenContextAppend}
          onTranscriptUpdate={(text, isFinal) => {
            if (isFinal) {
              if (text.trim()) onChange(value + (value.trim() ? " " : "") + text.trim());
              onInterim("");
            } else {
              onInterim(text);
            }
          }}
          className={cn(iconBtn, "h-9 w-9 p-2")}
        />
      </div>
    </div>
  );
}

export default function PreAdmissionAssessmentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlEncounterId = str(searchParams.get("encounterId"));
  const urlAdmissionId = str(searchParams.get("admissionId"));

  const [encounterId, setEncounterId] = useState(urlEncounterId);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [patientId, setPatientId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [practitionerDisplayName, setPractitionerDisplayName] = useState("Clinician");
  const [voiceSpecialty, setVoiceSpecialty] = useState("General Medicine");
  const [patientName, setPatientName] = useState("Patient");
  const [patientAgeYears, setPatientAgeYears] = useState<number | null>(null);
  const [patientSex, setPatientSex] = useState<string | null>(null);
  const [docpadId, setDocpadId] = useState<string | null>(null);

  const [specialty, setSpecialty] = useState("Orthopedic Surgery");

  const [chiefComplaint, setChiefComplaint] = useState("");
  const [ccInterim, setCcInterim] = useState("");
  const [ccOnset, setCcOnset] = useState<"" | "sudden" | "gradual" | "insidious">("");
  const [ccSetting, setCcSetting] = useState(new Set<"OPD" | "ER" | "IPD" | "Tele">());
  const [ccSource, setCcSource] = useState(new Set<"Patient" | "Relative" | "Records">());
  const [ccReliability, setCcReliability] = useState<"" | "good" | "fair" | "poor">("");
  const [durationAmt, setDurationAmt] = useState("");
  const [durationUnit, setDurationUnit] = useState<"days" | "weeks" | "months" | "years">("weeks");
  const [ccEnteredAt] = useState(() => new Date());

  const [hpiOneLiner, setHpiOneLiner] = useState("");
  const [hpi1Interim, setHpi1Interim] = useState("");
  const [hpiNarrative, setHpiNarrative] = useState("");
  const [hpiNInterim, setHpiNInterim] = useState("");
  const [symptomCategory, setSymptomCategory] = useState("");
  const [opqrst, setOpqrst] = useState<Opqrst>(emptyOpqrst);
  const [rosAllNegative, setRosAllNegative] = useState(false);
  const [pmh, setPmh] = useState("");
  const [currentMedsRaw, setCurrentMedsRaw] = useState("");
  const [allergiesCtx, setAllergiesCtx] = useState("");
  const [riskFactors, setRiskFactors] = useState("");
  const [chiefComplaintDetailsText, setChiefComplaintDetailsText] = useState("");
  const [ccDetailsInterim, setCcDetailsInterim] = useState("");
  const [rosPositiveFindings, setRosPositiveFindings] = useState("");
  const [rosPosInterim, setRosPosInterim] = useState("");
  const [opqrstInterim, setOpqrstInterim] = useState<Partial<Record<keyof Opqrst, string>>>({});
  const [pmhInterim, setPmhInterim] = useState("");
  const [medsInterim, setMedsInterim] = useState("");
  const [allergiesInterim, setAllergiesInterim] = useState("");
  const [riskInterim, setRiskInterim] = useState("");
  const [treatmentPlanNotes, setTreatmentPlanNotes] = useState("");
  const [treatmentPlanInterim, setTreatmentPlanInterim] = useState("");
  const [preOpNotes, setPreOpNotes] = useState("");
  const [preOpInterim, setPreOpInterim] = useState("");
  const [localExamination, setLocalExamination] = useState("");
  const [localExamInterim, setLocalExamInterim] = useState("");
  const [systemicVoiceInterim, setSystemicVoiceInterim] = useState<Record<string, string>>({});

  const [vitals, setVitals] = useState({
    hr: "",
    bpSys: "",
    bpDia: "",
    rr: "",
    temp: "",
    spo2: "",
    heightCm: "",
    weightKg: "",
  });
  const [examTab, setExamTab] = useState<"general" | "systemic">("general");
  const [generalAppearance, setGeneralAppearance] = useState("");
  const [gaInterim, setGaInterim] = useState("");
  const [systemicExam, setSystemicExam] = useState<Record<string, Record<string, unknown>>>({});
  const [loadedSystemIds, setLoadedSystemIds] = useState<string[]>([]);

  const updateSystemicExam = useCallback((systemId: string, field: string, value: unknown) => {
    setSystemicExam((prev) => ({
      ...prev,
      [systemId]: { ...(prev[systemId] ?? {}), [field]: value },
    }));
  }, []);

  const [surgicalPlanNotes, setSurgicalPlanNotes] = useState("");
  const [surgicalPlanInterim, setSurgicalPlanInterim] = useState("");
  const [primaryDxIcd10, setPrimaryDxIcd10] = useState("");
  const [primaryDxDisplay, setPrimaryDxDisplay] = useState("");
  const [primaryDxMarked, setPrimaryDxMarked] = useState(false);
  const [apNotes, setApNotes] = useState("");
  const [apNotesInterim, setApNotesInterim] = useState("");
  const [treatmentFilter, setTreatmentFilter] = useState<"medical" | "surgical" | "mixed">("mixed");
  const [treatmentRows, setTreatmentRows] = useState<Record<string, unknown>[]>([]);

  const [preAdmissionId, setPreAdmissionId] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [prefillBanner, setPrefillBanner] = useState<{ show: boolean; dateLabel: string }>({
    show: false,
    dateLabel: "",
  });
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    specialty: true,
    cc: true,
    hpi: true,
    symptom: true,
    ros: true,
    context: true,
    vitals: true,
    exam: true,
    ap: true,
  });

  const toggleSection = useCallback((k: SectionKey) => {
    setExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  const medChips = useMemo(() => {
    return currentMedsRaw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [currentMedsRaw]);

  const diagnosisLine = useMemo(() => primaryDxDisplay || "—", [primaryDxDisplay]);

  const specialtyOptions = useMemo(() => {
    const s = new Set(SPECIALTIES);
    if (specialty && !s.has(specialty)) return [specialty, ...SPECIALTIES];
    return SPECIALTIES;
  }, [specialty]);

  /**
   * Persist only columns on `ipd_pre_admission_assessments` (see `ipdPreAdmissionAssessmentColumns.ts`).
   * OPQRST lives under `symptoms_json`; vitals are flat columns — not `symptoms_opqrst` / `ros_json` / `vital_signs`.
   */
  const buildInsertPayload = useCallback((): IpdPreAdmissionAssessmentInsert => {
    const durationLabel =
      durationAmt.trim() !== ""
        ? `${durationAmt.trim()} ${durationUnit}`
        : "";
    const catDefault =
      symptomCategory.trim() ||
      (/orthop/i.test(specialty) ? "Musculoskeletal" : "");
    const opqrstAny = (Object.keys(opqrst) as (keyof Opqrst)[]).some((k) => str(opqrst[k]) !== "");
    const symptomsJson = (() => {
      if (!catDefault && !opqrstAny) return [];
      const row: Record<string, unknown> = {};
      if (catDefault) row.category = catDefault;
      if (opqrstAny) row.opqrst = opqrst;
      return [row];
    })();

    const systemicExamStr = (() => {
      const hasStructured =
        loadedSystemIds.length > 0 ||
        Object.keys(systemicExam).some((k) => Object.keys(systemicExam[k] ?? {}).length > 0);
      if (!hasStructured) return null;
      return JSON.stringify({
        physical_examination: { systemic: systemicExam },
        loaded_system_ids: loadedSystemIds,
      });
    })();

    return {
      hospital_id: IPD_DEFAULT_HOSPITAL_ID,
      opd_encounter_id: encounterId,
      patient_id: patientId,
      practitioner_id: practitionerId || null,
      status: "draft",
      specialty: specialty || null,
      chief_complaint: chiefComplaint || null,
      chief_complaint_onset: ccOnset || null,
      chief_complaint_duration: durationLabel || null,
      chief_complaint_details: {
        duration: { value: durationAmt, unit: durationUnit, label: durationLabel },
        ...(chiefComplaintDetailsText.trim() ? { narrative: chiefComplaintDetailsText.trim() } : {}),
      },
      setting: Array.from(ccSetting),
      source_reliability: {
        sources: Array.from(ccSource),
        reliability: ccReliability || null,
      },
      hpi_one_liner: hpiOneLiner || null,
      hpi_narrative: hpiNarrative || null,
      symptoms_json: symptomsJson,
      ros_all_negative: rosAllNegative,
      ros_positive_findings: rosPositiveFindings.trim() || null,
      pmh_text: pmh || null,
      current_medications: medChips,
      allergies_text: allergiesCtx || null,
      risk_factors: stringArrayFromFormField(riskFactors),
      heart_rate: intOrNull(vitals.hr),
      bp_systolic: intOrNull(vitals.bpSys),
      bp_diastolic: intOrNull(vitals.bpDia),
      respiratory_rate: intOrNull(vitals.rr),
      temperature_f: floatOrNull(vitals.temp),
      spo2: floatOrNull(vitals.spo2),
      weight_kg: floatOrNull(vitals.weightKg),
      bmi: computeBmi(vitals.heightCm, vitals.weightKg),
      general_appearance: generalAppearance || null,
      systemic_examination: systemicExamStr,
      local_examination: localExamination.trim() || null,
      surgical_plan_notes: surgicalPlanNotes || null,
      treatment_plan_notes: treatmentPlanNotes.trim() || null,
      pre_op_notes: preOpNotes.trim() || null,
      primary_diagnosis_icd10: primaryDxIcd10 || null,
      primary_diagnosis_display: primaryDxDisplay || null,
      assessment_plan_notes: apNotes || null,
      treatments_json: treatmentRows,
    };
  }, [
    allergiesCtx,
    apNotes,
    ccOnset,
    ccReliability,
    ccSetting,
    ccSource,
    chiefComplaint,
    chiefComplaintDetailsText,
    durationAmt,
    durationUnit,
    encounterId,
    generalAppearance,
    hpiNarrative,
    hpiOneLiner,
    medChips,
    opqrst,
    patientId,
    pmh,
    practitionerId,
    primaryDxDisplay,
    primaryDxIcd10,
    riskFactors,
    rosAllNegative,
    rosPositiveFindings,
    specialty,
    surgicalPlanNotes,
    treatmentPlanNotes,
    preOpNotes,
    localExamination,
    symptomCategory,
    loadedSystemIds,
    systemicExam,
    treatmentRows,
    vitals,
  ]);

  const payloadFingerprint = useMemo(() => JSON.stringify(buildInsertPayload()), [buildInsertPayload]);
  const debouncedFingerprint = useDebouncedValue(payloadFingerprint, 3500);

  useEffect(() => {
    if (!urlEncounterId && !urlAdmissionId) {
      setLoading(false);
      setLoadErr("Add ?encounterId=… or ?admissionId=… to the URL.");
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadErr(null);
      setPrefillBanner({ show: false, dateLabel: "" });

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      let practitionerSpecialty = "";
      if (user) {
        const { data: prof } = await supabase
          .from("practitioners")
          .select("id, specialty, first_name, last_name")
          .eq("user_id", user.id)
          .maybeSingle();
        if (prof?.id) setPractitionerId(String(prof.id));
        practitionerSpecialty = (prof as { specialty?: string | null } | null)?.specialty?.trim() ?? "";
        const fn = str((prof as { first_name?: unknown } | null)?.first_name);
        const ln = str((prof as { last_name?: unknown } | null)?.last_name);
        const name = [fn, ln].filter(Boolean).join(" ");
        if (name) setPractitionerDisplayName(name);
      }

      let enc: Record<string, unknown> | null = null;
      let fromAdmissionPrefill = false;
      let bannerDate = "";

      if (urlAdmissionId) {
        const chain = await fetchOpdEncounterViaAdmissionChain(supabase, urlAdmissionId);
        if (chain.error) {
          setLoadErr(chain.error.message);
          setLoading(false);
          return;
        }
        if (!chain.encounter || !chain.encounterId) {
          setPrefillBanner({ show: false, dateLabel: "" });
          setLoading(false);
          return;
        }
        enc = chain.encounter;
        setEncounterId(chain.encounterId);
        fromAdmissionPrefill = true;
        bannerDate = chain.prefillBannerDate;
      } else {
        const { data: row, error } = await supabase
          .from("opd_encounters")
          .select(
            `
            *,
            patient:patients!patient_id(*)
          `,
          )
          .eq("id", urlEncounterId)
          .maybeSingle();
        if (error || !row) {
          setLoadErr(error?.message ?? "Encounter not found.");
          setLoading(false);
          return;
        }
        enc = row as Record<string, unknown>;
        setEncounterId(urlEncounterId);
      }

      const draft = mapOpdEncounterToAssessmentDraft(enc);
      setChiefComplaint(draft.chiefComplaint);
      setCcOnset(draft.ccOnset);
      setCcSetting(new Set(draft.ccSetting));
      setCcSource(new Set(draft.ccSource));
      setCcReliability(draft.ccReliability);
      const du = draft.durationUnit;
      setDurationAmt(draft.durationAmt);
      setDurationUnit(du === "days" || du === "weeks" || du === "months" || du === "years" ? du : "weeks");
      setHpiOneLiner(draft.hpiOneLiner);
      setHpiNarrative(draft.hpiNarrative);
      setSymptomCategory(draft.symptomCategory);
      setOpqrst({ ...emptyOpqrst(), ...draft.opqrst });
      setRosAllNegative(draft.rosAllNegative);
      setVitals(
        Object.assign(
          { hr: "", bpSys: "", bpDia: "", rr: "", temp: "", spo2: "", heightCm: "", weightKg: "" },
          draft.vitals,
        ),
      );
      setPrimaryDxDisplay(draft.primaryDxDisplay);
      setPrimaryDxIcd10(draft.primaryDxIcd10);

      const specUse = draft.specialty || practitionerSpecialty;
      if (specUse) {
        setSpecialty(specUse);
        setVoiceSpecialty(specUse);
      }

      const pid = str(enc.patient_id);
      setPatientId(pid);
      const p = pickEmbedded(enc.patient as Record<string, unknown> | null);
      if (p) {
        setPatientName(str(p.full_name) || "Patient");
        const age = p.age_years;
        setPatientAgeYears(age != null && age !== "" ? Number(age) : null);
        setPatientSex(str(p.sex) || null);
        setDocpadId(str(p.docpad_id) || null);
      }

      if (fromAdmissionPrefill) {
        setPrefillBanner({ show: true, dateLabel: bannerDate });
      }

      setLoading(false);
    })();
  }, [urlAdmissionId, urlEncounterId]);

  const persistAssessment = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!patientId || !encounterId) {
        if (!opts.silent) setSaveErr("Patient or encounter not loaded.");
        return false;
      }
      if (!opts.silent) {
        setSaveBusy(true);
        setSaveErr(null);
      }
      try {
        const payload = buildInsertPayload();
        if (preAdmissionId) {
          const { error } = await updateIpdPreAdmissionAssessment(supabase, preAdmissionId, payload);
          if (error) {
            if (!opts.silent) setSaveErr(error.message);
            return false;
          }
        } else {
          const { id, error } = await insertIpdPreAdmissionAssessment(supabase, payload);
          if (error || !id) {
            if (!opts.silent) setSaveErr(error?.message ?? "Save failed");
            return false;
          }
          setPreAdmissionId(id);
        }
        setLastSavedAt(new Date());
        return true;
      } finally {
        if (!opts.silent) setSaveBusy(false);
      }
    },
    [buildInsertPayload, encounterId, patientId, preAdmissionId],
  );

  useEffect(() => {
    if (!preAdmissionId || !patientId || !encounterId || !practitionerId) return;
    void (async () => {
      const { error } = await updateIpdPreAdmissionAssessment(supabase, preAdmissionId, buildInsertPayload());
      if (!error) setLastSavedAt(new Date());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debouncedFingerprint drives idle saves
  }, [debouncedFingerprint]);

  const handleSaveDraft = useCallback(async () => {
    await persistAssessment({ silent: false });
  }, [persistAssessment]);

  const handleCompleteAssessment = useCallback(async () => {
    const ok = await persistAssessment({ silent: false });
    if (ok) setConsentOpen(true);
  }, [persistAssessment]);

  const addTreatmentRow = useCallback(() => {
    const ymd = new Date().toISOString().slice(0, 10);
    setTreatmentRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        treatment_date: ymd,
        kind: "medical",
        name: "",
        dose_details: "",
        route_frequency: "",
        days: "",
        status: "planned",
        ordering_clinician: "",
      },
    ]);
  }, []);

  const handleCcExtraction = useCallback((raw: unknown) => {
    const findings = raw as ClinicalFinding[];
    if (!Array.isArray(findings) || findings.length === 0) return;
    const line = findings.map((f) => f.finding).filter(Boolean).join("; ");
    if (line) setChiefComplaint((p) => (p.trim() ? `${p.trim()}\n${line}` : line));
  }, []);

  const vitalsAny = useMemo(
    () =>
      Boolean(
        vitals.hr.trim() ||
          vitals.bpSys.trim() ||
          vitals.bpDia.trim() ||
          vitals.rr.trim() ||
          vitals.temp.trim() ||
          vitals.spo2.trim(),
      ),
    [vitals],
  );

  const opqrstAny = useMemo(
    () => (Object.keys(opqrst) as (keyof Opqrst)[]).some((k) => str(opqrst[k]) !== ""),
    [opqrst],
  );

  const completion = useMemo(
    () => ({
      specialty: Boolean(specialty.trim()),
      cc:
        Boolean(chiefComplaint.trim()) &&
        Boolean(ccOnset) &&
        Boolean(ccReliability) &&
        ccSetting.size > 0 &&
        ccSource.size > 0,
      hpi: Boolean(hpiOneLiner.trim()) || Boolean(hpiNarrative.trim()),
      symptom: Boolean(symptomCategory.trim()) || opqrstAny,
      ros: rosAllNegative || Boolean(rosPositiveFindings.trim()),
      context: Boolean(pmh.trim() || currentMedsRaw.trim() || allergiesCtx.trim() || riskFactors.trim()),
      vitals: vitalsAny,
      exam:
        Boolean(generalAppearance.trim()) ||
        Boolean(localExamination.trim()) ||
        loadedSystemIds.length > 0 ||
        Object.keys(systemicExam).some((id) => Object.keys(systemicExam[id] ?? {}).length > 0),
      ap: Boolean(primaryDxDisplay.trim()) && Boolean(primaryDxIcd10.trim()),
    }),
    [
      specialty,
      chiefComplaint,
      ccOnset,
      ccReliability,
      ccSetting.size,
      ccSource.size,
      hpiOneLiner,
      hpiNarrative,
      symptomCategory,
      opqrstAny,
      rosAllNegative,
      rosPositiveFindings,
      pmh,
      currentMedsRaw,
      allergiesCtx,
      riskFactors,
      vitalsAny,
      generalAppearance,
      localExamination,
      loadedSystemIds,
      systemicExam,
      primaryDxDisplay,
      primaryDxIcd10,
    ],
  );

  const fmtFooter = useMemo(() => {
    const d = ccEnteredAt;
    return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} • ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }, [ccEnteredAt]);

  const assessmentTreatmentsMeta = useMemo(() => {
    const d = new Date();
    const dateStr = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return `Complete Assessment • ${ASSESSMENT_HOSPITAL_DISPLAY} • ${dateStr}`;
  }, []);

  if (!urlEncounterId && !urlAdmissionId) {
    return (
      <div className="min-h-[50vh] p-6">
        <p className="text-sm text-muted-foreground">
          Add{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">?encounterId=…</code> or{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">?admissionId=…</code> to the URL.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
        Loading encounter…
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="min-h-[50vh] p-6">
        <p className="text-sm text-red-600">{loadErr}</p>
        <Link href="/dashboard/opd" className="mt-4 inline-block text-sm text-blue-600 underline-offset-4 hover:underline">
          Back to OPD
        </Link>
      </div>
    );
  }

  const pillActive = "bg-blue-600 text-white rounded-full px-4 py-1.5 text-sm font-medium shadow-sm";
  const pillInactive =
    "border border-gray-200 bg-white text-gray-500 rounded-full px-4 py-1.5 text-sm hover:border-gray-300 hover:bg-gray-50";

  return (
    <div className="min-h-screen bg-[#F4F6F8] pb-28">
      <header className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">IPD</p>
            <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Complete admission assessment</h1>
            <Link
              href={`/dashboard/opd/encounter/${encounterId}`}
              className="mt-1 inline-flex text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
            >
              ← Back to OPD encounter
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {prefillBanner.show ? (
          <div
            className="flex gap-2 rounded-2xl border border-gray-100 bg-white px-3 py-2.5 text-sm text-gray-600 shadow-sm"
            role="status"
          >
            <span aria-hidden className="shrink-0">
              ℹ️
            </span>
            <span>
              {prefillBanner.dateLabel
                ? `Pre-filled from OPD encounter on ${prefillBanner.dateLabel}. All fields editable.`
                : "Pre-filled from OPD encounter. All fields editable."}
            </span>
          </div>
        ) : null}
        {saveErr ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{saveErr}</p>
        ) : null}
        {!practitionerId ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-gray-800">
            No practitioner row for your account (
            <code className="rounded bg-white px-1 py-0.5 text-[11px]">practitioners.user_id</code>). Save and admission
            require a linked practitioner profile.
          </p>
        ) : null}

        <CollapsibleSoapSection
          sectionKey="specialty"
          expanded={expanded.specialty}
          onToggle={() => toggleSection("specialty")}
          complete={completion.specialty}
          soap="subjective"
          sectionLabel="Subjective"
          title="Specialty"
          subtitle="Clinical service line for this admission."
        >
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">Select specialty</p>
            <div className="flex flex-wrap gap-2">
              {specialtyOptions.map((s) => (
                <FigmaChip key={s} selected={specialty === s} onClick={() => { setSpecialty(s); setVoiceSpecialty(s); }}>
                  {s}
                </FigmaChip>
              ))}
            </div>
          </div>
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="cc"
          expanded={expanded.cc}
          onToggle={() => toggleSection("cc")}
          complete={completion.cc}
          soap="subjective"
          sectionLabel="Subjective"
          title="Chief complaint"
          subtitle="Chief complaint, history, and patient context."
        >
          <div>
            <Label className="mb-2 block text-xs font-medium text-gray-500">
              CC (patient&apos;s words) <span className="text-red-500">*</span>
            </Label>
            <TextareaWithVoice
              value={chiefComplaint}
              onChange={setChiefComplaint}
              interim={ccInterim}
              onInterim={setCcInterim}
              rows={4}
              placeholder="Patient&apos;s words…"
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              onExtractionComplete={handleCcExtraction}
              minHeightClass="min-h-[60px]"
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>

          <div>
            <Label className="mb-2 block text-xs font-medium text-gray-500">Chief complaint details</Label>
            <TextareaWithVoice
              value={chiefComplaintDetailsText}
              onChange={setChiefComplaintDetailsText}
              interim={ccDetailsInterim}
              onInterim={setCcDetailsInterim}
              rows={3}
              placeholder="Additional CC context, qualifiers, patient wording…"
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              minHeightClass="min-h-[60px]"
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>

          <div className="space-y-4 pt-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">Onset</p>
              <div className="flex flex-wrap gap-2">
                {(["sudden", "gradual", "insidious"] as const).map((k) => (
                  <FigmaChip key={k} selected={ccOnset === k} onClick={() => setCcOnset((c) => (c === k ? "" : k))}>
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </FigmaChip>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">Duration</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={durationAmt}
                    onChange={(e) => setDurationAmt(e.target.value)}
                    className={cn(fieldBase, "w-[60px]")}
                    placeholder="0"
                  />
                  {(["days", "weeks", "months", "years"] as const).map((u) => (
                    <FigmaChip key={u} selected={durationUnit === u} onClick={() => setDurationUnit(u)}>
                      {u}
                    </FigmaChip>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">Setting</p>
              <div className="flex flex-wrap gap-2">
                {(["OPD", "ER", "IPD", "Tele"] as const).map((k) => (
                  <FigmaChip key={k} selected={ccSetting.has(k)} onClick={() => setCcSetting((s) => toggleSet(s, k))}>
                    {k}
                  </FigmaChip>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">Source</p>
              <div className="flex flex-wrap gap-2">
                {(["Patient", "Relative", "Records"] as const).map((k) => (
                  <FigmaChip key={k} selected={ccSource.has(k)} onClick={() => setCcSource((s) => toggleSet(s, k))}>
                    {k}
                  </FigmaChip>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">Reliability</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["good", "Good"],
                    ["fair", "Fair"],
                    ["poor", "Poor"],
                  ] as const
                ).map(([k, lab]) => (
                  <FigmaChip key={k} selected={ccReliability === k} onClick={() => setCcReliability((c) => (c === k ? "" : k))}>
                    {lab}
                  </FigmaChip>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Entered by {practitionerDisplayName} • {fmtFooter}
          </p>
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="hpi"
          expanded={expanded.hpi}
          onToggle={() => toggleSection("hpi")}
          complete={completion.hpi}
          soap="subjective"
          sectionLabel="Subjective"
          title="History of present illness (HPI)"
        >
          <div>
            <Label className="mb-2 block text-xs font-medium text-gray-500">One-liner</Label>
            <InputWithVoice
              value={hpiOneLiner}
              onChange={setHpiOneLiner}
              interim={hpi1Interim}
              onInterim={setHpi1Interim}
              placeholder="Single-line summary…"
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>
          <div>
            <Label className="mb-2 block text-xs font-medium text-gray-500">HPI narrative (chronological)</Label>
            <TextareaWithVoice
              value={hpiNarrative}
              onChange={setHpiNarrative}
              interim={hpiNInterim}
              onInterim={setHpiNInterim}
              rows={6}
              placeholder="Expanded HPI…"
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              minHeightClass="min-h-[120px]"
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
              actionsRight={
                <button
                  type="button"
                  className={iconBtn}
                  title="Copy narrative"
                  onClick={() => {
                    void navigator.clipboard.writeText(hpiNarrative);
                  }}
                >
                  <ClipboardCopy className="h-4 w-4" aria-hidden />
                </button>
              }
            />
          </div>
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="symptom"
          expanded={expanded.symptom}
          onToggle={() => toggleSection("symptom")}
          complete={completion.symptom}
          soap="subjective"
          sectionLabel="Subjective"
          title="Symptom characterization"
          subtitle="OPQRST — structured symptom review."
        >
          {/* TODO: dynamic fields (Haiku API) */}
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
              Symptom category (optional)
            </Label>
            <Input
              value={symptomCategory}
              onChange={(e) => setSymptomCategory(e.target.value)}
              placeholder="e.g. Musculoskeletal"
              className={cn(fieldBase, "max-w-lg")}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(Object.keys(opqrst) as (keyof Opqrst)[]).map((k) => (
              <div key={k} className="space-y-1">
                <Label className="text-xs capitalize text-gray-500">
                  {k.replace(/([A-Z])/g, " $1").trim()}
                </Label>
                <InputWithVoice
                  value={opqrst[k]}
                  onChange={(v) => setOpqrst((prev) => ({ ...prev, [k]: v }))}
                  interim={opqrstInterim[k] ?? ""}
                  onInterim={(v) => setOpqrstInterim((prev) => ({ ...prev, [k]: v }))}
                  contextType="complaint"
                  specialty={voiceSpecialty || specialty}
                  doctorId={practitionerId || undefined}
                  encounterId={encounterId}
                  geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
                />
              </div>
            ))}
          </div>
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="ros"
          expanded={expanded.ros}
          onToggle={() => toggleSection("ros")}
          complete={completion.ros}
          soap="subjective"
          sectionLabel="Subjective"
          title="Review of systems (focused)"
        >
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              checked={rosAllNegative}
              onChange={(e) => setRosAllNegative(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
            />
            All other systems negative
          </label>
          <div className="mt-4">
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
              Positive findings (if any)
            </Label>
            <TextareaWithVoice
              value={rosPositiveFindings}
              onChange={setRosPositiveFindings}
              interim={rosPosInterim}
              onInterim={setRosPosInterim}
              rows={3}
              placeholder="Document positive ROS items not covered above…"
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="context"
          expanded={expanded.context}
          onToggle={() => toggleSection("context")}
          complete={completion.context}
          soap="subjective"
          sectionLabel="Subjective"
          title="Relevant context"
        >
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
              Past medical history
            </Label>
            <TextareaWithVoice
              value={pmh}
              onChange={setPmh}
              interim={pmhInterim}
              onInterim={setPmhInterim}
              rows={3}
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
              minHeightClass="min-h-[72px]"
              actionsRight={
                <button
                  type="button"
                  className={iconBtn}
                  title="Copy all context fields"
                  onClick={() => void navigator.clipboard.writeText([pmh, currentMedsRaw, allergiesCtx, riskFactors].join("\n"))}
                >
                  <ClipboardCopy className="h-4 w-4" />
                </button>
              }
            />
          </div>
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
              Current medications (comma-separated)
            </Label>
            <TextareaWithVoice
              value={currentMedsRaw}
              onChange={setCurrentMedsRaw}
              interim={medsInterim}
              onInterim={setMedsInterim}
              rows={2}
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
            {medChips.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {medChips.map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-800"
                  >
                    {m}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">Allergies</Label>
            <TextareaWithVoice
              value={allergiesCtx}
              onChange={setAllergiesCtx}
              interim={allergiesInterim}
              onInterim={setAllergiesInterim}
              rows={2}
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">Risk factors</Label>
            <TextareaWithVoice
              value={riskFactors}
              onChange={setRiskFactors}
              interim={riskInterim}
              onInterim={setRiskInterim}
              rows={2}
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="vitals"
          expanded={expanded.vitals}
          onToggle={() => toggleSection("vitals")}
          complete={completion.vitals}
          soap="objective"
          sectionLabel="Objective"
          title="Vital signs"
          subtitle="Baseline vitals for this encounter."
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-[80px] shrink-0">
              <Label className="text-xs text-gray-500">HR</Label>
              <Input
                value={vitals.hr}
                onChange={(e) => setVitals((v) => ({ ...v, hr: e.target.value }))}
                className={fieldBase}
                placeholder="—"
              />
              <span className="text-[10px] text-gray-400">bpm</span>
            </div>
            <div className="flex min-w-[160px] shrink-0 items-end gap-1">
              <div className="w-[80px]">
                <Label className="text-xs text-gray-500">BP Sys</Label>
                <Input
                  value={vitals.bpSys}
                  onChange={(e) => setVitals((v) => ({ ...v, bpSys: e.target.value }))}
                  className={fieldBase}
                  placeholder="—"
                />
              </div>
              <span className="pb-2 text-gray-400">/</span>
              <div className="w-[80px]">
                <Label className="text-xs text-gray-500">Dia</Label>
                <Input
                  value={vitals.bpDia}
                  onChange={(e) => setVitals((v) => ({ ...v, bpDia: e.target.value }))}
                  className={fieldBase}
                  placeholder="—"
                />
              </div>
            </div>
            <div className="w-[80px] shrink-0">
              <Label className="text-xs text-gray-500">RR</Label>
              <Input
                value={vitals.rr}
                onChange={(e) => setVitals((v) => ({ ...v, rr: e.target.value }))}
                className={fieldBase}
                placeholder="—"
              />
              <span className="text-[10px] text-gray-400">/min</span>
            </div>
            <div className="w-[80px] shrink-0">
              <Label className="text-xs text-gray-500">Temp</Label>
              <Input
                value={vitals.temp}
                onChange={(e) => setVitals((v) => ({ ...v, temp: e.target.value }))}
                className={fieldBase}
                placeholder="—"
              />
              <span className="text-[10px] text-gray-400">°F</span>
            </div>
            <div className="w-[80px] shrink-0">
              <Label className="text-xs text-gray-500">SpO₂</Label>
              <Input
                value={vitals.spo2}
                onChange={(e) => setVitals((v) => ({ ...v, spo2: e.target.value }))}
                className={fieldBase}
                placeholder="—"
              />
              <span className="text-[10px] text-gray-400">%</span>
            </div>
            <div className="w-[88px] shrink-0">
              <Label className="text-xs text-gray-500">Height</Label>
              <Input
                value={vitals.heightCm}
                onChange={(e) => setVitals((v) => ({ ...v, heightCm: e.target.value }))}
                className={fieldBase}
                placeholder="—"
              />
              <span className="text-[10px] text-gray-400">cm</span>
            </div>
            <div className="w-[88px] shrink-0">
              <Label className="text-xs text-gray-500">Weight</Label>
              <Input
                value={vitals.weightKg}
                onChange={(e) => setVitals((v) => ({ ...v, weightKg: e.target.value }))}
                className={fieldBase}
                placeholder="—"
              />
              <span className="text-[10px] text-gray-400">kg</span>
            </div>
          </div>
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="exam"
          expanded={expanded.exam}
          onToggle={() => toggleSection("exam")}
          complete={completion.exam}
          soap="objective"
          sectionLabel="Objective"
          title="Physical examination"
          subtitle="General and systemic findings."
        >
          <div className="flex flex-wrap gap-2">
            <button type="button" className={examTab === "general" ? pillActive : pillInactive} onClick={() => setExamTab("general")}>
              General physical exam
            </button>
            <button type="button" className={examTab === "systemic" ? pillActive : pillInactive} onClick={() => setExamTab("systemic")}>
              Systemic exam
            </button>
          </div>
          {examTab === "general" ? (
            <div className="space-y-4">
              <TextareaWithVoice
                value={generalAppearance}
                onChange={setGeneralAppearance}
                interim={gaInterim}
                onInterim={setGaInterim}
                rows={6}
                placeholder="General appearance, gait, distress…"
                contextType="examination"
                specialty={voiceSpecialty || specialty}
                doctorId={practitionerId || undefined}
                encounterId={encounterId}
                minHeightClass="min-h-[120px]"
                geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
              />
              <div>
                <Label className="mb-2 block text-xs font-medium text-gray-500">Local examination</Label>
                <TextareaWithVoice
                  value={localExamination}
                  onChange={setLocalExamination}
                  interim={localExamInterim}
                  onInterim={setLocalExamInterim}
                  rows={4}
                  placeholder="Focused local exam (e.g. joint, spine segment, neurovascular)…"
                  contextType="examination"
                  specialty={voiceSpecialty || specialty}
                  doctorId={practitionerId || undefined}
                  encounterId={encounterId}
                  geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
                />
              </div>
            </div>
          ) : (
            <SystemicExaminationSection
              vitals={{
                bpSys: vitals.bpSys,
                bpDia: vitals.bpDia,
                spo2: vitals.spo2,
                heightCm: vitals.heightCm,
                weightKg: vitals.weightKg,
              }}
              value={systemicExam}
              onChange={updateSystemicExam}
              loadedSystemIds={loadedSystemIds}
              onLoadedSystemIdsChange={setLoadedSystemIds}
              voiceExam={{
                specialty: voiceSpecialty || specialty,
                doctorId: practitionerId || undefined,
                encounterId,
                geminiScreenContextAppend: GEMINI_SCREEN_CONTEXT_PRE_ADMISSION,
                interim: systemicVoiceInterim,
                setInterim: (key, v) =>
                  setSystemicVoiceInterim((prev) => {
                    if (!v.trim()) {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                    }
                    return { ...prev, [key]: v };
                  }),
              }}
            />
          )}
        </CollapsibleSoapSection>

        <CollapsibleSoapSection
          sectionKey="ap"
          expanded={expanded.ap}
          onToggle={() => toggleSection("ap")}
          complete={completion.ap}
          soap="ap"
          title="Assessment & Plan"
          subtitle="Diagnosis, treatment plan, and follow-up."
        >
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-widest text-gray-400">Primary diagnosis (display)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={primaryDxDisplay}
                onChange={(e) => setPrimaryDxDisplay(e.target.value)}
                className={cn(fieldBase, "min-w-[200px] flex-1")}
              />
              <button
                type="button"
                onClick={() => setPrimaryDxMarked((m) => !m)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border transition-colors",
                  primaryDxMarked
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "border-emerald-500 text-emerald-600 hover:bg-emerald-50",
                )}
              >
                {primaryDxMarked ? (
                  <span className="h-2 w-2 rounded-full bg-green-400 ring-2 ring-white" aria-hidden />
                ) : null}
                Mark as Primary
              </button>
            </div>
          </div>
          <div>
            <Label className="mb-1 block text-xs text-gray-500">Primary diagnosis (ICD-10)</Label>
            <Input
              value={primaryDxIcd10}
              onChange={(e) => setPrimaryDxIcd10(e.target.value)}
              className={cn(fieldBase, "max-w-xl")}
            />
          </div>
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">Surgical plan notes</Label>
            <TextareaWithVoice
              value={surgicalPlanNotes}
              onChange={setSurgicalPlanNotes}
              interim={surgicalPlanInterim}
              onInterim={setSurgicalPlanInterim}
              rows={3}
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">Treatment plan notes</Label>
            <TextareaWithVoice
              value={treatmentPlanNotes}
              onChange={setTreatmentPlanNotes}
              interim={treatmentPlanInterim}
              onInterim={setTreatmentPlanInterim}
              rows={3}
              placeholder="Medical management, PT, braces, meds…"
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>
          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">Pre-op notes</Label>
            <TextareaWithVoice
              value={preOpNotes}
              onChange={setPreOpNotes}
              interim={preOpInterim}
              onInterim={setPreOpInterim}
              rows={3}
              placeholder="Optimization, clearance, planning…"
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
            />
          </div>

          <div className="rounded-xl border border-gray-100 bg-slate-50/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div className="min-w-0 space-y-1">
                <p className="text-base font-semibold leading-tight text-gray-900">Current Encounter · Treatments</p>
                <p className="text-xs text-gray-500">{assessmentTreatmentsMeta}</p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
                {(["medical", "surgical", "mixed"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={treatmentFilter === f ? pillActive : pillInactive}
                    onClick={() => setTreatmentFilter(f)}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="rounded-lg bg-blue-600 px-4 text-white shadow-sm hover:bg-blue-700"
                onClick={addTreatmentRow}
              >
                + Add treatment
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                disabled
                title="Coming soon"
              >
                <Mic className="mr-1.5 h-3.5 w-3.5 text-gray-500" />
                Quick order by voice
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                disabled
                title="Coming soon"
              >
                <ScanLine className="mr-1.5 h-3.5 w-3.5 text-gray-500" />
                Import orders via OCR
              </Button>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200/80 bg-white">
              <IpdTreatmentsTable rows={treatmentRows} filter={treatmentFilter} />
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">Assessment &amp; plan notes</Label>
            <TextareaWithVoice
              value={apNotes}
              onChange={setApNotes}
              interim={apNotesInterim}
              onInterim={setApNotesInterim}
              rows={4}
              contextType="complaint"
              specialty={voiceSpecialty || specialty}
              doctorId={practitionerId || undefined}
              encounterId={encounterId}
              geminiScreenContextAppend={GEMINI_SCREEN_CONTEXT_PRE_ADMISSION}
              actionsRight={
                <button
                  type="button"
                  className={iconBtn}
                  onClick={() => void navigator.clipboard.writeText(apNotes)}
                  title="Copy"
                >
                  <ClipboardCopy className="h-4 w-4" />
                </button>
              }
            />
          </div>
        </CollapsibleSoapSection>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-100 bg-white/95 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <p className="text-xs text-gray-400">
            {lastSavedAt ? (
              <>
                ✓ Auto-saved{" "}
                {lastSavedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </>
            ) : (
              <>Draft not saved yet</>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-gray-200"
              disabled={saveBusy || !practitionerId}
              onClick={() => void handleSaveDraft()}
            >
              {saveBusy ? "Saving…" : "Save as Draft"}
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
              disabled={saveBusy || !practitionerId}
              onClick={() => void handleCompleteAssessment()}
            >
              {saveBusy ? "Saving…" : "Complete Assessment"}
            </Button>
          </div>
        </div>
      </div>

      <AdmissionConsentChecklistModal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        onAdmitted={(admissionId) => {
          setConsentOpen(false);
          router.push(`/dashboard/ipd/${admissionId}`);
        }}
        patientName={patientName}
        patientAgeYears={patientAgeYears}
        patientSex={patientSex}
        docpadId={docpadId}
        wardBedLabel="—"
        diagnosisLine={diagnosisLine}
        opdEncounterId={encounterId}
        patientId={patientId}
        admittingDoctorId={practitionerId}
        hospitalId={IPD_DEFAULT_HOSPITAL_ID}
        preAdmissionAssessmentId={preAdmissionId}
        pPrimaryDiagnosisIcd10={primaryDxIcd10 || null}
        pPrimaryDiagnosisDisplay={primaryDxDisplay || null}
      />
    </div>
  );
}
