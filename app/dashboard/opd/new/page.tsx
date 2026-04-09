"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { NewPatientRegistrationForm } from "../../../components/NewPatientRegistrationForm";
import { createOpdEncounterForPatient } from "../../../lib/createOpdEncounterForPatient";
import { fetchAuthOrgId } from "../../../lib/authOrg";
import { supabase } from "../../../supabase";

// ─── Style constants ──────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none ring-blue-500/20 transition focus:border-blue-500 focus:ring-2";


// ─── Icons ────────────────────────────────────────────────────────────────────

function MagnifyingGlassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" strokeLinecap="round" />
    </svg>
  );
}

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M9 18h6M10 22h4M12 2a6 6 0 00-3 11.2V16h6v-2.8A6 6 0 0012 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" strokeLinecap="round" />
    </svg>
  );
}

function IdCardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M13 10h4M13 13h4" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-1a7 7 0 0114 0v1" strokeLinecap="round" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: "Patient lookup" },
  { n: 2, label: "Patient registration" },
  { n: 3, label: "OPD encounter" },
] as const;

/** Narrow row shape for patients preload (Step 3 deep-link). */
type PatientNameDocpadRow = { full_name: string | null; docpad_id: string | null };

function Stepper({ step }: { step: number }) {
  return (
    <nav className="mt-8" aria-label="Progress">
      <ol className="flex max-w-3xl items-center">
        {STEPS.map(({ n, label }, idx) => {
          const active = n === step;
          const done = n < step;
          return (
            <li key={n} className="flex items-center">
              {idx > 0 && (
                <div
                  className={`mx-4 h-px min-w-[2rem] flex-1 sm:mx-6 sm:min-w-[4rem] ${done ? "bg-blue-400" : "bg-gray-200"}`}
                  aria-hidden
                />
              )}
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                    active ? "bg-blue-600 text-white shadow-sm" : done ? "bg-blue-100 text-blue-700" : "border-2 border-gray-200 bg-white text-gray-400"
                  }`}
                  aria-current={active ? "step" : undefined}
                >
                  {n}
                </span>
                <span className={`hidden text-sm sm:inline ${active ? "font-bold text-gray-900" : done ? "font-medium text-blue-600" : "font-medium text-gray-400"}`}>
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────

type SearchTab = "mobile" | "aadhaar" | "abha";
const searchTabs: { id: SearchTab; label: string; Icon: typeof PhoneIcon }[] = [
  { id: "mobile", label: "Mobile number", Icon: PhoneIcon },
  { id: "aadhaar", label: "Aadhaar", Icon: IdCardIcon },
  { id: "abha", label: "ABHA ID", Icon: UserIcon },
];

function Step1({ onCreateNew }: { onCreateNew: () => void }) {
  const [tab, setTab] = useState<SearchTab>("mobile");
  const [mobile, setMobile] = useState("");

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="grid md:grid-cols-2">
        {/* Left: Search */}
        <div className="border-b border-gray-200 p-6 sm:p-8 md:border-b-0 md:border-r">
          <div className="flex items-start gap-2">
            <MagnifyingGlassIcon className="mt-0.5 h-5 w-5 shrink-0 text-gray-700" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Search existing patient in DocPad</h2>
              <p className="mt-1 text-sm text-gray-500">Search by Aadhaar, ABHA ID or registered mobile number.</p>
            </div>
          </div>

          <div className="mt-5 flex gap-2 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <LightbulbIcon className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
            <p className="text-sm leading-relaxed text-sky-900">
              <span className="font-semibold">Demo hint:</span> Try searching: Mobile{" "}
              <span className="font-mono font-medium">9876543210</span> or Aadhaar{" "}
              <span className="font-mono font-medium">432156789012</span>
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {searchTabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition ${
                  tab === id ? "border-blue-500 bg-sky-50 text-gray-900 shadow-sm" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {tab === "mobile" && (
              <div className="flex gap-2">
                <span className="flex shrink-0 items-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-700">+91</span>
                <input type="tel" inputMode="numeric" placeholder="Enter 10-digit mobile number" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} className={inputCls} />
              </div>
            )}
            {tab === "aadhaar" && <input type="text" inputMode="numeric" placeholder="Enter 12-digit Aadhaar number" className={inputCls} />}
            {tab === "abha" && <input type="text" placeholder="Enter ABHA ID" className={inputCls} />}
          </div>

          <button type="button" disabled className="mt-6 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-gray-200 py-3.5 text-sm font-semibold text-gray-400">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-300" />
            Search patient
          </button>
        </div>

        {/* Right: New */}
        <div className="bg-sky-50/80 p-6 sm:p-8">
          <h2 className="text-lg font-bold text-gray-900">+ Patient is new to DocPad?</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">If this is a first-time visit anywhere on DocPad, register the patient now.</p>

          <div className="mt-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-gray-900">What you&apos;ll create:</p>
            <ul className="mt-3 space-y-2.5 text-sm text-gray-700">
              {["A unique DocPad Patient ID that works across all hospitals", "Link with Aadhaar, ABHA, and mobile number", "Basic demographics and health alerts"].map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <button type="button" onClick={onCreateNew} className="mt-6 w-full rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
            + Create new DocPad patient
          </button>
          <p className="mt-4 text-center text-xs text-gray-500">Takes about 2-3 minutes to complete</p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────

function Step3({
  patientName,
  docpadId,
  onStartEncounter,
  isStarting,
  encounterError,
}: {
  patientName: string;
  docpadId: string;
  onStartEncounter: () => void;
  isStarting: boolean;
  encounterError: string | null;
}) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center shadow-sm">
      <CheckCircleIcon className="h-16 w-16 text-emerald-500" />
      <h2 className="mt-4 text-xl font-bold text-emerald-900">Patient registered!</h2>
      <p className="mt-2 text-sm text-emerald-800">
        <span className="font-semibold">{patientName}</span> has been added to DocPad.
      </p>
      <p className="mt-1 font-mono text-xs text-emerald-700">{docpadId}</p>
      <p className="mt-3 text-sm text-emerald-700">Ready to start today&apos;s OPD encounter.</p>

      {encounterError && (
        <div role="alert" className="mt-4 w-full max-w-sm rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {encounterError}
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/dashboard/opd"
          className="rounded-xl border border-emerald-300 px-5 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
        >
          Back to OPD list
        </Link>
        <button
          type="button"
          onClick={onStartEncounter}
          disabled={isStarting}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isStarting ? "Starting…" : "Start OPD encounter →"}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function NewOpdVisitPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [orgId, setOrgId] = useState<string | null>(null);
  /** When opened from Save & next — link new encounter to this appointment row */
  const [queueAppointmentId, setQueueAppointmentId] = useState<string | null>(null);
  const [preloadedPatientLabel, setPreloadedPatientLabel] = useState<string>("");

  const [createdDocpadId, setCreatedDocpadId] = useState("");
  const [newPatientDbId, setNewPatientDbId] = useState<string | null>(null);
  const [registeredPatientName, setRegisteredPatientName] = useState("");

  // Encounter state
  const [isStarting, setIsStarting] = useState(false);
  const [encounterError, setEncounterError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { orgId: oid } = await fetchAuthOrgId();
      setOrgId(oid);
    })();
  }, []);

  useEffect(() => {
    const appt = searchParams.get("appointmentId")?.trim() ?? "";
    const pat = searchParams.get("patientId")?.trim() ?? "";

    if (appt && pat) {
      setQueueAppointmentId(appt);
      setNewPatientDbId(pat);
      setCreatedDocpadId("");

      supabase
        .from("patients")
        .select("full_name, docpad_id")
        .eq("id", pat)
        .maybeSingle()
        .then((res) => {
          const p = res.data as PatientNameDocpadRow | null;
          if (p?.full_name) setPreloadedPatientLabel(String(p.full_name));
          if (p?.docpad_id) setCreatedDocpadId(String(p.docpad_id));
        });

      setStep(3);
      return;
    }

    if (pat && !appt) {
      setQueueAppointmentId(null);
      setNewPatientDbId(pat);
      setCreatedDocpadId("");

      supabase
        .from("patients")
        .select("full_name, docpad_id")
        .eq("id", pat)
        .maybeSingle()
        .then((res) => {
          const p = res.data as PatientNameDocpadRow | null;
          if (p?.full_name) setPreloadedPatientLabel(String(p.full_name));
          if (p?.docpad_id) setCreatedDocpadId(String(p.docpad_id));
        });

      setStep(3);
    }
  }, [searchParams]);

  async function handleStartEncounter() {
    if (!newPatientDbId) {
      setEncounterError("Patient ID is missing. Please go back and try again.");
      return;
    }
    if (!orgId?.trim()) {
      setEncounterError("Your account is not linked to an organization. Refresh the page or contact support.");
      return;
    }

    setEncounterError(null);
    setIsStarting(true);

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const savingUserId = authData.user?.id?.trim() ?? "";
    if (!savingUserId) {
      setIsStarting(false);
      setEncounterError(
        authErr?.message?.trim()
          ? `Could not verify sign-in: ${authErr.message}`
          : "You must be signed in to start an encounter.",
      );
      return;
    }

    const result = await createOpdEncounterForPatient(
      newPatientDbId,
      orgId,
      savingUserId,
      queueAppointmentId,
    );
    setIsStarting(false);

    if (!result.ok) {
      setEncounterError(result.error);
      return;
    }

    router.push(`/dashboard/opd/encounter/${result.encounterId}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 pb-32 pt-8 sm:px-6 lg:px-8 lg:pt-10">

        {/* Page header */}
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Start a new OPD visit</h1>
            <p className="mt-2 text-sm text-gray-500 sm:text-base">
              {step === 1 && "Find the patient in DocPad or register a new one."}
              {step === 2 && "Register the patient's basic details."}
              {step === 3 && "Patient successfully registered."}
            </p>
          </div>
          <Link href="/dashboard/opd" className="shrink-0 text-sm font-semibold text-blue-600 transition hover:text-blue-700">
            Back to OPD list
          </Link>
        </div>

        <Stepper step={step} />

        {/* ── Step 1 ── */}
        {step === 1 && <Step1 onCreateNew={() => setStep(2)} />}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <NewPatientRegistrationForm
            orgId={orgId}
            variant="page"
            onCancel={() => setStep(1)}
            onSuccess={(p) => {
              setNewPatientDbId(p.id);
              setCreatedDocpadId(p.docpad_id);
              setRegisteredPatientName(p.full_name);
              setStep(3);
            }}
          />
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <Step3
            patientName={preloadedPatientLabel.trim() || registeredPatientName}
            docpadId={createdDocpadId || "—"}
            onStartEncounter={handleStartEncounter}
            isStarting={isStarting}
            encounterError={encounterError}
          />
        )}

      </div>
    </div>
  );
}

export default function NewOpdVisitPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <NewOpdVisitPageInner />
    </Suspense>
  );
}
