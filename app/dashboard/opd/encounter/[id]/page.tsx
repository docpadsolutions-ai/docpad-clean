"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText, Microscope, PlusCircle, Save } from "lucide-react";

import { fetchAuthOrgId } from "../../../../lib/authOrg";
import {
  practitionerDisplayNameFromRow,
  practitionerRoleRawFromRow,
  practitionersOrFilterForAuthUid,
} from "../../../../lib/practitionerAuthLookup";
import { parsePractitionerRoleColumn, type UserRole } from "../../../../lib/userRole";
import { supabase } from "../../../../supabase";
import { createEncounterFromAppointment } from "../../../../lib/opdEncounterFromAppointment";
import { DocPadLogoMark } from "../../../../components/DocPadLogoMark";
import { PermissionSurface } from "../../../../components/PermissionGate";
import PrescriptionModal, { type VoiceRxPrefillRow } from "../../../../components/PrescriptionModal";

import SnomedSearch, { type SnomedConcept } from "../../../../components/SnomedSearch";
import VoiceDictationButton, {
  type ClinicalFinding,
  type PlanExtractionResult,
} from "../../../../components/VoiceDictationButton";
import PatientEncountersList from "../../../../components/PatientEncountersList";
import { AbdmConsentNotificationGate } from "@/components/abdm/AbdmConsentNotificationGate";
import PatientSummaryDashboard from "../../../../components/PatientSummaryDashboard";
import InvestigationsTabContent from "../../../../components/patient-investigations/InvestigationsTabContent";
import InvestigationsLabOrdersModal from "../../../../components/InvestigationsLabOrdersModal";
import { usePermission } from "../../../../hooks/usePermission";
import { usePatientOpdEncounters } from "../../../../hooks/usePatientOpdEncounters";
import { usePatientSummaryHighlights } from "../../../../hooks/usePatientSummaryHighlights";
import { readIndiaRefsetKeyFromEnv } from "../../../../lib/snomedUiConfig";
import { buildDiagnosesForSync, syncActiveProblemsFromEncounter } from "../../../../lib/syncActiveProblems";
import { incrementDoctorConceptUsage } from "../../../../lib/incrementDoctorConcept";

/** Optional India NRC refset filter for all SNOMED pickers (`NEXT_PUBLIC_SNOMED_INDIA_REFSET`). */
const SNOMED_INDIA_REFSET_UI = readIndiaRefsetKeyFromEnv();

type PatientData = {
  full_name:   string | null;
  age_years:   number | null;
  sex:         string | null;
  blood_group: string | null;
  docpad_id:   string | null;
  phone:       string | null;
};

/** `opd_encounters` row — `Record` until generated DB types list all clinical/FHIR columns */
type OpdEncounterRowDb = Record<string, unknown>;

/** `patients` row including allergy fields used for chart prefill */
type PatientRowDb = PatientData & {
  known_allergies?: unknown;
  known_allergies_snomed?: unknown;
};

type PractitionerProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name?: string | null;
  role?: string | null;
  user_role?: string | null;
  specialty?: string | null;
};

type FhirCoding = {
  system: "http://snomed.info/sct";
  code:   string;
  display: string;
  icd10:  string | null;
};

// A single voice-extracted complaint enriched with SNOMED and Gemini metadata
type VoiceComplaint = {
  term: string;
  snomed: string;
  duration: string | null;
  severity: string | null;
  negated?: boolean;
  locationLabel?: string | null;
  snomedAlternatives?: { term: string; conceptId: string }[];
};

// A single voice-extracted physical examination finding
type ExamFinding = {
  term: string;
  location: string | null;
  qualifier: string | null;
  snomed: string;
  /** SNOMED concept chosen without body-site confirmation in FSN — verify. */
  snomedLowConfidence?: boolean;
  negated?: boolean;
};

// Working diagnosis chip (manual SNOMED pick or voice + auto-link)
type DiagnosisEntry = {
  term:   string;
  snomed: string;
  icd10:  string | null;
};

/** Primary SNOMED pick for `chief_complaint_*`, `diagnosis_*`, `examination_*` columns + search boxes */
type PersistedSnomedPick = {
  term: string;
  conceptId: string;
};

/** One row in “Treating doctors & facilities” (from encounter embeds). */
type TreatingDoctorLine = { name: string; subtitle: string | null; isLab: boolean };

function pickEmbeddedRow<T extends Record<string, unknown>>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  if (Array.isArray(v)) return (v[0] as T | undefined) ?? null;
  return v;
}

function treatingDoctorInitial(name: string): string {
  const t = name.trim();
  if (!t || t === "Unassigned" || t === "Pending") return "?";
  const stripped = t.replace(/^Dr\.?\s+/i, "").trim();
  const ch = stripped.charAt(0) || t.charAt(0);
  return ch.toUpperCase();
}

/** Safe string from an embedded relation field (Supabase `*` rows). */
function embedFieldStr(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

/** JSON/JSONB may arrive as object or string depending on client / column cast. */
function parseJsonValue<T>(v: unknown): T | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

/** Map embedded or fetched `patients` row to banner `PatientData` (defensive). */
function patientEmbedToData(p: PatientRowDb | Record<string, unknown> | null | undefined): PatientData | null {
  if (p == null || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  const n = (v: unknown): string | null => (v != null && String(v).trim() !== "" ? String(v).trim() : null);
  const age = r.age_years;
  let age_years: number | null = null;
  if (age != null && age !== "") {
    const num = Number(age);
    if (!Number.isNaN(num)) age_years = num;
  }
  return {
    full_name: n(r.full_name),
    age_years,
    sex: n(r.sex),
    blood_group: n(r.blood_group),
    docpad_id: n(r.docpad_id),
    phone: n(r.phone),
  };
}

// SNOMED CT codes for quick-select complaint chips
const COMPLAINT_CHIPS: { label: string; snomed: string }[] = [
  { label: "Fever",               snomed: "386661006" },
  { label: "Cough",               snomed: "49727002"  },
  { label: "Body ache",           snomed: "131075000" },
  { label: "Abdominal pain",      snomed: "21522001"  },
  { label: "Headache",            snomed: "25064002"  },
  { label: "Breathlessness",      snomed: "230145002" },
  { label: "Diabetes review",     snomed: "73211009"  },
  { label: "Hypertension review", snomed: "38341003"  },
];

// SNOMED CT codes for common allergies
const ALLERGY_SNOMED_DICT: Record<string, string> = {
  "Penicillin":  "91936005",
  "Sulfa Drugs": "91939003",
  "Peanuts":     "91935004",
  "Latex":       "1003755008",
};

type AdviceTemplateRow = { id: string; template_name: string; content: string };

/** Persisted inside `opd_encounters.plan_details` (jsonb) */
type PlanDetailsPersisted = {
  advice_notes: string | null;
  advice_include_on_print: boolean;
  surgery_plan: string | null;
  follow_up_date: string | null;
  triage_notes?: string | null;
};

/** Normalize DB / ISO values to `YYYY-MM-DD` for `<input type="date" />`. */
function toDateInputValue(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function followUpAddDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatLocalYmd(d);
}

function followUpAddOneMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return formatLocalYmd(d);
}

const COMMON_ADVICE_PILLS = [
  "Plenty of fluids",
  "Complete course",
  "Avoid cold items",
  "Rest advised",
  "Come if fever persists",
  "Review in 3 days",
  "Avoid self-medication",
  "Light diet",
  "Apply hot fomentation",
  "Avoid strenuous activity",
  "Take with food",
];

function inlineEncounterIdOnAppointment(r: Record<string, unknown>): string | null {
  const eid = r.encounter_id ?? r.opd_encounter_id;
  if (eid == null || String(eid).trim() === "") return null;
  return String(eid);
}

/** Resolve existing `opd_encounters` row for an appointment (`appointment_id` FK or inline id on the appointment row). */
async function findEncounterIdForAppointment(
  appointmentId: string,
  appointmentRow: Record<string, unknown>,
): Promise<string | null> {
  const { data: byAppt, error: apptErr } = await supabase
    .from("opd_encounters")
    .select("id")
    .eq("appointment_id", appointmentId)
    .maybeSingle();

  if (!apptErr && byAppt?.id) return String(byAppt.id);

  const inline = inlineEncounterIdOnAppointment(appointmentRow);
  if (!inline) return null;

  const { data: byId, error: idErr } = await supabase
    .from("opd_encounters")
    .select("id")
    .eq("id", inline)
    .maybeSingle();

  if (!idErr && byId?.id) return String(byId.id);

  return null;
}

/**
 * Save & next: oldest `waiting` appointment, excluding current patient_id.
 * Returns an `opd_encounters.id` (existing or auto-created). Navigation uses `router.push` with this id.
 */
async function resolveNextPatientEncounterId(
  orgId: string | null,
  routeEncounterId: string,
): Promise<string | null> {
  const { data: curEnc } = await supabase
    .from("opd_encounters")
    .select("patient_id, scheduled_time, created_at")
    .eq("id", routeEncounterId)
    .maybeSingle();

  const currentPatientId =
    curEnc?.patient_id != null && String(curEnc.patient_id).trim() !== ""
      ? String(curEnc.patient_id)
      : null;

  let q = supabase.from("appointments").select("*").in("status", ["waiting", "registered"]);

  if (orgId) q = q.eq("hospital_id", orgId);

  if (currentPatientId) {
    q = q.neq("patient_id", currentPatientId);
  }

  const { data, error } = await q
    .order("created_at", { ascending: true })
    .order("scheduled_time", { ascending: true, nullsFirst: false })
    .limit(50);

  if (error || !data?.length) return null;

  for (const raw of data) {
    const nextApt = raw as Record<string, unknown>;
    const appointmentId = nextApt.id != null ? String(nextApt.id) : null;
    if (!appointmentId) {
      continue;
    }

    const patientId =
      nextApt.patient_id != null && String(nextApt.patient_id).trim() !== ""
        ? String(nextApt.patient_id)
        : null;

    const encounterId = await findEncounterIdForAppointment(appointmentId, nextApt);

    if (encounterId && encounterId !== routeEncounterId) {
      return encounterId;
    }
    if (encounterId === routeEncounterId) {
      continue;
    }
    if (patientId) {
      const createdId = await createEncounterFromAppointment(patientId, appointmentId, orgId);
      if (createdId) {
        return createdId;
      }
      continue;
    }
  }

  return null;
}

/** Triage vitals from `appointments.vitals` — linked row first, else latest `waiting` / `in_progress` for patient. */
async function fetchAppointmentVitalsForEncounter(
  appointmentId: unknown,
  patientId: string,
): Promise<Record<string, unknown> | null> {
  const apptIdStr =
    appointmentId != null && String(appointmentId).trim() !== "" ? String(appointmentId) : null;

  if (apptIdStr) {
    const { data, error } = await supabase
      .from("appointments")
      .select("vitals")
      .eq("id", apptIdStr)
      .maybeSingle();
    if (
      !error &&
      data?.vitals != null &&
      typeof data.vitals === "object" &&
      !Array.isArray(data.vitals)
    ) {
      return data.vitals as Record<string, unknown>;
    }
  }

  const pid = patientId.trim();
  if (!pid) return null;

  const { data: row, error } = await supabase
    .from("appointments")
    .select("vitals")
    .eq("patient_id", pid)
    .in("status", ["waiting", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || row?.vitals == null) return null;
  const v = row.vitals;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function vitalsStringFromJson(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v).trim();
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ScaleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 3v18M3 9l9-6 9 6M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThermometerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DropletIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WaveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M2 12s2-5 5-5 5 10 8 10 5-5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PillIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M10.5 20H4a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2v7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="17" r="5" />
      <path d="M14.5 17h5" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConsultIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SurgeryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 2v10M12 12l4.24 4.24M12 12l-4.24 4.24M7.76 16.24A6 6 0 1016.24 7.76" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M2 9V5a2 2 0 012-2h16a2 2 0 012 2v4M2 9h20M2 9v10M22 9v10M2 19h20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9V5" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
    </svg>
  );
}

// ─── Chip toggle ──────────────────────────────────────────────────────────────

function Chip({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
        selected
          ? "border-blue-400 bg-blue-50 text-blue-700"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Vital input ──────────────────────────────────────────────────────────────

function VitalInput({
  label,
  unit,
  value,
  onChange,
  Icon,
  iconColor,
  suffix,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  Icon: ({ className }: { className?: string }) => React.ReactElement;
  iconColor: string;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700">
          {label} <span className="font-normal text-gray-400">({unit})</span>
        </span>
        {suffix}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-sm font-medium text-gray-800 outline-none"
        />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EncounterPage() {
  const router = useRouter();
  const routeParams = useParams();
  /** Same value as dynamic segment `params.id` — `useParams` updates on client navigations (e.g. Save & next). */
  const encounterId =
    typeof routeParams.id === "string" && routeParams.id.trim() !== "" ? routeParams.id : null;

  const searchParams = useSearchParams();
  const readOnlyFromQuery = searchParams.get("mode") === "readonly";

  const { hasPermission, loading: permLoading } = usePermission();
  const canSaveEncounter = hasPermission("encounter_save", "edit");

  // UI state
  const [activeTab, setActiveTab] = useState("encounter");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Chief complaint
  const [chiefComplaintText, setChiefComplaintText] = useState("");
  const [chiefComplaintSnomed, setChiefComplaintSnomed] = useState<string | null>(null);
  const [selectedComplaintLabel, setSelectedComplaintLabel] = useState<string | null>(null);
  const [durationText, setDurationText] = useState("");

  // Quick exam — primary SNOMED finding + voice-linked findings (`examination_term` / `examination_snomed`).
  const [examQuery, setExamQuery] = useState("");
  const [selectedExaminationConcept, setSelectedExaminationConcept] = useState<PersistedSnomedPick | null>(null);

  // Known allergies — free text + SNOMED lookup
  const [allergiesText, setAllergiesText] = useState("");
  const [allergiesSnomed, setAllergiesSnomed] = useState("");
  const [diagnosisEntries, setDiagnosisEntries] = useState<DiagnosisEntry[]>([]);
  const [snomedLinkingDx, setSnomedLinkingDx]     = useState(false);
  const [procedureText, setProcedureText]     = useState("");
  const [procedureSnomed, setProcedureSnomed] = useState("");
  const [adviceOpen, setAdviceOpen] = useState(true);
  const [adviceText, setAdviceText] = useState("");
  const [adviceTemplates, setAdviceTemplates] = useState<AdviceTemplateRow[]>([]);
  const [selectedAdviceTemplateId, setSelectedAdviceTemplateId] = useState("");
  const [includeAdviceOnPrescription, setIncludeAdviceOnPrescription] = useState(true);
  const adviceTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Voice plan extraction — investigations (lab/imaging); meds queue for Prescription modal
  const [planInvestigations, setPlanInvestigations] = useState<string[]>([]);
  const [voiceRxPrefill, setVoiceRxPrefill]         = useState<VoiceRxPrefillRow[]>([]);

  // Voice-extracted complaints — each auto-resolved to a SNOMED code
  const [voiceComplaints, setVoiceComplaints] = useState<VoiceComplaint[]>([]);
  // True while voice complaint findings are being auto-linked to SNOMED
  const [snomedLinking, setSnomedLinking]     = useState(false);

  // Voice-extracted physical examination findings
  const [examFindings, setExamFindings]         = useState<ExamFinding[]>([]);
  const [snomedLinkingExam, setSnomedLinkingExam] = useState(false);

  // Voice dictation — controlled query strings fed into each SnomedSearch input
  const [complaintQuery, setComplaintQuery] = useState("");
  const [diagnosisQuery, setDiagnosisQuery] = useState("");
  /** Primary complaint/dx for dedicated DB columns; kept in sync with chips when possible */
  const [selectedChiefComplaintConcept, setSelectedChiefComplaintConcept] = useState<PersistedSnomedPick | null>(null);
  const [selectedDiagnosisConcept, setSelectedDiagnosisConcept] = useState<PersistedSnomedPick | null>(null);
  // Interim advice text shown in the textarea while the mic is still active
  const [adviceInterim, setAdviceInterim]   = useState("");
  const [tempUnit, setTempUnit] = useState<"C" | "F">("C");
  const [markComplete, setMarkComplete] = useState(false);
  /** Mirrors `opd_encounters.status === 'completed'` for UI (Summary badge, checkbox sync). */
  const [encounterIsFinalized, setEncounterIsFinalized] = useState(false);
  const [department, setDepartment] = useState("General Medicine");

  // Vitals state (controlled)
  const [weight, setWeight] = useState("");
  const [bloodPressure, setBloodPressure] = useState("");
  const [pulse, setPulse] = useState("");
  const [temperature, setTemperature] = useState("");
  const [spo2, setSpo2] = useState("");
  /** `YYYY-MM-DD` for `opd_encounters.follow_up_date` + prescription print */
  const [followUpDate, setFollowUpDate] = useState("");
  const [triageNotesText, setTriageNotesText] = useState("");

  // Save state
  const [isSaving, setIsSaving]   = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [encounterOrgId, setEncounterOrgId] = useState<string | null>(null);
  /** Session org from `auth_org()` — fallback when encounter row has no `hospital_id`. */
  const [authOrgId, setAuthOrgId] = useState<string | null>(null);
  const [encounterAppointmentId, setEncounterAppointmentId] = useState<string | null>(null);

  // Modal state
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [isLabOrdersModalOpen, setIsLabOrdersModalOpen] = useState(false);
  const [currentPatientId, setCurrentPatientId] = useState<string>("");
  const [doctorName, setDoctorName] = useState<string>("Doctor");
  /** `practitioners.id` for SNOMED tiering + frequency RPC. */
  const [doctorPractitionerId, setDoctorPractitionerId] = useState<string | null>(null);
  /** Prefer DB specialty; drives Gemini + Assembly keyterms. */
  const [doctorSpecialty, setDoctorSpecialty] = useState<string>("General Medicine");
  /** Chief-complaint chip: index showing SNOMED alternatives popover. */
  const [complaintChipDetail, setComplaintChipDetail] = useState<number | null>(null);
  /** Normalized signed-in practitioner role (in-memory; no routing). */
  const practitionerRoleRef = useRef<UserRole | null>(null);

  const {
    rows: patientEncounterRows,
    timelineNodes: liveTimelineNodes,
    loading: patientEncountersLoading,
    error: patientEncountersError,
    refresh: refreshPatientEncounters,
  } = usePatientOpdEncounters(currentPatientId);

  const isEncounterReadOnly = encounterIsFinalized || readOnlyFromQuery;

  const summaryOrgId = encounterOrgId ?? authOrgId;

  /** Bumps when encounter saves so Summary tab RPC bundle refetches. */
  const [summaryReloadSignal, setSummaryReloadSignal] = useState(0);

  const {
    row: patientSummaryRow,
    loading: patientSummaryLoading,
    error: patientSummaryError,
    touchUpdatedAt,
  } = usePatientSummaryHighlights(currentPatientId || null, summaryOrgId);

  const pendingEncounterScrollId = useRef<string | null>(null);

  const handleLiveTimelineOpdClick = useCallback((opdId: string) => {
    pendingEncounterScrollId.current = opdId;
    setActiveTab("encounters");
  }, []);

  const handleSummaryNavigate = useCallback(
    (view: string, params?: Record<string, unknown>) => {
      const pid =
        typeof params?.patientId === "string" && params.patientId.trim()
          ? params.patientId.trim()
          : currentPatientId.trim();
      switch (view) {
        case "current-encounter":
          if (params?.mode === "new") {
            if (pid) {
              router.push(`/dashboard/opd/encounter/new?patientId=${encodeURIComponent(pid)}`);
            }
          } else {
            setActiveTab("encounter");
          }
          break;
        case "prescriptions":
          setActiveTab("prescriptions");
          break;
        case "investigations":
          setActiveTab("investigations");
          break;
        case "followup":
          setActiveTab("followup");
          break;
        case "consults":
          setActiveTab("consults");
          break;
        case "upload":
          setActiveTab("upload");
          break;
        case "triage":
          if (pid) {
            router.push(`/reception?patientId=${encodeURIComponent(pid)}`);
          } else {
            router.push("/reception");
          }
          break;
        default:
          break;
      }
    },
    [router, currentPatientId],
  );

  useEffect(() => {
    if (activeTab !== "encounters" || patientEncountersLoading) return;
    const id = pendingEncounterScrollId.current;
    if (!id) return;
    const tid = window.setTimeout(() => {
      const el = document.getElementById(`health-encounter-card-${id}`);
      if (el) {
        pendingEncounterScrollId.current = null;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
    return () => window.clearTimeout(tid);
  }, [activeTab, patientEncountersLoading, patientEncounterRows.length]);

  // Dynamic patient data
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [treatingDoctorLines, setTreatingDoctorLines] = useState<TreatingDoctorLine[]>([]);
  /** Patient / practitioner embeds from `opd_encounters`; org name from a separate `organizations` read (no nested join). */
  const [encounterHeaderEmbed, setEncounterHeaderEmbed] = useState<{
    patient: Record<string, unknown> | null;
    practitioner: Record<string, unknown> | null;
    organization: { name: string } | null;
  } | null>(null);

  const prevRouteEncounterIdRef = useRef<string | null>(null);

  /** Clears all encounter-scoped UI state so the next patient never inherits the previous chart. */
  const resetForm = useCallback(() => {
    setActiveTab("encounter");
    setChiefComplaintText("");
    setChiefComplaintSnomed(null);
    setSelectedComplaintLabel(null);
    setDurationText("");
    setExamQuery("");
    setSelectedExaminationConcept(null);
    setAllergiesText("");
    setAllergiesSnomed("");
    setDiagnosisEntries([]);
    setSnomedLinkingDx(false);
    setProcedureText("");
    setProcedureSnomed("");
    setAdviceOpen(true);
    setAdviceText("");
    setSelectedAdviceTemplateId("");
    setIncludeAdviceOnPrescription(true);
    setPlanInvestigations([]);
    setVoiceRxPrefill([]);
    setVoiceComplaints([]);
    setSnomedLinking(false);
    setExamFindings([]);
    setSnomedLinkingExam(false);
    setComplaintQuery("");
    setDiagnosisQuery("");
    setSelectedChiefComplaintConcept(null);
    setSelectedDiagnosisConcept(null);
    setAdviceInterim("");
    setTempUnit("C");
    setMarkComplete(false);
    setEncounterIsFinalized(false);
    setDepartment("General Medicine");
    setWeight("");
    setBloodPressure("");
    setPulse("");
    setTemperature("");
    setSpo2("");
    setFollowUpDate("");
    setTriageNotesText("");
    setPatient(null);
    setTreatingDoctorLines([]);
    setEncounterHeaderEmbed(null);
    setCurrentPatientId("");
    setEncounterOrgId(null);
    setEncounterAppointmentId(null);
    setSaveError(null);
    setSaveSuccessMessage(null);
    setIsPrescriptionModalOpen(false);
    setIsLabOrdersModalOpen(false);
  }, []);

  useEffect(() => {
    void fetchAuthOrgId().then(({ orgId }) => setAuthOrgId(orgId));
  }, []);

  // When `params.id` changes (Next Patient navigation), clear form before the fetch effect hydrates the new encounter.
  useEffect(() => {
    if (!encounterId) return;
    const prev = prevRouteEncounterIdRef.current;
    if (prev !== null && prev !== encounterId) {
      resetForm();
    }
    prevRouteEncounterIdRef.current = encounterId;
  }, [encounterId, resetForm]);

  /** Deep link: `/dashboard/opd/encounter/[id]?tab=investigations` or `/investigations` child route redirect. */
  useEffect(() => {
    if (typeof window === "undefined" || !encounterId) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("tab") !== "investigations") return;
    setActiveTab("investigations");
    sp.delete("tab");
    const next = sp.toString();
    router.replace(`/dashboard/opd/encounter/${encounterId}${next ? `?${next}` : ""}`, { scroll: false });
  }, [encounterId, router]);

  const openInvestigationOrderPage = useCallback(() => {
    if (!encounterId) return;
    router.push(`/opd/${encounterId}/investigations`);
  }, [encounterId, router]);

  const openInvestigationsView = useCallback(() => {
    if (!encounterId) {
      setActiveTab("investigations");
      return;
    }
    router.push(`/opd/${encounterId}/investigations/view`);
  }, [encounterId, router]);

  // Fetch encounter (clinical fields + patient_id), patient record, and doctor name
  useEffect(() => {
    if (!encounterId) return;

    // 1. Load the full encounter row so we can re-hydrate all clinical state.
    // Cast to Record<string, unknown> because the Supabase-generated types don't
    // include the new FHIR columns until the client types are regenerated.
    supabase
      .from("opd_encounters")
      .select(
        `
        *,
        patient:patients!patient_id(*),
        practitioner:practitioners!doctor_id(*)
      `,
      )
      .eq("id", encounterId)
      .maybeSingle()
      .then(
        async ({
          data: encRaw,
          error: encError,
        }: {
          data: OpdEncounterRowDb | null;
          error: { message: string } | null;
        }) => {
        if (encError) {
          console.error("[encounter] opd_encounters select failed:", encError.message);
          setEncounterHeaderEmbed(null);
          setTreatingDoctorLines([{ name: "Unassigned", subtitle: null, isLab: false }]);
          setPatient(null);
          setCurrentPatientId("");
          return;
        }

        const enc = encRaw;
        if (!enc) {
          setEncounterHeaderEmbed(null);
          setTreatingDoctorLines([]);
          setPatient(null);
          setCurrentPatientId("");
          return;
        }

        let organizationForHeader: { name: string } | null = null;
        const orgIdForLookup =
          enc.hospital_id != null && String(enc.hospital_id).trim() !== ""
            ? String(enc.hospital_id).trim()
            : null;
        if (orgIdForLookup) {
          const { data: orgRow, error: orgErr } = await supabase
            .from("organizations")
            .select("name")
            .eq("id", orgIdForLookup)
            .maybeSingle();
          if (!orgErr && orgRow?.name != null && String(orgRow.name).trim() !== "") {
            organizationForHeader = { name: String(orgRow.name).trim() };
          }
        }

        const patientRel = pickEmbeddedRow(enc.patient as Record<string, unknown> | null);
        const practitionerRel = pickEmbeddedRow(enc.practitioner as Record<string, unknown> | null);
        setEncounterHeaderEmbed({
          patient: patientRel,
          practitioner: practitionerRel,
          organization: organizationForHeader,
        });

        const prRow = practitionerRel as {
          first_name?: unknown;
          last_name?: unknown;
          specialty?: unknown;
          qualification?: unknown;
        } | null;

        const fn = prRow?.first_name != null ? String(prRow.first_name).trim() : "";
        const ln = prRow?.last_name != null ? String(prRow.last_name).trim() : "";
        const spec = prRow?.specialty != null ? String(prRow.specialty).trim() : "";
        const qual = prRow?.qualification != null ? String(prRow.qualification).trim() : "";
        const creds = [spec, qual].filter(Boolean).join(" · ") || null;

        const hasName = Boolean(fn || ln);
        const doctorIdPresent =
          enc.doctor_id != null && String(enc.doctor_id).trim() !== "";

        let lines: TreatingDoctorLine[];
        if (hasName) {
          const displayName = `Dr. ${[fn, ln].filter(Boolean).join(" ")}`.trim();
          lines = [{ name: displayName, subtitle: creds, isLab: false }];
        } else if (doctorIdPresent) {
          lines = [{ name: "Pending", subtitle: "Practitioner record loading or incomplete", isLab: false }];
        } else {
          lines = [{ name: "Unassigned", subtitle: null, isLab: false }];
        }
        setTreatingDoctorLines(lines);

        if (enc.hospital_id != null && String(enc.hospital_id).trim()) {
          setEncounterOrgId(String(enc.hospital_id));
        }

        const rawApptId = enc.appointment_id;
        setEncounterAppointmentId(
          rawApptId != null && String(rawApptId).trim() !== "" ? String(rawApptId) : null,
        );

        const rawEncStatus = enc.status != null ? String(enc.status).trim().toLowerCase() : "";
        const finalizedFromDb = rawEncStatus.replace(/\s+/g, "") === "completed";
        setEncounterIsFinalized(finalizedFromDb);
        setMarkComplete(finalizedFromDb);

        // Helpers for safely reading unknown-typed fields from the DB row
        const str  = (v: unknown): string        => (v != null ? String(v) : "");
        const strN = (v: unknown): string | null => (v != null && v !== "" ? String(v) : null);

        // ── Vitals ───────────────────────────────────────────────────────────
        if (enc.weight      != null) setWeight(str(enc.weight));
        if (enc.blood_pressure)      setBloodPressure(str(enc.blood_pressure));
        if (enc.pulse       != null) setPulse(str(enc.pulse));
        if (enc.temperature != null) setTemperature(str(enc.temperature));
        if (enc.spo2        != null) setSpo2(str(enc.spo2));

        // ── Chief complaint — FHIR chips + dedicated term/concept columns + search box ────
        const ccFhirRaw = enc.chief_complaints_fhir;
        const allCcFhir = Array.isArray(ccFhirRaw)
          ? (ccFhirRaw as FhirCoding[])
          : parseJsonValue<FhirCoding[]>(ccFhirRaw);
        let nextVoiceComplaints: VoiceComplaint[] = [];
        if (allCcFhir && allCcFhir.length > 0) {
          nextVoiceComplaints = allCcFhir.map((f) => ({
            term: f.display,
            snomed: f.code ?? "",
            duration: null,
            severity: null,
          }));
        } else if (enc.chief_complaint) {
          nextVoiceComplaints = [
            {
              term: str(enc.chief_complaint),
              snomed: strN(enc.chief_complaint_snomed) ?? "",
              duration: null,
              severity: null,
            },
          ];
        }
        setVoiceComplaints(nextVoiceComplaints);

        const ccTermDb = strN(enc.chief_complaint_term);
        const ccIdDb = strN(enc.chief_complaint_concept_id);
        if (ccTermDb) {
          setComplaintQuery(ccTermDb);
          setSelectedChiefComplaintConcept({ term: ccTermDb, conceptId: (ccIdDb ?? "").trim() });
        } else if (nextVoiceComplaints[0]?.term) {
          const c0 = nextVoiceComplaints[0];
          setComplaintQuery(c0.term);
          setSelectedChiefComplaintConcept({
            term: c0.term,
            conceptId: c0.snomed?.trim() ?? "",
          });
        } else {
          setComplaintQuery("");
          setSelectedChiefComplaintConcept(null);
        }

        // ── Diagnosis — FHIR chips + dedicated term/concept columns + search box ─────────
        const dxFhirRaw = enc.diagnosis_fhir;
        const dxFhirParsed =
          dxFhirRaw != null && typeof dxFhirRaw === "object" && !Array.isArray(dxFhirRaw)
            ? (dxFhirRaw as FhirCoding)
            : parseJsonValue<FhirCoding>(dxFhirRaw);
        const dxFhir = dxFhirParsed?.display ? dxFhirParsed : null;
        let nextDiagnosisEntries: DiagnosisEntry[] = [];
        if (dxFhir?.display) {
          const parts = dxFhir.display.split(";").map((s) => s.trim()).filter(Boolean);
          const code = dxFhir.code || "";
          const icd = dxFhir.icd10 ?? null;
          nextDiagnosisEntries =
            parts.length > 0
              ? parts.map((term, i) => ({
                  term,
                  snomed: i === 0 ? code : "",
                  icd10: i === 0 ? icd : null,
                }))
              : [{ term: dxFhir.display, snomed: code, icd10: icd }];
        } else if (enc.diagnosis) {
          nextDiagnosisEntries = [
            {
              term: str(enc.diagnosis),
              snomed: strN(enc.diagnosis_snomed ?? enc.diagnosis_sctid) ?? "",
              icd10: strN(enc.diagnosis_icd10),
            },
          ];
        } else {
          const dtOnly = strN(enc.diagnosis_term);
          if (dtOnly) {
            nextDiagnosisEntries = [
              {
                term: dtOnly,
                snomed: strN(enc.diagnosis_snomed ?? enc.diagnosis_sctid) ?? "",
                icd10: strN(enc.diagnosis_icd10),
              },
            ];
          }
        }
        setDiagnosisEntries(nextDiagnosisEntries);

        const dxTermDb = strN(enc.diagnosis_term);
        const dxIdDb = strN(enc.diagnosis_concept_id);
        if (dxTermDb) {
          setDiagnosisQuery(dxTermDb);
          setSelectedDiagnosisConcept({ term: dxTermDb, conceptId: (dxIdDb ?? "").trim() });
        } else if (nextDiagnosisEntries[0]?.term) {
          const d0 = nextDiagnosisEntries[0];
          setDiagnosisQuery(d0.term);
          setSelectedDiagnosisConcept({
            term: d0.term,
            conceptId: d0.snomed?.trim() ?? "",
          });
        } else {
          setDiagnosisQuery("");
          setSelectedDiagnosisConcept(null);
        }

        // ── Procedures — FHIR array first, fall back to comma-separated text ──
        const procFhir = enc.procedures_fhir as FhirCoding[] | null;
        if (Array.isArray(procFhir) && procFhir.length > 0) {
          setProcedureText(procFhir.map((p) => p?.display ?? "").filter(Boolean).join(", "));
          setProcedureSnomed(procFhir.map((p) => p?.code ?? "").filter(Boolean).join(", "));
        } else if (enc.procedures && typeof enc.procedures === "string") {
          setProcedureText(enc.procedures);
        }

        // ── Allergies — FHIR array first, fall back to encounter `known_allergies` ───
        const allergyFhir = enc.allergies_fhir as FhirCoding[] | null;
        let hadEncounterAllergies = false;
        if (Array.isArray(allergyFhir) && allergyFhir.length > 0) {
          hadEncounterAllergies = true;
          setAllergiesText(allergyFhir.map((a) => a?.display ?? "").filter(Boolean).join(", "));
          setAllergiesSnomed(allergyFhir.map((a) => a?.code ?? "").filter(Boolean).join(", "));
        } else if (enc.known_allergies) {
          const raw = enc.known_allergies;
          const terms = Array.isArray(raw)
            ? (raw as string[]).map((t) => String(t).trim()).filter(Boolean)
            : String(raw)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
          if (terms.length > 0) hadEncounterAllergies = true;
          setAllergiesText(terms.join(", "));
        }

        // ── Examination — `examination_term` / `examination_snomed` + legacy `quick_exam` / `quick_exam_snomed`
        const exTermDb = strN(enc.examination_term);
        const exSnomedDb = strN(enc.examination_snomed ?? enc.examination_concept_id);
        if (exTermDb) {
          setExamQuery(exTermDb);
          setSelectedExaminationConcept({
            term: exTermDb,
            conceptId: (exSnomedDb ?? "").trim(),
          });
        } else {
          setExamQuery("");
          setSelectedExaminationConcept(null);
          const rawExam = enc.quick_exam;
          const examArray: string[] = Array.isArray(rawExam)
            ? (rawExam as string[])
            : typeof rawExam === "string" && rawExam.trim()
              ? rawExam.split(",").map((s) => s.trim()).filter(Boolean)
              : [];
          const rawSnomed = enc.quick_exam_snomed;
          const snomedArr: string[] = Array.isArray(rawSnomed)
            ? (rawSnomed as string[])
            : typeof rawSnomed === "string" && rawSnomed.trim()
              ? rawSnomed.split(",").map((s) => s.trim()).filter(Boolean)
              : [];
          const firstLine = examArray.find(
            (line) => line.trim() && !line.trim().startsWith("Investigation:"),
          );
          if (firstLine?.trim()) {
            const t = firstLine.trim();
            const code = snomedArr[0]?.trim() ?? "";
            setExamQuery(t);
            setSelectedExaminationConcept({ term: t, conceptId: code });
          }
        }

        let followUpFromPlan: string = "";
        const pd = enc.plan_details as PlanDetailsPersisted | Record<string, unknown> | null;
        if (pd != null && typeof pd === "object" && !Array.isArray(pd)) {
          const p = pd as Partial<PlanDetailsPersisted>;
          if (p.advice_notes != null && String(p.advice_notes).trim()) {
            setAdviceText(String(p.advice_notes));
          }
          if (typeof p.advice_include_on_print === "boolean") {
            setIncludeAdviceOnPrescription(p.advice_include_on_print);
          }
          if (p.follow_up_date != null && String(p.follow_up_date).trim()) {
            followUpFromPlan = toDateInputValue(p.follow_up_date);
          }
          const tn = (p as { triage_notes?: unknown }).triage_notes;
          if (tn != null && String(tn).trim()) {
            setTriageNotesText(String(tn));
          }
        } else {
          // Legacy top-level columns (older rows)
          const rawNotes = enc.advice_notes;
          if (rawNotes != null && String(rawNotes).trim()) {
            setAdviceText(String(rawNotes));
          }
          const rawPrint = enc.advice_include_on_print;
          if (typeof rawPrint === "boolean") {
            setIncludeAdviceOnPrescription(rawPrint);
          }
        }
        const followUpFromColumn =
          enc.follow_up_date != null && String(enc.follow_up_date).trim()
            ? toDateInputValue(enc.follow_up_date)
            : "";
        setFollowUpDate(followUpFromColumn || followUpFromPlan);

        const pid = enc.patient_id ? str(enc.patient_id) : "";

        void fetchAppointmentVitalsForEncounter(enc.appointment_id, pid).then((apptVitals) => {
          if (!apptVitals) return;
          const pick = vitalsStringFromJson;
          setWeight((prev) => (prev.trim() ? prev : pick(apptVitals.weight) || prev));
          setBloodPressure((prev) => (prev.trim() ? prev : pick(apptVitals.blood_pressure) || prev));
          setPulse((prev) => (prev.trim() ? prev : pick(apptVitals.pulse) || prev));
          setTemperature((prev) => (prev.trim() ? prev : pick(apptVitals.temperature) || prev));
          setSpo2((prev) => (prev.trim() ? prev : pick(apptVitals.spo2) || prev));
        });

        // ── Patient record (embedded on encounter + fallback fetch) ────────
        const embeddedPat = pickEmbeddedRow(enc.patient as PatientRowDb | null);

        function fillAllergiesIfNeeded(p: PatientRowDb | null) {
          if (hadEncounterAllergies || !p) return;

          const rawMaster = p.known_allergies;
          let terms: string[] = Array.isArray(rawMaster)
            ? (rawMaster as string[]).map((t) => String(t).trim()).filter(Boolean)
            : typeof rawMaster === "string" && rawMaster.trim()
              ? rawMaster.split(",").map((s) => s.trim()).filter(Boolean)
              : [];

          const rawCodes = p.known_allergies_snomed;
          let codes: string[] = Array.isArray(rawCodes)
            ? (rawCodes as string[]).map((c) => String(c).trim())
            : typeof rawCodes === "string" && rawCodes.trim()
              ? rawCodes.split(",").map((s) => s.trim())
              : [];

          /** Prior encounter allergies: `opd_encounters.allergies_fhir` only (no `known_allergies` on this table). */
          const fillFromPreviousEncounter = () =>
            supabase
              .from("opd_encounters")
              .select("allergies_fhir")
              .eq("patient_id", pid)
              .neq("id", encounterId)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle()
              .then(({ data: prevEnc, error: prevEncErr }) => {
                if (prevEncErr) return;
                if (!prevEnc) return;
                const af = prevEnc.allergies_fhir as FhirCoding[] | null;
                if (Array.isArray(af) && af.length > 0) {
                  terms = af.map((a) => String(a?.display ?? "").trim()).filter(Boolean);
                  codes = af.map((a) => String(a?.code ?? "").trim());
                }
              });

          void (async () => {
            if (terms.length === 0) {
              await fillFromPreviousEncounter();
            }
            if (terms.length === 0) return;

            const textLine = terms.join(", ");
            setAllergiesText(textLine);
            const snomedParts = terms.map((term, i) => {
              const c = codes[i]?.trim();
              if (c) return c;
              const m = Object.keys(ALLERGY_SNOMED_DICT).find((k) =>
                term.toLowerCase().includes(k.toLowerCase()),
              );
              return m ? ALLERGY_SNOMED_DICT[m] : "";
            });
            setAllergiesSnomed(snomedParts.filter(Boolean).join(", "));
          })();
        }

        if (embeddedPat) {
          setCurrentPatientId(pid);
          const banner = patientEmbedToData(embeddedPat);
          setPatient(banner ?? null);
          fillAllergiesIfNeeded(embeddedPat);
        } else if (pid) {
          setCurrentPatientId(pid);
          supabase
            .from("patients")
            .select("full_name, age_years, sex, blood_group, docpad_id, phone, known_allergies, known_allergies_snomed")
            .eq("id", pid)
            .maybeSingle()
            .then(({ data: pat }: { data: PatientRowDb | null }) => {
              const patRow = pat;
              if (patRow) {
                const banner = patientEmbedToData(patRow);
                setPatient(banner ?? null);
              } else {
                setPatient(null);
              }
              fillAllergiesIfNeeded(patRow);
            });
        } else {
          setCurrentPatientId("");
          setPatient(null);
        }
      });

    // 2. Logged-in doctor's name for the WhatsApp message
    supabase.auth.getUser().then(({ data: authData }: { data: { user: User | null } }) => {
      const uid = authData.user?.id;
      if (!uid) return;
      supabase
        .from("practitioners")
        .select("id, first_name, last_name, full_name, role, user_role, specialty")
        .or(practitionersOrFilterForAuthUid(uid))
        .maybeSingle()
        .then(({ data: profile }: { data: PractitionerProfileRow | null }) => {
          if (profile) {
            const fullName = practitionerDisplayNameFromRow(profile);
            if (fullName) setDoctorName(fullName);
            if (profile.id) setDoctorPractitionerId(String(profile.id));
            const spec = (profile.specialty ?? "").trim();
            if (spec) setDoctorSpecialty(spec);
            practitionerRoleRef.current = parsePractitionerRoleColumn(
              practitionerRoleRawFromRow(profile),
            );
          }
        });
    });
  }, [encounterId]);

  function selectComplaintChip(chip: { label: string; snomed: string }) {
    setVoiceComplaints((prev) => {
      const idx = prev.findIndex((c) => c.term.toLowerCase() === chip.label.toLowerCase());
      if (idx >= 0) {
        const removed = prev[idx];
        const next = prev.filter((_, i) => i !== idx);
        setSelectedChiefComplaintConcept((cur) => {
          if (next.length === 0) return null;
          if (!cur || cur.term.toLowerCase() === removed.term.toLowerCase()) {
            return { term: next[0].term, conceptId: next[0].snomed?.trim() ?? "" };
          }
          return cur;
        });
        setComplaintQuery((q) => {
          if (next.length === 0) return "";
          if (q.trim().toLowerCase() === removed.term.toLowerCase()) return next[0].term;
          return q;
        });
        return next;
      }
      setSelectedChiefComplaintConcept({ term: chip.label, conceptId: chip.snomed });
      setComplaintQuery(chip.label);
      return [...prev, { term: chip.label, snomed: chip.snomed, duration: null, severity: null }];
    });
  }

  function handleExaminationSelect(concept: SnomedConcept) {
    const t = concept.term.trim();
    setSelectedExaminationConcept({
      term: t,
      conceptId: concept.conceptId.trim(),
    });
    setExamQuery(t);
  }

  function handleAllergyChange(text: string) {
    setAllergiesText(text);
    const matched = Object.keys(ALLERGY_SNOMED_DICT).filter((key) =>
      text.toLowerCase().includes(key.toLowerCase())
    );
    setAllergiesSnomed(matched.map((k) => ALLERGY_SNOMED_DICT[k]).join(", "));
  }

  function handleDiagnosisSelect(concept: { term: string; conceptId: string; icd10: string | null }) {
    const newTerm = concept.term.trim();
    setSelectedDiagnosisConcept({
      term: newTerm,
      conceptId: concept.conceptId.trim(),
    });
    setDiagnosisEntries((prev) => {
      if (prev.some((d) => d.term.toLowerCase() === newTerm.toLowerCase())) return prev;
      return [...prev, { term: newTerm, snomed: concept.conceptId, icd10: concept.icd10 ?? null }];
    });
  }

  const handleRxPrefillApplied = useCallback(() => {
    setVoiceRxPrefill([]);
  }, []);

  function handleComplaintSelect(concept: { term: string; conceptId: string; icd10: string | null }) {
    const newTerm = concept.term.trim();
    // Skip if already in the chip list
    if (voiceComplaints.some((c) => c.term.toLowerCase() === newTerm.toLowerCase())) return;
    setSelectedChiefComplaintConcept({
      term: newTerm,
      conceptId: concept.conceptId.trim(),
    });
    setVoiceComplaints((prev) => [
      ...prev,
      { term: newTerm, snomed: concept.conceptId, duration: durationText.trim() || null, severity: null },
    ]);
    // Clear both staging inputs — SnomedSearch already clears complaintQuery via onChange("")
    setDurationText("");
  }

  function removeVoiceComplaintAt(index: number) {
    setVoiceComplaints((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, j) => j !== index);
      setSelectedChiefComplaintConcept((cur) => {
        if (next.length === 0) return null;
        if (!cur || cur.term.toLowerCase() === removed.term.toLowerCase()) {
          return { term: next[0].term, conceptId: next[0].snomed?.trim() ?? "" };
        }
        return cur;
      });
      setComplaintQuery((q) => {
        if (next.length === 0) return "";
        if (q.trim().toLowerCase() === removed.term.toLowerCase()) return next[0].term;
        return q;
      });
      return next;
    });
  }

  function removeDiagnosisEntryAt(index: number) {
    setDiagnosisEntries((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, j) => j !== index);
      setSelectedDiagnosisConcept((cur) => {
        if (next.length === 0) return null;
        if (!cur || cur.term.toLowerCase() === removed.term.toLowerCase()) {
          return { term: next[0].term, conceptId: next[0].snomed?.trim() ?? "" };
        }
        return cur;
      });
      setDiagnosisQuery((q) => {
        if (next.length === 0) return "";
        if (q.trim().toLowerCase() === removed.term.toLowerCase()) return next[0].term;
        return q;
      });
      return next;
    });
  }

  function handleAllergySelect(concept: { term: string; conceptId: string; icd10: string | null }) {
    const newTerm = concept.term.trim();
    setAllergiesText((prev) => {
      const existing = prev.split(",").map((a) => a.trim()).filter(Boolean);
      // Guard: skip if this term is already in the list (case-insensitive)
      if (existing.some((a) => a.toLowerCase() === newTerm.toLowerCase())) return prev;
      return [...existing, newTerm].join(", ");
    });
    setAllergiesSnomed((prev) => {
      const existing = prev.split(",").map((s) => s.trim()).filter(Boolean);
      if (existing.includes(concept.conceptId)) return prev;
      return [...existing, concept.conceptId].join(", ");
    });
  }

  function handleProcedureSelect(concept: { term: string; conceptId: string; icd10: string | null }) {
    const newTerm = concept.term.trim();
    setProcedureText((prev) => {
      const existing = prev.split(",").map((p) => p.trim()).filter(Boolean);
      if (existing.some((p) => p.toLowerCase() === newTerm.toLowerCase())) return prev;
      return [...existing, newTerm].join(", ");
    });
    setProcedureSnomed((prev) => {
      const existing = prev.split(",").map((s) => s.trim()).filter(Boolean);
      if (existing.includes(concept.conceptId)) return prev;
      return [...existing, concept.conceptId].join(", ");
    });
  }

  const refreshAdviceTemplates = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    const { data, error } = await supabase
      .from("advice_templates")
      .select("id, template_name, content")
      .eq("doctor_id", uid)
      .order("template_name", { ascending: true });
    if (!error && data) setAdviceTemplates(data as AdviceTemplateRow[]);
  }, []);

  useEffect(() => {
    void refreshAdviceTemplates();
  }, [refreshAdviceTemplates]);

  const handleCreateAdviceTemplate = useCallback(async () => {
    const name =
      typeof window !== "undefined" ? window.prompt("Enter a name for this template:") : null;
    if (!name?.trim()) return;
    const content = adviceText.trim();
    if (!content) {
      window.alert("Add some advice text before saving a template.");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      window.alert("You must be signed in to save templates.");
      return;
    }
    const { error } = await supabase.from("advice_templates").insert({
      doctor_id: uid,
      template_name: name.trim(),
      content,
    });
    if (error) {
      window.alert(error.message);
      return;
    }
    await refreshAdviceTemplates();
    window.alert("Template saved.");
  }, [adviceText, refreshAdviceTemplates]);

  function appendQuickAdvicePill(line: string) {
    setAdviceText((prev) => {
      const t = prev.trim();
      return t ? `${t}\n${line}` : line;
    });
    setSelectedAdviceTemplateId("");
  }

  async function saveEncounter(
    status: "draft" | "completed",
    redirectAction: "none" | "close" | "next",
  ) {
    setSaveError(null);
    setSaveSuccessMessage(null);
    if (isEncounterReadOnly) {
      setSaveError("This encounter is read-only.");
      return;
    }
    setIsSaving(true);

    function toNum(s: string): number | null {
      const n = parseFloat(s.trim());
      return Number.isFinite(n) ? n : null;
    }

    try {
      if (!encounterId) throw new Error("Missing encounter ID.");

      const {
        data: { user } = { user: null },
        error: authUserErr,
      } = await supabase.auth.getUser();
      if (!user?.id) {
        throw new Error(
          authUserErr?.message?.trim()
            ? `Could not verify sign-in: ${authUserErr.message}`
            : "You must be signed in to save this encounter (no auth user id).",
        );
      }

      let orgIdForSave = encounterOrgId?.trim() || authOrgId?.trim() || "";
      if (!orgIdForSave) {
        const { orgId: fetchedOrg, error: orgFetchErr } = await fetchAuthOrgId();
        orgIdForSave = fetchedOrg?.trim() ?? "";
        if (orgIdForSave) {
          setAuthOrgId(orgIdForSave);
          setEncounterOrgId((prev) => (prev?.trim() ? prev : orgIdForSave));
        } else if (orgFetchErr) {
          throw new Error(`Organization could not be resolved: ${orgFetchErr.message}`);
        }
      }
      if (!orgIdForSave) {
        throw new Error(
          "Your account is not linked to an organization. Cannot save this encounter.",
        );
      }

      const { data: rxRows, error: rxErr } = await supabase
        .from("prescriptions")
        .select("id, medicine_name, active_ingredient_name, dosage_form_name, dosage_text, frequency, duration, instructions")
        .eq("encounter_id", encounterId);
      if (rxErr) console.warn("saveEncounter: could not load prescriptions", rxErr.message);

      const updatedAt = new Date().toISOString();

      const followUpYmd = followUpDate.trim() || null;
      const plan_details: PlanDetailsPersisted = {
        advice_notes: adviceText.trim() || null,
        advice_include_on_print: includeAdviceOnPrescription,
        surgery_plan: null,
        follow_up_date: followUpYmd,
        triage_notes: triageNotesText.trim() || null,
      };

      // Clinical snapshot for local docs only — not sent to `opd_encounters`.
      const clinicalDraftSnapshot = {
        patient_id: currentPatientId,
        chief_complaints: voiceComplaints,
        vitals: {
          weight,
          blood_pressure: bloodPressure,
          pulse,
          temperature,
          spo2,
        },
        examination_findings: examFindings,
        working_diagnoses: diagnosisEntries,
        investigations: planInvestigations,
        prescriptions: [
          ...(rxRows ?? []),
          ...voiceRxPrefill.map((r) => ({ source: "voice_prefill" as const, ...r })),
        ],
        plan_details,
        status,
        updated_at: updatedAt,
      };
      void clinicalDraftSnapshot;

      const cq = (complaintQuery ?? "").trim();
      const dq = (diagnosisQuery ?? "").trim();
      const eq = (examQuery ?? "").trim();

      const chiefComplaintsFhir: FhirCoding[] =
        voiceComplaints.length > 0
          ? voiceComplaints.map((c) => ({
              system:  "http://snomed.info/sct" as const,
              code:    c.snomed?.trim() ?? "",
              display: `${c.term}${c.duration ? ` (${c.duration})` : ""}${c.severity ? ` [${c.severity}]` : ""}`,
              icd10:   null,
            }))
          : cq
            ? [
                {
                  system:  "http://snomed.info/sct" as const,
                  code:    selectedChiefComplaintConcept?.conceptId?.trim() ?? "",
                  display: cq,
                  icd10:   null,
                },
              ]
            : [];

      const diagnosisEntriesForSave: DiagnosisEntry[] =
        diagnosisEntries.length > 0
          ? diagnosisEntries
          : dq
            ? [
                {
                  term: dq,
                  snomed: selectedDiagnosisConcept?.conceptId?.trim() ?? "",
                  icd10: null,
                },
              ]
            : [];

      const dx0ForFhir = diagnosisEntriesForSave[0];
      const diagnosisFhir: FhirCoding | null =
        diagnosisEntriesForSave.length > 0
          ? {
              system:  "http://snomed.info/sct",
              code:    dx0ForFhir?.snomed?.trim() ?? "",
              display: diagnosisEntriesForSave.map((d) => d.term).join("; "),
              icd10:   dx0ForFhir?.icd10 ?? null,
            }
          : null;
      const diagnosisConceptId = dx0ForFhir?.snomed?.trim() ? dx0ForFhir.snomed.trim() : null;

      const chiefComplaintLine =
        voiceComplaints.length > 0
          ? voiceComplaints.map((c) => c.term.trim()).filter(Boolean).join("; ")
          : cq || null;
      const cc0 = voiceComplaints[0];
      const chiefComplaintSnomed =
        cc0?.snomed?.trim() ? cc0.snomed.trim() : selectedChiefComplaintConcept?.conceptId?.trim() || null;

      const persistChiefTerm =
        selectedChiefComplaintConcept?.term?.trim() || cc0?.term?.trim() || (cq || null);
      const persistChiefConceptRaw =
        selectedChiefComplaintConcept?.conceptId?.trim() || cc0?.snomed?.trim() || "";
      const persistChiefConcept = persistChiefConceptRaw || null;

      const persistDxTerm =
        selectedDiagnosisConcept?.term?.trim() || diagnosisEntriesForSave[0]?.term?.trim() || (dq || null);
      const persistDxConceptRaw =
        selectedDiagnosisConcept?.conceptId?.trim() || diagnosisEntriesForSave[0]?.snomed?.trim() || "";
      const persistDxConcept = persistDxConceptRaw || null;

      const procTerms = (procedureText ?? "").split(",").map((p) => p.trim()).filter(Boolean);
      const procCodes = (procedureSnomed ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const proceduresFhir: FhirCoding[] = procTerms.map((term, i) => ({
        system:  "http://snomed.info/sct",
        code:    procCodes[i] ?? "",
        display: term,
        icd10:   null,
      }));

      const allergyTerms = (allergiesText ?? "").split(",").map((a) => a.trim()).filter(Boolean);
      const allergyCodes = (allergiesSnomed ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const allergiesFhir: FhirCoding[] = allergyTerms.map((term, i) => ({
        system:  "http://snomed.info/sct",
        code:    allergyCodes[i] ?? "",
        display: term,
        icd10:   null,
      }));

      const persistExTerm = selectedExaminationConcept?.term?.trim() || (eq || null);
      const persistExSnomedRaw = selectedExaminationConcept?.conceptId?.trim() || "";
      const persistExSnomed = persistExSnomedRaw || null;

      const finalExam = [
        ...(persistExTerm ? [persistExTerm] : []),
        ...examFindings.map((f) =>
          [f.location && `[${f.location}]`, f.term, f.qualifier && `– ${f.qualifier}`]
            .filter(Boolean)
            .join(" "),
        ),
        ...planInvestigations.map((inv) => `Investigation: ${inv}`),
      ];
      const snomedFromFindings = examFindings.map((f) => f.snomed?.trim()).filter(Boolean) as string[];
      const finalExamSnomed = [...new Set([...(persistExSnomed ? [persistExSnomed] : []), ...snomedFromFindings])];

      const normalized = String(status).trim().toLowerCase().replace(/\s+/g, "");
      /** DB `opd_encounters_status_check` on many projects allows `in_progress` + `completed` but not `draft`. */
      const completedFlow = normalized === "completed";
      const statusForDb: "completed" | "in_progress" = completedFlow ? "completed" : "in_progress";

      const { data: encMeta } = await supabase
        .from("opd_encounters")
        .select("encounter_number")
        .eq("id", encounterId)
        .maybeSingle();

      let encounterNumber: string = "";
      const existingNum = encMeta?.encounter_number;
      if (existingNum != null && String(existingNum).trim() !== "") {
        encounterNumber = String(existingNum).trim();
      } else {
        const year = new Date().getFullYear();
        const rand = Math.floor(10000 + Math.random() * 90000);
        encounterNumber = `OPD-${year}-${rand}`;
      }

      const payload = {
        id: encounterId,
        encounter_number: encounterNumber,
        hospital_id: orgIdForSave,
        doctor_id: user.id,
        weight: toNum(weight),
        blood_pressure: bloodPressure.trim() || null,
        pulse: toNum(pulse),
        temperature: toNum(temperature),
        spo2: toNum(spo2),
        quick_exam: finalExam.length > 0 ? finalExam : null,
        quick_exam_snomed: finalExamSnomed.length > 0 ? finalExamSnomed : null,
        examination_term: persistExTerm,
        examination_snomed: persistExSnomed,
        chief_complaint: chiefComplaintLine,
        chief_complaint_snomed: chiefComplaintSnomed,
        chief_complaint_term: persistChiefTerm,
        chief_complaint_concept_id: persistChiefConcept,
        chief_complaints_fhir: chiefComplaintsFhir.length > 0 ? chiefComplaintsFhir : null,
        diagnosis_fhir: diagnosisFhir,
        diagnosis_term: persistDxTerm,
        diagnosis_concept_id: persistDxConcept,
        diagnosis_snomed: diagnosisConceptId,
        diagnosis_sctid: diagnosisConceptId,
        procedures_fhir: proceduresFhir.length > 0 ? proceduresFhir : null,
        allergies_fhir: allergiesFhir.length > 0 ? allergiesFhir : null,
        plan_details,
        follow_up_date: followUpYmd,
        status: statusForDb,
        updated_at: updatedAt,
      };

      const { data: encData, error: encError } = await supabase
        .from("opd_encounters")
        .upsert(payload, { onConflict: "id" })
        .select("patient_id")
        .single();

      if (encError) throw new Error(encError.message);

      const savedPatientId = String((encData as { patient_id?: string } | null)?.patient_id ?? "").trim();
      const pidForProblems = savedPatientId || currentPatientId.trim();
      const diagnosesForProblems = buildDiagnosesForSync({
        diagnosisEntries: diagnosisEntriesForSave,
        persistDxTerm,
        diagnosisConceptId,
      });
      if (pidForProblems && orgIdForSave && diagnosesForProblems.length > 0) {
        const { error: apSyncErr } = await syncActiveProblemsFromEncounter(supabase, {
          patientId: pidForProblems,
          orgId: orgIdForSave,
          diagnoses: diagnosesForProblems,
        });
        if (apSyncErr) {
          console.warn("Summary sync (active_problems):", apSyncErr.message);
        }
      }

      const appointmentStatus = completedFlow ? "completed" : "in_progress";

      const { data: encSnap, error: snapErr } = await supabase
        .from("opd_encounters")
        .select("appointment_id, patient_id")
        .eq("id", encounterId)
        .maybeSingle();
      if (snapErr) throw new Error(snapErr.message);

      let apptIdToUpdate: string | null =
        encSnap?.appointment_id != null && String(encSnap.appointment_id).trim() !== ""
          ? String(encSnap.appointment_id)
          : encounterAppointmentId != null && encounterAppointmentId.trim() !== ""
            ? encounterAppointmentId
            : null;

      if (!apptIdToUpdate && encSnap?.patient_id != null && String(encSnap.patient_id).trim() !== "") {
        const pid = String(encSnap.patient_id);
        const { data: waitRows, error: pickApptErr } = await supabase
          .from("appointments")
          .select("id")
          .eq("patient_id", pid)
          .in("status", ["waiting", "registered", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(1);
        if (pickApptErr) throw new Error(pickApptErr.message);
        apptIdToUpdate = waitRows?.[0]?.id != null ? String(waitRows[0].id) : null;
      }

      if (apptIdToUpdate) {
        const { error: apptUpErr } = await supabase
          .from("appointments")
          .update({ status: appointmentStatus })
          .eq("id", apptIdToUpdate);
        if (apptUpErr) throw new Error(apptUpErr.message);
      }

      void refreshPatientEncounters();
      setSummaryReloadSignal((s) => s + 1);

      const patientId = encData?.patient_id as string | undefined;
      if (patientId && allergyTerms.length > 0) {
        const { error: patientError } = await supabase
          .from("patients")
          .update({
            known_allergies: allergyTerms,
            known_allergies_snomed: allergyCodes.length > 0 ? allergyCodes : [],
          })
          .eq("id", patientId);

        if (patientError) throw new Error(patientError.message);
      }

      setIsSaving(false);
      if (completedFlow) {
        setEncounterIsFinalized(true);
        setMarkComplete(true);
        if (redirectAction === "close") {
          setActiveTab("summary");
        }
      } else {
        setEncounterIsFinalized(false);
      }
      if (redirectAction === "none") {
        setSaveSuccessMessage("Draft saved.");
        setTimeout(() => setSaveSuccessMessage(null), 2800);
      } else if (redirectAction === "close") {
        setSaveSuccessMessage(
          completedFlow
            ? "Encounter finalized — review Summary, then returning to queue…"
            : "Saved successfully — redirecting…",
        );
        setTimeout(() => router.push("/dashboard/opd"), completedFlow ? 2200 : 1200);
      } else {
        setSaveSuccessMessage("Saved — finding next patient…");
        const nextEncounterId = await resolveNextPatientEncounterId(
          encounterOrgId ?? authOrgId,
          encounterId,
        );
        if (nextEncounterId) {
          setSaveSuccessMessage("Saved — opening next patient…");
          resetForm();
          router.push(`/dashboard/opd/encounter/${nextEncounterId}`);
        } else {
          setSaveSuccessMessage("All patients seen! Redirecting to dashboard...");
          setTimeout(() => {
            resetForm();
            router.push("/dashboard/patients");
          }, 1500);
        }
      }
    } catch (e) {
      setIsSaving(false);
      const msg = e instanceof Error ? e.message : "Could not save encounter.";
      setSaveError(msg);
      setSaveSuccessMessage(null);
    }
  }

  const headerPatientDisplayName = useMemo(() => {
    const ep = encounterHeaderEmbed?.patient;
    const fromFirst = embedFieldStr(ep?.first_name);
    const fromFull = embedFieldStr(ep?.full_name);
    const fromState = patient?.full_name?.trim() ?? "";
    return fromFirst || fromFull || fromState || "Unknown Patient";
  }, [encounterHeaderEmbed, patient?.full_name]);

  const headerDoctorDisplayName = useMemo(() => {
    const er = encounterHeaderEmbed?.practitioner;
    const fn = embedFieldStr(er?.first_name);
    const ln = embedFieldStr(er?.last_name);
    if (fn || ln) return `Dr. ${[fn, ln].filter(Boolean).join(" ")}`.trim();
    const fallback = treatingDoctorLines[0]?.name?.trim();
    return fallback || "Unassigned";
  }, [encounterHeaderEmbed, treatingDoctorLines]);

  const headerDoctorSubtitle = useMemo(() => {
    const er = encounterHeaderEmbed?.practitioner;
    const spec = embedFieldStr(er?.specialty);
    const qual = embedFieldStr(er?.qualification);
    const composed = [spec, qual].filter(Boolean).join(" · ");
    const fromLine = treatingDoctorLines[0]?.subtitle ?? null;
    return composed || fromLine || null;
  }, [encounterHeaderEmbed, treatingDoctorLines]);

  const tabs = [
    { id: "summary", label: "Summary" },
    { id: "trends", label: "Health Trends" },
    { id: "encounters", label: "Encounters" },
    { id: "encounter", label: "Current Encounter" },
    { id: "investigations", label: "Investigations" },
    { id: "new", label: "+ New" },
    { id: "consults", label: "Consults Demo" },
  ];
  if (!encounterId) {
    return <div className="flex min-h-screen items-center justify-center p-8 text-gray-500">Loading encounter...</div>;
  }
  return (
    <div className="min-h-screen bg-slate-50 pb-24">

      {/* ── Top nav ── */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-2">
              <DocPadLogoMark className="h-8 w-8" />
              <span className="text-base font-bold tracking-tight text-gray-900">DocPad</span>
            </Link>
            <nav className="hidden items-center gap-6 md:flex">
              {["Dashboard", "Patients", "Encounters", "Analytics", "Settings"].map((item) => (
                <Link
                  key={item}
                  href={
                    item === "Dashboard"
                      ? "/dashboard/opd"
                      : item === "Settings"
                        ? "/dashboard/settings"
                        : "#"
                  }
                  className={`text-sm font-medium transition ${
                    item === "Patients" ? "font-semibold text-gray-900" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {item}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {currentPatientId.trim() ? <AbdmConsentNotificationGate patientId={currentPatientId.trim()} /> : null}
            <button type="button" className="relative rounded-full p-2 text-gray-500 hover:bg-gray-100">
              <BellIcon className="h-5 w-5" />
            </button>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 ring-2 ring-white" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">

        {/* ── Patient banner ── */}
        <div className="overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-sm">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">

            {/* Left: Patient info */}
            <div className="flex gap-4">
              <div suppressHydrationWarning className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-bold text-white shadow-lg">
                {isMounted
                  ? (headerPatientDisplayName === "Unknown Patient"
                      ? "?"
                      : headerPatientDisplayName.charAt(0)?.toUpperCase() ?? "?")
                  : "?"}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900">
                    {headerPatientDisplayName}
                  </h1>
                  {patient?.blood_group && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-bold text-orange-700">
                      <DropletIcon className="h-3 w-3" /> {patient.blood_group}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {patient?.age_years != null ? `${patient.age_years} years` : "—"}
                  {patient?.sex ? ` • ${patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)}` : ""}
                  {patient?.docpad_id ? (
                    <> • DOCPAD ID:{" "}
                      <span className="font-medium text-gray-700">{patient.docpad_id}</span>
                    </>
                  ) : null}
                </p>
                {patient?.phone && (
                  <p className="mt-0.5 text-sm text-gray-500">
                    <a href={`tel:${patient.phone}`} className="font-medium text-blue-600 hover:underline">
                      {patient.phone}
                    </a>
                  </p>
                )}
              </div>
            </div>

            {/* Right: Treating doctors */}
            <div className="min-w-[220px]">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Treating doctors & facilities</p>
              {encounterHeaderEmbed?.organization?.name ? (
                <p className="mb-2 text-xs font-medium text-gray-600">{encounterHeaderEmbed.organization.name}</p>
              ) : null}
              <ul className="space-y-2">
                <li className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 ring-1 ring-white">
                    {treatingDoctorInitial(headerDoctorDisplayName)}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{headerDoctorDisplayName}</p>
                    {headerDoctorSubtitle ? (
                      <p className="text-[11px] text-gray-400">{headerDoctorSubtitle}</p>
                    ) : null}
                  </div>
                </li>
              </ul>
              <button type="button" className="mt-2 text-xs font-semibold text-blue-600 hover:underline">
                View all facilities
              </button>
            </div>
          </div>

          {/* Tab bar — role="tab" excludes these from global dark boxed-button styles in themes.css */}
          <div
            role="tablist"
            aria-label="Patient chart"
            className="patient-chart-tab-bar flex items-center gap-1 overflow-x-auto border-t border-gray-100 px-4 sm:px-6 dark:border-[#1e2d3d]"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                id={`patient-chart-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
                  activeTab === tab.id
                    ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-[#e8edf5]"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-[#7a97b5] dark:hover:text-[#c8d8e8]"
                }`}
              >
                {tab.id === "encounter" && activeTab === tab.id ? (
                  <span className="flex items-center gap-1.5">
                    {tab.label}
                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </span>
                ) : (
                  tab.label
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Encounter card ── */}
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-sm">
          {activeTab === "summary" ? (
            <PatientSummaryDashboard
              patientId={currentPatientId}
              liveOpdTimelineNodes={liveTimelineNodes}
              encountersLoading={patientEncountersLoading}
              encountersError={patientEncountersError}
              onLiveOpdClick={handleLiveTimelineOpdClick}
              onNavigate={handleSummaryNavigate}
              onViewAllergyDetails={() => setActiveTab("encounter")}
              summaryRow={patientSummaryRow}
              summaryLoading={patientSummaryLoading}
              summaryError={patientSummaryError}
              onRefreshHighlightsTimestamp={touchUpdatedAt}
              summaryOrgId={summaryOrgId}
              summaryReloadToken={summaryReloadSignal}
              currentEncounterFinalized={encounterIsFinalized}
              summaryEncounterId={encounterId}
            />
          ) : activeTab === "encounters" ? (
            <PatientEncountersList
              rows={patientEncounterRows}
              loading={patientEncountersLoading}
              error={patientEncountersError}
              currentEncounterId={encounterId}
            />
          ) : activeTab === "investigations" && encounterId ? (
            <InvestigationsTabContent
              patientId={currentPatientId}
              encounterId={encounterId}
              hospitalId={summaryOrgId}
              doctorDisplayName={headerDoctorDisplayName}
              onRequestOrderMore={() => setActiveTab("encounter")}
            />
          ) : ["trends", "new", "consults", "prescriptions", "followup", "upload"].includes(activeTab) ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 px-6 py-14 text-center">
              <p className="text-sm font-semibold text-gray-700">Coming soon</p>
              <p className="max-w-sm text-xs text-gray-500">
                {activeTab === "trends" && "Health trends and longitudinal charts will appear here."}
                {activeTab === "new" && "Quick-create workflows will appear here."}
                {activeTab === "consults" && "Consult requests and replies will appear here."}
                {activeTab === "prescriptions" && "Prescription history and downloads will appear here."}
                {activeTab === "followup" && "Follow-up scheduling will appear here."}
                {activeTab === "upload" && "Document upload will appear here."}
              </p>
            </div>
          ) : (
            <fieldset disabled={isEncounterReadOnly} className="m-0 min-w-0 border-0 p-0">
          {/* Encounter header bar — compact single row */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-100 px-3 py-1.5 sm:px-4">
            <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              OPD
            </span>
            {encounterIsFinalized ? (
              <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                Finalized
              </span>
            ) : readOnlyFromQuery ? (
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                Read-only
              </span>
            ) : null}
            <span suppressHydrationWarning className="text-xs font-medium text-gray-800">
              {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })},{" "}
              {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
            </span>
            <span className="text-gray-300">•</span>
            <span className="text-xs text-gray-500">Visit #1 at this hospital</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <button type="button" className="text-gray-300 transition hover:text-yellow-400" aria-label="Favorite">
                <StarIcon className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5">
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="max-w-[9.5rem] bg-transparent text-xs font-medium text-gray-700 outline-none sm:max-w-none sm:text-sm"
                >
                  {["General Medicine", "Orthopaedics", "Cardiology", "Neurology", "Paediatrics"].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
            </span>
          </div>

          {/* ── Body ── */}
          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5">
              <div className="col-span-full mb-1 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={permLoading || !hasPermission("vitals", "edit")}
                  title={
                    permLoading || !hasPermission("vitals", "edit")
                      ? "View-only access for your role."
                      : "Scroll to vitals"
                  }
                  onClick={() =>
                    document.getElementById("encounter-quick-vitals")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    })
                  }
                >
                  Edit vitals
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={permLoading || !hasPermission("diagnosis", "edit")}
                  title={
                    permLoading || !hasPermission("diagnosis", "edit")
                      ? "View-only access for your role."
                      : "Scroll to diagnosis"
                  }
                  onClick={() =>
                    document.getElementById("encounter-working-diagnosis")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    })
                  }
                >
                  Edit diagnosis
                </button>
              </div>
              {/* Left column: clinical narrative */}
              <div className="min-w-0 space-y-4 lg:col-span-8">
              <PermissionSurface
                viewAllowed={hasPermission("examination", "view")}
                editAllowed={hasPermission("examination", "edit")}
                loading={permLoading}
                presentationWhenViewOnly="fieldset"
                deniedTitle="View-only access for your role."
              >
              {/* Chief complaint */}
              <div className="encounter-zone-chief rounded-lg border border-gray-100 bg-white p-3 shadow-sm sm:p-3.5">
                <div className="mb-1 flex items-center gap-2">
                  <label className="text-sm font-bold text-gray-900">
                    Chief complaint <span className="text-red-500">*</span>
                  </label>
                  <span className="flex-1" />
                  <div className="flex shrink-0 items-center gap-0.5 text-gray-400">
                    <button type="button" className="p-1 hover:text-gray-600"><CameraIcon className="h-4 w-4" /></button>
                    <VoiceDictationButton
                      contextType="complaint"
                      specialty={doctorSpecialty || department}
                      doctorId={doctorPractitionerId ?? undefined}
                      encounterId={encounterId ?? undefined}
                      indiaRefset={SNOMED_INDIA_REFSET_UI ?? undefined}
                      onTranscriptUpdate={(text, isFinal) => {
                        setComplaintQuery(text);
                        if (isFinal) setComplaintQuery("");
                      }}
                      onExtractionComplete={(raw) => {
                        const findings = raw as ClinicalFinding[];
                        if (!Array.isArray(findings) || findings.length === 0) return;

                        const toVoiceRow = (f: ClinicalFinding): VoiceComplaint => {
                          const loc = f.location?.trim() ?? "";
                          const labelBase = f.finding.trim();
                          const display =
                            loc && !labelBase.toLowerCase().includes(loc.toLowerCase())
                              ? `${labelBase} — ${loc}`
                              : labelBase;
                          const topTerm = f.snomed?.term?.trim();
                          const term =
                            f.snomed?.conceptId && topTerm && !f.snomed?.lowConfidence
                              ? topTerm
                              : display;
                          return {
                            term,
                            snomed: f.snomed?.conceptId?.trim() ?? "",
                            duration: f.duration,
                            severity: f.severity,
                            negated: Boolean(f.negation),
                            locationLabel: loc || null,
                            snomedAlternatives: (f.snomedAlternatives ?? []).map((a) => ({
                              term: a.term,
                              conceptId: a.conceptId,
                            })),
                          };
                        };

                        if (findings.length === 1) {
                          const f = findings[0];
                          setDurationText(f.duration ?? "");
                          setComplaintQuery("");
                          setVoiceComplaints((prev) => {
                            const row = toVoiceRow(f);
                            const next = [...prev, row];
                            if (prev.length === 0) {
                              setSelectedChiefComplaintConcept({
                                term: row.term,
                                conceptId: row.snomed?.trim() ?? "",
                              });
                            }
                            return next;
                          });
                          return;
                        }

                        setSnomedLinking(true);
                        try {
                          const resolvedItems = findings.map(toVoiceRow);
                          setVoiceComplaints((prev) => {
                            const next = [...prev, ...resolvedItems];
                            if (prev.length === 0 && resolvedItems[0]) {
                              const f0 = resolvedItems[0];
                              setSelectedChiefComplaintConcept({
                                term: f0.term,
                                conceptId: f0.snomed?.trim() ?? "",
                              });
                            }
                            return next;
                          });
                          setComplaintQuery("");
                          setDurationText("");
                        } finally {
                          setSnomedLinking(false);
                        }
                      }}
                    />
                  </div>
                </div>
                {/* ── 1. Chip area — all confirmed complaints ──────────────────── */}
                {(voiceComplaints.length > 0 || snomedLinking) && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {voiceComplaints.map((c, i) => (
                      <span key={`vc-${i}`} className="relative inline-flex max-w-full flex-col">
                        <span
                          className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 shadow-sm ${
                            c.negated
                              ? "border-red-200 bg-red-50/90 line-through decoration-red-400"
                              : c.snomed
                                ? "border-emerald-200/90 bg-emerald-50/50"
                                : "border-amber-200 bg-amber-50/70"
                          }`}
                          role="button"
                          tabIndex={0}
                          title={
                            c.snomed
                              ? `SNOMED ${c.snomed} — click for alternatives`
                              : "Low confidence — click for details"
                          }
                          onClick={() => setComplaintChipDetail((x) => (x === i ? null : i))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setComplaintChipDetail((x) => (x === i ? null : i));
                            }
                          }}
                        >
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              c.negated ? "bg-red-400" : c.snomed ? "bg-emerald-400" : "bg-amber-400"
                            }`}
                          />
                          <span className="min-w-0 text-[12px] font-medium text-gray-900">{c.term}</span>
                          {(c.duration || c.severity) && (
                            <span className="shrink-0 text-[11px] text-gray-500">
                              {[c.duration, c.severity].filter(Boolean).join(" · ")}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeVoiceComplaintAt(i);
                              setComplaintChipDetail(null);
                            }}
                            className="ml-0.5 shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-red-50 hover:text-red-400"
                            aria-label={`Remove ${c.term}`}
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                            </svg>
                          </button>
                        </span>
                        {complaintChipDetail === i && (
                          <div className="absolute left-0 top-full z-30 mt-1 min-w-[240px] max-w-[min(100vw-2rem,320px)] rounded-lg border border-gray-200 bg-white p-2.5 shadow-xl">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">SNOMED concept</p>
                            <p className="break-all font-mono text-[11px] text-gray-800">{c.snomed || "—"}</p>
                            {(c.snomedAlternatives ?? []).length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-[10px] font-semibold text-gray-500">Alternatives</p>
                                {(c.snomedAlternatives ?? []).map((alt) => (
                                  <button
                                    key={alt.conceptId}
                                    type="button"
                                    className="block w-full rounded-md border border-gray-100 px-2 py-1.5 text-left text-[11px] text-gray-800 hover:bg-gray-50"
                                    onClick={() => {
                                      setVoiceComplaints((prev) =>
                                        prev.map((row, j) =>
                                          j === i ? { ...row, term: alt.term, snomed: alt.conceptId } : row,
                                        ),
                                      );
                                      setComplaintChipDetail(null);
                                    }}
                                  >
                                    {alt.term}
                                  </button>
                                ))}
                              </div>
                            )}
                            {doctorPractitionerId && c.snomed ? (
                              <button
                                type="button"
                                className="mt-2 w-full rounded-lg bg-emerald-600 px-2 py-2 text-[11px] font-semibold text-white transition hover:bg-emerald-700"
                                onClick={() => {
                                  void incrementDoctorConceptUsage(supabase, {
                                    doctorId: doctorPractitionerId,
                                    sctid: c.snomed,
                                    displayTerm: c.term,
                                    contextType: "chief_complaint",
                                  });
                                  setComplaintChipDetail(null);
                                }}
                              >
                                Confirm for my shortcuts
                              </button>
                            ) : null}
                          </div>
                        )}
                      </span>
                    ))}
                    {snomedLinking && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-100 bg-purple-50 px-3 py-1.5 text-[11px] font-medium text-purple-500">
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                        </svg>
                        Linking SNOMED…
                      </span>
                    )}
                  </div>
                )}

                {/* ── 2. Manual entry row: Search (70%) + Duration (30%) ────────── */}
                <div className="flex gap-2">
                  <div className="flex-[7] min-w-0">
                    <SnomedSearch
                      placeholder="Search chief complaint (e.g., Knee pain)..."
                      hierarchy="complaint"
                      allowFreeTextNoCode
                      onSelect={(concept) => handleComplaintSelect(concept)}
                      value={complaintQuery}
                      onChange={setComplaintQuery}
                      indiaRefset={SNOMED_INDIA_REFSET_UI}
                    />
                  </div>
                  <div className="flex-[3] min-w-0">
                    <div className="flex h-full min-h-[2.5rem] items-center rounded-lg border border-gray-200 px-2.5 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
                      <input
                        type="text"
                        value={durationText}
                        onChange={(e) => setDurationText(e.target.value)}
                        placeholder="Duration"
                        className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
                      />
                    </div>
                  </div>
                </div>

                {/* ── 3. Quick suggestions ─────────────────────────────────────── */}
                <p className="mt-2 text-xs font-medium text-gray-500">Quick suggestions for {department}:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {COMPLAINT_CHIPS.map((chip) => (
                    <Chip
                      key={chip.label}
                      label={chip.label}
                      selected={voiceComplaints.some((c) => c.term.toLowerCase() === chip.label.toLowerCase())}
                      onToggle={() => selectComplaintChip(chip)}
                    />
                  ))}
                </div>
              </div>

            {/* Quick exam */}
            <div className="encounter-zone-exam rounded-lg border border-gray-100 bg-white p-3 shadow-sm sm:p-3.5">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">Quick exam</h3>
                <PaperclipIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1" />
                <VoiceDictationButton
                  contextType="examination"
                  specialty={doctorSpecialty || department}
                  doctorId={doctorPractitionerId ?? undefined}
                  encounterId={encounterId ?? undefined}
                  indiaRefset={SNOMED_INDIA_REFSET_UI ?? undefined}
                  onTranscriptUpdate={(text, isFinal) => {
                    if (!isFinal) setExamQuery(text);
                    if (isFinal) setExamQuery("");
                  }}
                  onExtractionComplete={(raw) => {
                    const findings = raw as ClinicalFinding[];
                    if (!Array.isArray(findings) || findings.length === 0) return;
                    setSnomedLinkingExam(true);
                    try {
                      const resolvedItems: ExamFinding[] = findings.map((f) => {
                        const top = f.snomed;
                        const findingLabel = f.finding.trim();
                        const hasCode = Boolean(top?.conceptId?.trim());
                        const lowConf = Boolean(hasCode && top?.lowConfidence);
                        return {
                          term: lowConf ? findingLabel : (top?.term ?? findingLabel),
                          location: f.location,
                          qualifier: f.qualifier,
                          snomed: top?.conceptId ?? "",
                          snomedLowConfidence: lowConf,
                          negated: Boolean(f.negation),
                        };
                      });
                      setExamFindings((prev) => [...prev, ...resolvedItems]);
                    } finally {
                      setSnomedLinkingExam(false);
                    }
                  }}
                />
              </div>

              {/* Voice-extracted exam finding chips */}
              {(examFindings.length > 0 || snomedLinkingExam) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {examFindings.map((f, i) => (
                    <span
                      key={`ef-${i}`}
                      title={
                        f.snomed?.trim() && !f.snomedLowConfidence
                          ? `SNOMED: ${f.snomed}`
                          : f.snomed?.trim()
                            ? `SNOMED: ${f.snomed} — verify match for [${f.location ?? "site"}]`
                            : "No SNOMED code"
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 shadow-sm ${
                        f.negated
                          ? "border-red-200 bg-red-50/90 line-through decoration-red-400"
                          : f.snomed?.trim() && !f.snomedLowConfidence
                            ? "border-emerald-200/90 bg-emerald-50/50"
                            : f.snomed?.trim()
                              ? "border-amber-200 bg-amber-50/70"
                              : "border-gray-200 bg-white"
                      }`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          f.negated
                            ? "bg-red-400"
                            : f.snomed?.trim() && !f.snomedLowConfidence
                              ? "bg-emerald-400"
                              : f.snomed?.trim()
                                ? "bg-amber-400"
                                : "bg-gray-300"
                        }`}
                      />
                      {f.location && (
                        <span className="text-[11px] font-medium text-blue-600">[{f.location}]</span>
                      )}
                      <span className="text-[12px] font-medium capitalize text-gray-900">{f.term}</span>
                      {f.snomed?.trim() && f.snomedLowConfidence && (
                        <span
                          className="rounded bg-amber-100 px-1.5 py-px text-[9px] font-semibold text-amber-900"
                          title="SNOMED code may not match the recorded body site; please confirm."
                        >
                          Review SNOMED
                        </span>
                      )}
                      {f.qualifier && (
                        <span className="text-[11px] text-gray-400">– {f.qualifier}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setExamFindings((prev) => prev.filter((_, j) => j !== i))}
                        className="ml-0.5 shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-red-50 hover:text-red-400"
                        aria-label={`Remove ${f.term}`}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  {snomedLinkingExam && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-100 bg-purple-50 px-3 py-1.5 text-[11px] font-medium text-purple-500">
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </svg>
                      Linking SNOMED…
                    </span>
                  )}
                </div>
              )}

              <p className="mb-1 text-xs font-medium text-gray-500">Examination finding (SNOMED CT)</p>
              <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <SnomedSearch
                    placeholder="Search examination finding (e.g. Chest clear, No murmur)…"
                    hierarchy="finding"
                    allowFreeTextNoCode
                    value={examQuery}
                    onChange={setExamQuery}
                    onSelect={handleExaminationSelect}
                    indiaRefset={SNOMED_INDIA_REFSET_UI}
                  />
                </div>
                {selectedExaminationConcept?.conceptId?.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedExaminationConcept(null);
                      setExamQuery("");
                    }}
                    className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

              </PermissionSurface>
              <PermissionSurface
                viewAllowed={hasPermission("diagnosis", "view")}
                editAllowed={hasPermission("diagnosis", "edit")}
                loading={permLoading}
                presentationWhenViewOnly="fieldset"
                deniedTitle="View-only access for your role."
              >
            {/* Working diagnosis */}
            <div
              id="encounter-working-diagnosis"
              className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm sm:p-3.5"
            >
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">Working diagnosis</h3>
                <span className="min-w-0 flex-1" />
                <VoiceDictationButton
                  contextType="diagnosis"
                  specialty={doctorSpecialty || department}
                  onTranscriptUpdate={(text, isFinal) => {
                    setDiagnosisQuery(text);
                    if (isFinal) setDiagnosisQuery("");
                  }}
                  onExtractionComplete={async (payload) => {
                    const rows = payload as { diagnosis?: string }[];
                    if (!Array.isArray(rows) || rows.length === 0) return;
                    setSnomedLinkingDx(true);
                    try {
                      const resolvedItems: DiagnosisEntry[] = [];
                      let i = 0;
                      for (const r of rows) {
                        const label = (r.diagnosis ?? "").trim();
                        if (!label) {
                          resolvedItems.push({ term: "", snomed: "", icd10: null });
                        } else {
                          try {
                            const ir = SNOMED_INDIA_REFSET_UI
                              ? `&indiaRefset=${encodeURIComponent(SNOMED_INDIA_REFSET_UI)}`
                              : "";
                            const res = await fetch(
                              `/api/snomed/search?q=${encodeURIComponent(label)}&hierarchy=diagnosis${ir}`,
                            );
                            const data = (await res.json()) as {
                              results?: Array<{ term: string; conceptId: string; icd10: string | null }>;
                            };
                            const top = data.results?.[0];
                            resolvedItems.push({
                              term:   top?.term ?? label,
                              snomed: top?.conceptId ?? "",
                              icd10:  top?.icd10 ?? null,
                            });
                          } catch {
                            resolvedItems.push({ term: label, snomed: "", icd10: null });
                          }
                        }
                        i += 1;
                        if (i < rows.length) {
                          await new Promise((resolve) => setTimeout(resolve, 200));
                        }
                      }
                      setDiagnosisEntries((prev) => {
                        const next = [...prev];
                        for (const row of resolvedItems) {
                          if (!row.term) continue;
                          if (next.some((d) => d.term.toLowerCase() === row.term.toLowerCase())) continue;
                          next.push(row);
                        }
                        if (prev.length === 0 && next[0]?.term) {
                          setSelectedDiagnosisConcept({
                            term: next[0].term,
                            conceptId: next[0].snomed?.trim() ?? "",
                          });
                        }
                        return next;
                      });
                    } finally {
                      setSnomedLinkingDx(false);
                    }
                  }}
                />
              </div>

              {/* Diagnosis chips */}
              {(diagnosisEntries.length > 0 || snomedLinkingDx) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {diagnosisEntries.map((d, i) => (
                    <span
                      key={`dx-${i}`}
                      title={d.snomed ? `SNOMED: ${d.snomed}` : "No SNOMED code"}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 shadow-sm"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${d.snomed ? "bg-emerald-400" : "bg-gray-300"}`}
                      />
                      <span className="text-[12px] font-medium capitalize text-gray-900">{d.term}</span>
                      {d.icd10 && (
                        <span className="text-[10px] font-medium text-emerald-600">ICD-10 {d.icd10}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeDiagnosisEntryAt(i)}
                        className="ml-0.5 shrink-0 rounded p-0.5 text-gray-300 transition hover:bg-red-50 hover:text-red-400"
                        aria-label={`Remove ${d.term}`}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  {snomedLinkingDx && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-100 bg-purple-50 px-3 py-1.5 text-[11px] font-medium text-purple-500">
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </svg>
                      Linking SNOMED…
                    </span>
                  )}
                </div>
              )}

              <SnomedSearch
                placeholder="Search diagnosis (e.g., Osteoarthritis of knee)..."
                hierarchy="diagnosis"
                allowFreeTextNoCode
                onSelect={(concept) => handleDiagnosisSelect(concept)}
                value={diagnosisQuery}
                onChange={setDiagnosisQuery}
                indiaRefset={SNOMED_INDIA_REFSET_UI}
              />
            </div>

              </PermissionSurface>
              <PermissionSurface
                viewAllowed={hasPermission("examination", "view")}
                editAllowed={hasPermission("examination", "edit")}
                loading={permLoading}
                presentationWhenViewOnly="fieldset"
                deniedTitle="View-only access for your role."
              >
            {/* Advice & Instructions — Figma-aligned card */}
            <div className="advice-instructions-card overflow-hidden rounded-lg border border-purple-100 bg-white shadow-sm dark:border-[#2a3a52] dark:bg-[#111827] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
              <div className="border-b border-purple-100 bg-[#F5F3FF] px-3 py-2.5 sm:px-3.5 dark:border-[#2a3a52] dark:bg-[#1a2236]">
                <button
                  type="button"
                  onClick={() => setAdviceOpen(!adviceOpen)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <FileText
                    className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="text-sm font-bold text-gray-900 dark:text-[#e8edf5]">
                    Advice &amp; Instructions for Patient
                  </span>
                  <ChevronDown
                    className={`ml-auto h-4 w-4 shrink-0 text-gray-500 transition-transform dark:text-[#8fa3bc] ${adviceOpen ? "rotate-180" : ""}`}
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>
              </div>

              {adviceOpen && (
                <div className="space-y-3 p-3 sm:p-3.5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-[200px] flex-1">
                      <label className="text-[11px] font-semibold tracking-wide text-gray-600 dark:text-[#8fa3bc]">
                        Saved Templates:
                      </label>
                      <select
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-800 outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 dark:border-[#2a3a52] dark:bg-[#1a2236] dark:text-[#e8edf5] dark:focus:border-purple-500 dark:focus:ring-purple-900/40"
                        value={selectedAdviceTemplateId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setSelectedAdviceTemplateId(id);
                          const t = adviceTemplates.find((x) => x.id === id);
                          if (t) setAdviceText(t.content);
                        }}
                      >
                        <option value="">Select template...</option>
                        {adviceTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.template_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCreateAdviceTemplate()}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700"
                    >
                      <PlusCircle className="h-4 w-4" strokeWidth={2} aria-hidden />
                      Create Template
                    </button>
                  </div>

                  <div className="relative min-h-[128px] rounded-lg border border-gray-100 bg-white dark:border-[#2a3a52] dark:bg-[#1a2236]">
                    <textarea
                      ref={adviceTextareaRef}
                      rows={5}
                      value={
                        adviceInterim
                          ? `${adviceText}${adviceText.trim() ? "\n" : ""}${adviceInterim}`
                          : adviceText
                      }
                      readOnly={!!adviceInterim}
                      onChange={(e) => {
                        setAdviceText(e.target.value);
                        setSelectedAdviceTemplateId("");
                      }}
                      placeholder="Add advice, precautions, diet instructions, or lifestyle modifications for the patient..."
                      className="min-h-[120px] w-full resize-none border-0 bg-transparent px-3 py-2.5 pr-14 pb-12 text-sm text-gray-800 outline-none ring-0 placeholder:text-gray-400 focus:ring-0 dark:text-[#e8edf5] dark:placeholder:text-[#546b82]"
                    />
                    <div className="pointer-events-none absolute bottom-2 right-2 flex items-center justify-center">
                      <div className="pointer-events-auto rounded-full bg-gray-100 p-1.5 shadow-sm ring-1 ring-gray-200/80 transition hover:bg-violet-50 hover:ring-violet-200 dark:bg-[#2a3a52] dark:ring-[#3d5166] dark:hover:bg-[#1e2d45] dark:hover:ring-purple-500/40">
                        <VoiceDictationButton
                          contextType="advice"
                          specialty={doctorSpecialty || department}
                          onTranscriptUpdate={(text, isFinal) => {
                            setAdviceOpen(true);
                            if (isFinal) {
                              if (text.trim()) {
                                setAdviceText((prev) => {
                                  const existing = (prev ?? "").trim();
                                  return existing ? `${existing}\n${text.trim()}` : text.trim();
                                });
                              }
                              setAdviceInterim("");
                            } else {
                              setAdviceInterim(text);
                            }
                          }}
                          className="shrink-0"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8fa3bc]">
                      Quick add common advice:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {COMMON_ADVICE_PILLS.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => appendQuickAdvicePill(item)}
                          className="rounded-full border border-blue-200 bg-blue-50/80 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 dark:border-[#3d5166] dark:bg-[#1e2d45] dark:text-[#93c5fd] dark:hover:bg-[#243552]"
                        >
                          {item}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => adviceTextareaRef.current?.focus()}
                        className="rounded-full px-2 text-xs font-bold italic text-purple-600 underline-offset-2 hover:underline dark:text-purple-400"
                      >
                        Custom…
                      </button>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-[#EFF6FF] p-3 dark:border-[#2a3a52] dark:bg-[#1a2236]">
                    <input
                      id="advice-print-include"
                      type="checkbox"
                      checked={includeAdviceOnPrescription}
                      onChange={(e) => setIncludeAdviceOnPrescription(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-[#3d5166]"
                    />
                    <label htmlFor="advice-print-include" className="cursor-pointer text-left">
                      <p className="text-sm font-semibold text-gray-800 dark:text-[#e8edf5]">
                        Include this advice on printed prescription
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-[#8fa3bc]">
                        Patient will receive these instructions on the prescription printout
                      </p>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleCreateAdviceTemplate()}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-600 hover:text-purple-800 hover:underline dark:text-purple-400 dark:hover:text-purple-300"
                  >
                    <Save className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    Save as template
                  </button>
                </div>
              )}
            </div>

              </PermissionSurface>
              </div>

              {/* Right column: sticky vitals + allergies */}
              <aside className="space-y-3 lg:col-span-4 lg:sticky lg:top-20 lg:z-10 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:self-start">
                <PermissionSurface
                  viewAllowed={hasPermission("vitals", "view")}
                  editAllowed={hasPermission("vitals", "edit")}
                  loading={permLoading}
                  presentationWhenViewOnly="fieldset"
                  deniedTitle="View-only access for your role."
                >
                <div id="encounter-quick-vitals" className="rounded-lg border border-gray-200/90 bg-white p-3 shadow-sm sm:p-3.5">
                  <h3 className="mb-2 text-sm font-bold text-gray-900">Quick vitals</h3>
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                    <VitalInput label="Weight" unit="kg" value={weight} onChange={setWeight} Icon={ScaleIcon} iconColor="text-gray-400" />
                    <VitalInput label="BP" unit="mmHg" value={bloodPressure} onChange={setBloodPressure} Icon={DropletIcon} iconColor="text-blue-400" />
                    <VitalInput label="Pulse" unit="bpm" value={pulse} onChange={setPulse} Icon={HeartIcon} iconColor="text-rose-400" />
                    <VitalInput
                      label="Temp" unit="°C" value={temperature} onChange={setTemperature}
                      Icon={ThermometerIcon} iconColor="text-orange-400"
                      suffix={
                        <div className="flex overflow-hidden rounded-lg border border-gray-200 text-[10px] font-bold">
                          <button type="button" onClick={() => setTempUnit("C")} className={`px-2 py-0.5 transition ${tempUnit === "C" ? "bg-blue-600 text-white" : "bg-white text-gray-500"}`}>°C</button>
                          <button type="button" onClick={() => setTempUnit("F")} className={`px-2 py-0.5 transition ${tempUnit === "F" ? "bg-blue-600 text-white" : "bg-white text-gray-500"}`}>°F</button>
                        </div>
                      }
                    />
                    <div className="col-span-2">
                      <VitalInput label="SpO₂" unit="%" value={spo2} onChange={setSpo2} Icon={WaveIcon} iconColor="text-teal-400" />
                    </div>
                  </div>
                  <button type="button" className="mt-2 text-xs font-semibold text-blue-600 hover:underline">
                    View full vitals →
                  </button>
                </div>
                </PermissionSurface>
                <PermissionSurface
                  viewAllowed={hasPermission("triage_notes", "view")}
                  editAllowed={hasPermission("triage_notes", "edit")}
                  loading={permLoading}
                  presentationWhenViewOnly="fieldset"
                  deniedTitle="View-only access for your role."
                >
                  <div className="encounter-zone-triage rounded-lg border border-gray-200/90 bg-white p-3 shadow-sm sm:p-3.5">
                    <h3 className="mb-2 text-sm font-bold text-gray-900">Triage notes</h3>
                    <textarea
                      value={triageNotesText}
                      onChange={(e) => setTriageNotesText(e.target.value)}
                      rows={4}
                      placeholder="Nursing / triage documentation for this visit…"
                      className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                </PermissionSurface>
                <PermissionSurface
                  viewAllowed={hasPermission("vitals", "view")}
                  editAllowed={hasPermission("vitals", "edit")}
                  loading={permLoading}
                  presentationWhenViewOnly="fieldset"
                  deniedTitle="View-only access for your role."
                >
                <div id="encounter-known-allergies" className="rounded-lg border border-gray-200/90 bg-white p-3 shadow-sm sm:p-3.5">
                  <h3 className="mb-1 text-sm font-bold text-gray-900">Known allergies</h3>
                  <SnomedSearch
                    placeholder="Search allergy or substance..."
                    hierarchy="allergy"
                    onSelect={(concept) => handleAllergySelect(concept)}
                    indiaRefset={SNOMED_INDIA_REFSET_UI}
                  />
                  {allergiesText.trim() && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(allergiesText || "").split(",").map((a) => a.trim()).filter(Boolean).map((tag, index) => (
                        <span
                          key={`${tag}-${index}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
                        >
                          ⚠ {tag}
                          <button
                            type="button"
                            aria-label={`Remove ${tag}`}
                            onClick={() => {
                              const updated = (allergiesText || "").split(",").map((a) => a.trim()).filter((a) => a !== tag);
                              setAllergiesText(updated.join(", "));
                              const currentCodes = (allergiesSnomed || "").split(",").map((s) => s.trim());
                              const currentTerms = (allergiesText  || "").split(",").map((t) => t.trim());
                              const snomedUpdated = updated
                                .map((a) => ALLERGY_SNOMED_DICT[a] ?? currentCodes[currentTerms.indexOf(a)])
                                .filter(Boolean);
                              setAllergiesSnomed(snomedUpdated.join(", "));
                            }}
                            className="text-red-300 hover:text-red-600"
                          >✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-[11px] leading-snug text-gray-400">
                    Select multiple allergies from the dropdown. These will be checked against prescriptions.
                  </p>
                </div>
                </PermissionSurface>
              </aside>
            </div>

            {/* Plan — full width below grid */}
            <div id="encounter-plan-section" className="mt-4 border-t border-gray-100 pt-3 sm:pt-4">
            <PermissionSurface
              viewAllowed={hasPermission("examination", "view")}
              editAllowed={hasPermission("examination", "edit")}
              loading={permLoading}
              presentationWhenViewOnly="fieldset"
              deniedTitle="View-only access for your role."
            >
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">Plan</h3>
                <span className="min-w-0 flex-1" />
                <VoiceDictationButton
                  contextType="plan"
                  specialty={doctorSpecialty || department}
                  className="shrink-0"
                  onTranscriptUpdate={() => {
                    /* Live text streams only in Advice mic; plan uses extraction only */
                  }}
                  onExtractionComplete={(payload) => {
                    const p = payload as PlanExtractionResult;
                    const newMeds: VoiceRxPrefillRow[] = (p.medications ?? [])
                      .map((m) => ({
                        name:      String((m as { name?: string }).name ?? "").trim(),
                        dosage:    String((m as { dosage?: string }).dosage ?? "").trim(),
                        frequency: String((m as { frequency?: string }).frequency ?? "").trim(),
                        duration:  String((m as { duration?: string }).duration ?? "").trim(),
                      }))
                      .filter((row) => row.name);
                    setVoiceRxPrefill((prev) => [...prev, ...newMeds]);
                    setPlanInvestigations((prev) => {
                      const next = [...prev];
                      for (const inv of p.investigations ?? []) {
                        const s = String(inv).trim();
                        if (!s) continue;
                        if (next.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
                        next.push(s);
                      }
                      return next;
                    });
                    const advLines = (p.advice ?? []).map((a) => String(a).trim()).filter(Boolean);
                    if (advLines.length > 0) {
                      setAdviceOpen(true);
                      setAdviceText((prev) => {
                        const block = advLines.join("\n");
                        return prev.trim() ? `${prev.trim()}\n${block}` : block;
                      });
                    }
                  }}
                />
              </div>
            </PermissionSurface>

              {/* Voice plan — lab/imaging orders + Rx queue (structured, opens in modal) */}
              {(planInvestigations.length > 0 || voiceRxPrefill.length > 0) && (
                <div className="mb-4 space-y-2">
                  {planInvestigations.length > 0 && (
                    <PermissionSurface
                      viewAllowed={hasPermission("examination", "view")}
                      editAllowed={hasPermission("examination", "edit")}
                      loading={permLoading}
                      presentationWhenViewOnly="fieldset"
                      deniedTitle="View-only access for your role."
                    >
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Lab &amp; imaging orders</p>
                        <div className="flex flex-wrap gap-2">
                          {planInvestigations.map((inv, i) => (
                            <span
                              key={`inv-${i}`}
                              className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800"
                            >
                              {inv}
                              <button
                                type="button"
                                aria-label={`Remove ${inv}`}
                                onClick={() => setPlanInvestigations((prev) => prev.filter((_, j) => j !== i))}
                                className="text-sky-400 hover:text-red-500"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    </PermissionSurface>
                  )}
                  {voiceRxPrefill.length > 0 && (
                    <div>
                      <PermissionSurface
                        viewAllowed={hasPermission("prescriptions", "view")}
                        editAllowed={hasPermission("prescriptions", "edit")}
                        loading={permLoading}
                        presentationWhenViewOnly="fieldset"
                        deniedTitle="View-only access for your role."
                      >
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Prescription queue (structured)</p>
                        <p className="mb-2 text-[11px] text-gray-500">
                          Open <span className="font-semibold text-emerald-700">Prescription</span> below — dictated drugs load into the Rx editor automatically.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {voiceRxPrefill.map((row, i) => (
                            <span
                              key={`rxq-${i}-${row.name}`}
                              className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900"
                            >
                              <span className="truncate">
                                {row.name}
                                {[row.dosage, row.frequency, row.duration].filter(Boolean).length > 0 && (
                                  <span className="font-normal text-emerald-700">
                                    {" "}
                                    · {[row.dosage, row.frequency, row.duration].filter(Boolean).join(" · ")}
                                  </span>
                                )}
                              </span>
                              <button
                                type="button"
                                aria-label="Remove from prescription queue"
                                onClick={() => setVoiceRxPrefill((prev) => prev.filter((_, j) => j !== i))}
                                className="shrink-0 text-emerald-400 hover:text-red-500"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      </PermissionSurface>
                      <button
                        type="button"
                        disabled={permLoading || !hasPermission("prescriptions", "view")}
                        title={
                          permLoading || !hasPermission("prescriptions", "view")
                            ? "You don’t have access to the prescription list."
                            : undefined
                        }
                        onClick={() => setIsPrescriptionModalOpen(true)}
                        className="mt-2 text-xs font-semibold text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Open prescription editor →
                      </button>
                    </div>
                  )}
                </div>
              )}

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                <PermissionSurface
                  viewAllowed={hasPermission("examination", "view")}
                  editAllowed={hasPermission("examination", "edit")}
                  loading={permLoading}
                  presentationWhenViewOnly="fieldset"
                  deniedTitle="View-only access for your role."
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (encounterId) {
                        router.push(`/opd/${encounterId}/investigations`);
                      } else {
                        setIsLabOrdersModalOpen(true);
                      }
                    }}
                    className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border-2 border-blue-200 bg-blue-50/50 px-3 py-2.5 text-left transition hover:bg-blue-50"
                  >
                    <ActivityIcon className="h-5 w-5 shrink-0 text-blue-500" />
                    <span className="text-sm font-semibold text-gray-800">Order Investigations</span>
                  </button>
                </PermissionSurface>
                <PermissionSurface
                  viewAllowed={hasPermission("examination", "view")}
                  editAllowed={hasPermission("examination", "edit")}
                  loading={permLoading}
                  presentationWhenViewOnly="fieldset"
                  deniedTitle="View-only access for your role."
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (encounterId) {
                        openInvestigationsView();
                      } else {
                        setIsLabOrdersModalOpen(true);
                      }
                    }}
                    className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border-2 border-emerald-200 bg-emerald-50/50 px-3 py-2.5 text-left transition hover:bg-emerald-50"
                  >
                    <Microscope className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2} aria-hidden />
                    <span className="text-sm font-semibold text-gray-800">View Investigations</span>
                  </button>
                </PermissionSurface>
                <button
                  type="button"
                  disabled={permLoading || !hasPermission("prescriptions", "view")}
                  title={
                    permLoading || !hasPermission("prescriptions", "view")
                      ? "You don’t have access to the prescription list."
                      : undefined
                  }
                  onClick={() => setIsPrescriptionModalOpen(true)}
                  className="col-span-2 flex items-center gap-2.5 rounded-lg border-2 border-emerald-200 bg-emerald-50/50 px-3 py-2.5 text-left transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
                >
                  <PillIcon className="h-5 w-5 shrink-0 text-emerald-500" />
                  <span className="text-sm font-semibold text-gray-800">Prescription</span>
                </button>
              </div>

            <PermissionSurface
              viewAllowed={hasPermission("examination", "view")}
              editAllowed={hasPermission("examination", "edit")}
              loading={permLoading}
              presentationWhenViewOnly="fieldset"
              deniedTitle="View-only access for your role."
            >
              <div className="mt-3 rounded-lg border border-orange-200/80 bg-orange-50/50 px-3 py-2.5 sm:px-3.5 sm:py-3">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 shrink-0 text-orange-500" aria-hidden />
                  <span className="text-xs font-bold text-gray-900">Follow-up visit</span>
                </div>
                <p className="mt-0.5 text-[11px] text-gray-500">Saved with the encounter and shown on the printed prescription.</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                  <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Date</span>
                    <input
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-200"
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFollowUpDate(followUpAddDays(7))}
                      className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-orange-800 transition hover:bg-orange-50"
                    >
                      +7 days
                    </button>
                    <button
                      type="button"
                      onClick={() => setFollowUpDate(followUpAddDays(14))}
                      className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-orange-800 transition hover:bg-orange-50"
                    >
                      +14 days
                    </button>
                    <button
                      type="button"
                      onClick={() => setFollowUpDate(followUpAddOneMonth())}
                      className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-orange-800 transition hover:bg-orange-50"
                    >
                      1 month
                    </button>
                    {followUpDate ? (
                      <button
                        type="button"
                        onClick={() => setFollowUpDate("")}
                        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <p className="mb-1.5 text-xs font-semibold text-gray-700">Procedures</p>
                <SnomedSearch
                  placeholder="Order procedure (e.g., Appendectomy)..."
                  hierarchy="procedure"
                  onSelect={(concept) => handleProcedureSelect(concept)}
                  indiaRefset={SNOMED_INDIA_REFSET_UI}
                />
                {/* Tag list of ordered procedures */}
                {procedureText.trim() && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(procedureText || "").split(",").map((p) => p.trim()).filter(Boolean).map((tag, index) => (
                      <span
                        key={`${tag}-${index}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700"
                      >
                        {tag}
                        <button
                          type="button"
                          aria-label={`Remove ${tag}`}
                          onClick={() => {
                            const updated = (procedureText || "").split(",").map((p) => p.trim()).filter((p) => p !== tag);
                            setProcedureText(updated.join(", "));
                          }}
                          className="text-purple-300 hover:text-purple-600"
                        >✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
                <button type="button" className="flex items-center gap-2.5 rounded-lg border-2 border-purple-200 bg-purple-50/50 px-3 py-2.5 text-left transition hover:bg-purple-50">
                  <ConsultIcon className="h-5 w-5 shrink-0 text-purple-500" />
                  <span className="text-sm font-semibold text-gray-800">Request Consult</span>
                </button>
                <button type="button" className="flex items-center gap-2.5 rounded-lg border-2 border-blue-200 bg-blue-50/50 px-3 py-2.5 text-left transition hover:bg-blue-50">
                  <SurgeryIcon className="h-5 w-5 shrink-0 text-blue-500" />
                  <span className="text-sm font-semibold text-gray-800">Plan Surgery</span>
                </button>
                <button type="button" className="flex items-center gap-2.5 rounded-lg border-2 border-amber-200 bg-amber-50/50 px-3 py-2.5 text-left transition hover:bg-amber-50">
                  <BedIcon className="h-5 w-5 shrink-0 text-amber-500" />
                  <span className="text-sm font-semibold text-gray-800">Admit this patient</span>
                </button>
              </div>
            </PermissionSurface>
            </div>

          </div>
            </fieldset>
          )}
        </div>
      </div>

      <InvestigationsLabOrdersModal
        open={isLabOrdersModalOpen}
        onClose={() => setIsLabOrdersModalOpen(false)}
        onCreateInvestigationPlan={openInvestigationOrderPage}
        onViewResults={openInvestigationsView}
      />

      {/* ── Prescription modal ── */}
      <PrescriptionModal
        isOpen={isPrescriptionModalOpen}
        onClose={() => setIsPrescriptionModalOpen(false)}
        prefillMedicines={voiceRxPrefill}
        onPrefillApplied={handleRxPrefillApplied}
        encounterId={encounterId}
        patientId={currentPatientId}
        patientName={patient?.full_name ?? "Patient"}
        patientAge={patient?.age_years ?? undefined}
        patientSex={patient?.sex ?? undefined}
        patientPhone={patient?.phone ?? undefined}
        doctorName={doctorName}
        diagnosis={
          diagnosisEntries.length > 0
            ? {
                display: diagnosisEntries.map((d) => d.term).join("; "),
                code:    diagnosisEntries[0].snomed || undefined,
                icd10:   diagnosisEntries[0].icd10 ?? undefined,
              }
            : undefined
        }
        chiefComplaints={voiceComplaints.map((c) => ({
          display: c.term,
          code:    c.snomed || undefined,
        }))}
        vitals={{
          weight:        weight        || undefined,
          bloodPressure: bloodPressure || undefined,
          pulse:         pulse         || undefined,
          temperature:   temperature   || undefined,
          spo2:          spo2          || undefined,
        }}
        allergies={(allergiesText ?? "").trim()
          ? (allergiesText ?? "").split(",").map((a, i) => ({
              display: a.trim(),
              code: (allergiesSnomed ?? "").split(",")[i]?.trim() || undefined,
            })).filter((e) => e.display)
          : []}
        quickExam={[
          (selectedExaminationConcept?.term ?? "").trim(),
          ...examFindings.map((f) =>
            [f.location && `[${f.location}]`, f.term, f.qualifier && `– ${f.qualifier}`]
              .filter(Boolean).join(" ")
          ),
          ...planInvestigations.map((inv) => `Investigation: ${inv}`),
        ].filter(Boolean).join("; ") || undefined}
        procedures={(procedureText ?? "").trim()
          ? (procedureText ?? "").split(",").map((p, i) => ({
              display: p.trim(),
              code: (procedureSnomed ?? "").split(",")[i]?.trim() || undefined,
            })).filter((e) => e.display)
          : []}
        advice={
          includeAdviceOnPrescription && (adviceText ?? "").trim()
            ? (adviceText ?? "").trim()
            : undefined
        }
        followUpDate={followUpDate.trim() || undefined}
      />

      {/* ── Sticky footer ── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-2">
          {saveError && (
            <p role="alert" className="text-center text-xs font-medium text-red-600">
              {saveError}
            </p>
          )}
          {saveSuccessMessage && (
            <div role="status" className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-1.5 text-xs font-semibold text-emerald-700">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {saveSuccessMessage}
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            {isEncounterReadOnly ? (
              <p className="w-full text-center text-sm text-gray-600 sm:text-left">
                {encounterIsFinalized
                  ? "This encounter is completed — view only."
                  : "Read-only mode — editing is disabled."}
              </p>
            ) : (
              <>
            <label
              className={`flex items-center gap-2 ${hasPermission("prescriptions", "edit") ? "cursor-pointer" : "cursor-default"}`}
              title={
                !hasPermission("prescriptions", "edit") && !permLoading
                  ? "View-only access for your role."
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={markComplete}
                disabled={permLoading || !hasPermission("prescriptions", "edit")}
                onChange={(e) => setMarkComplete(e.target.checked)}
                className="h-4 w-4 rounded border-gray-400 accent-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="text-sm font-medium text-gray-700">Mark as completed</span>
            </label>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => saveEncounter("draft", "none")}
                disabled={isSaving || !canSaveEncounter}
                title={!canSaveEncounter && !permLoading ? "You don’t have permission to save this encounter." : undefined}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
              >
                Save as draft
              </button>
              <button
                type="button"
                onClick={() => saveEncounter("completed", "close")}
                disabled={isSaving || !canSaveEncounter}
                title={!canSaveEncounter && !permLoading ? "You don’t have permission to save this encounter." : undefined}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
              >
                {isSaving ? "Saving…" : "Save & close"}
              </button>
              <button
                type="button"
                onClick={() => saveEncounter("completed", "next")}
                disabled={isSaving || !canSaveEncounter}
                title={!canSaveEncounter && !permLoading ? "You don’t have permission to save this encounter." : undefined}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
              >
                Save &amp; next patient
              </button>
            </div>
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
