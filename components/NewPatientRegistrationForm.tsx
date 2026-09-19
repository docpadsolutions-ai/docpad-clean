"use client";

import { useEffect, useId, useRef, useState } from "react";
import { abhaSendOtp, abhaVerifyOtp } from "@/lib/abhaEnrollment";
import {
  INDIAN_STATES,
  type RegisteredPatientRow,
  registerNewPatient,
  type NewPatientFormValues,
} from "@/lib/registerNewPatient";
import {
  CONSENT_PURPOSES,
  getGrievanceOfficer,
  type ConsentPurpose,
  type GrievanceOfficer,
} from "@/lib/dpdpa";
import {
  checkPatientExistsByAadhaarHash,
  checkPatientExistsByPhone,
  hashAadhaar,
  normalizeAadhaarDigits,
} from "@/lib/patientIdentity";

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none ring-blue-500/20 transition focus:border-blue-500 focus:ring-2";

const selectCls =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none ring-blue-500/20 transition focus:border-blue-500 focus:ring-2 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000/svg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem] bg-[right_0.75rem_center] bg-no-repeat pr-10";

type RegStep = "aadhaar_check" | "abha_otp" | "demographics";

function SectionHeader({ letter, title, subtitle }: { letter: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-5 border-b border-gray-100 pb-3">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{letter}</span>
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
      </div>
      {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
    </div>
  );
}

function TagListInput({
  id,
  label,
  placeholder,
  items,
  onAdd,
  onRemove,
}: {
  id: string;
  label: string;
  placeholder: string;
  items: string[];
  onAdd: (val: string) => void;
  onRemove: (val: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (v && !items.includes(v)) {
      onAdd(v);
    }
    setDraft("");
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-800">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={inputCls}
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
        >
          Add
        </button>
      </div>
      {items.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 ring-1 ring-blue-100"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={`Remove ${item}`}
                className="text-blue-400 hover:text-blue-600"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type DuplicateCandidate = {
  id: string;
  docpadId: string;
  fullName: string;
  ageYears: number | null;
  matchedBy: "aadhaar" | "mobile";
};

/**
 * Sep 2026: replaces the old hard stop. A possible duplicate is a decision for the
 * person at the desk, not a dead end — they know whether the family member standing
 * in front of them is the Ramesh Kumar already on file or a different one who shares
 * his phone.
 */
function DuplicateReviewPanel({
  candidate,
  onSame,
  onDifferent,
  onCancel,
}: {
  candidate: DuplicateCandidate;
  onSame: () => void;
  onDifferent: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p>
        <span className="font-semibold">Possible existing patient</span> — matched by{" "}
        {candidate.matchedBy === "aadhaar" ? "Aadhaar" : "mobile number"}:{" "}
        <span className="font-semibold">{candidate.fullName || "Unnamed patient"}</span>
        {candidate.ageYears != null ? `, ${candidate.ageYears}y` : ""}
        {candidate.docpadId ? ` · ID: ${candidate.docpadId}` : ""}.
      </p>
      <p className="text-xs text-amber-800">Is this the same patient, or someone else?</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSame}
          className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-700"
        >
          Same patient — open their record
        </button>
        <button
          type="button"
          onClick={onDifferent}
          className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          Different patient — continue registering
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-xs font-medium text-amber-700 hover:underline"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

export type NewPatientRegistrationFormProps = {
  orgId: string | null;
  onSuccess: (patient: RegisteredPatientRow) => void;
  variant: "modal" | "page";
  onCancel?: () => void;
};

function buildValues(
  firstName: string,
  lastName: string,
  age: string,
  gender: string,
  phone: string,
  aadhaarSha256Hex: string | null,
  registeredWithoutAadhaar: boolean,
  abhaId: string,
  consentGiven: boolean,
  consentPurposes: ConsentPurpose[],
  addr1: string,
  addr2: string,
  city: string,
  state: string,
  pin: string,
  allergies: string[],
  conditions: string[],
  duplicateOverrideOf: string | null,
): NewPatientFormValues {
  return {
    firstName,
    lastName,
    age,
    gender,
    phone,
    aadhaarSha256Hex,
    registeredWithoutAadhaar,
    abhaId,
    consentGiven,
    consentPurposes,
    addr1,
    addr2,
    city,
    state,
    pin,
    allergies,
    conditions,
    duplicateOverrideOf,
  };
}

export function NewPatientRegistrationForm({
  orgId,
  onSuccess,
  variant,
  onCancel,
}: NewPatientRegistrationFormProps) {
  const uid = useId();
  const aadhaarInputRef = useRef<HTMLInputElement>(null);

  const [regStep, setRegStep] = useState<RegStep>("aadhaar_check");
  /** SHA-256 hex of normalized Aadhaar — never the raw number. */
  const [aadhaarHashHex, setAadhaarHashHex] = useState<string | null>(null);
  /** Raw 12-digit Aadhaar held in memory only for ABDM OTP (Edge Function); not sent to duplicate-check RPC. */
  const [aadhaarRawEphemeral, setAadhaarRawEphemeral] = useState<string | null>(null);
  const [abhaTxnId, setAbhaTxnId] = useState<string | null>(null);
  const [abhaOtp, setAbhaOtp] = useState("");
  const [abhaId, setAbhaId] = useState("");

  const [identityBusy, setIdentityBusy] = useState(false);
  const [abhaBusy, setAbhaBusy] = useState<false | "send" | "verify">(false);
  const [otpSentHint, setOtpSentHint] = useState(false);

  const [flowError, setFlowError] = useState<string | null>(null);
  const [registeredWithoutAadhaar, setRegisteredWithoutAadhaar] = useState(false);
  const [duplicateCandidate, setDuplicateCandidate] = useState<DuplicateCandidate | null>(null);
  const [duplicateOverrideId, setDuplicateOverrideId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [phone, setPhone] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentPurposes, setConsentPurposes] = useState<ConsentPurpose[]>([]);
  const [officer, setOfficer] = useState<GrievanceOfficer | null>(null);
  const [addr1, setAddr1] = useState("");
  const [addr2, setAddr2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pin, setPin] = useState("");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleAadhaarVerify() {
    setFlowError(null);
    setDuplicateCandidate(null);
    const raw = aadhaarInputRef.current?.value ?? "";
    const aadhaarStr = normalizeAadhaarDigits(raw);
    if (aadhaarStr.length !== 12) {
      setFlowError("Enter exactly 12 digits (Aadhaar number).");
      return;
    }

    setIdentityBusy(true);
    try {
      const hashedAadhaar = (await hashAadhaar(aadhaarStr)).trim().toLowerCase();
      const dup = await checkPatientExistsByAadhaarHash(hashedAadhaar);
      if (dup.error) {
        setFlowError(dup.error.message);
        return;
      }

      setAadhaarRawEphemeral(aadhaarStr);
      if (aadhaarInputRef.current) {
        aadhaarInputRef.current.value = "";
      }
      setAadhaarHashHex(hashedAadhaar);
      setRegisteredWithoutAadhaar(false);
      setAbhaTxnId(null);
      setAbhaOtp("");
      setOtpSentHint(false);

      if (dup.match) {
        // A possible duplicate no longer dead-ends the desk — it is a decision, made
        // right here, with a real "open their record" action if it really is them.
        setDuplicateCandidate({
          id: dup.id ?? "",
          docpadId: dup.docpadId ?? "",
          fullName: dup.fullName ?? "",
          ageYears: dup.ageYears,
          matchedBy: "aadhaar",
        });
        return;
      }

      setRegStep("abha_otp");
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : "Could not verify Aadhaar.");
    } finally {
      setIdentityBusy(false);
    }
  }

  /** No Aadhaar in hand — go straight to demographics on mobile-only identity. ABHA linking is skipped. */
  function handleSkipAadhaar() {
    setFlowError(null);
    setDuplicateCandidate(null);
    setAadhaarHashHex(null);
    setAadhaarRawEphemeral(null);
    setRegisteredWithoutAadhaar(true);
    setAbhaTxnId(null);
    setAbhaOtp("");
    setAbhaId("");
    setOtpSentHint(false);
    if (aadhaarInputRef.current) aadhaarInputRef.current.value = "";
    setRegStep("demographics");
  }

  function handleDuplicateSame() {
    if (!duplicateCandidate) return;
    onSuccess({
      id: duplicateCandidate.id,
      full_name: duplicateCandidate.fullName || "Unnamed patient",
      docpad_id: duplicateCandidate.docpadId,
      age_years: duplicateCandidate.ageYears ?? 0,
    });
    setDuplicateCandidate(null);
  }

  function handleDuplicateDifferent() {
    if (!duplicateCandidate) return;
    const candidate = duplicateCandidate;
    setDuplicateOverrideId(candidate.id);
    setDuplicateCandidate(null);
    if (candidate.matchedBy === "aadhaar") {
      setRegStep("abha_otp");
    } else {
      void submitPatient(candidate.id);
    }
  }

  async function handleSendAbhaOtp() {
    if (!aadhaarHashHex || !aadhaarRawEphemeral || aadhaarRawEphemeral.length !== 12) {
      setFlowError("Session expired. Start again from Aadhaar verification.");
      return;
    }
    setFlowError(null);
    setAbhaBusy("send");
    try {
      const r = await abhaSendOtp(aadhaarRawEphemeral);
      if (!r.ok) {
        setFlowError(r.error);
        return;
      }
      setAbhaTxnId(r.txnId);
      setOtpSentHint(true);
    } finally {
      setAbhaBusy(false);
    }
  }

  async function handleVerifyAbhaOtp() {
    if (!aadhaarHashHex) {
      setFlowError("Session expired. Start again from Aadhaar verification.");
      return;
    }
    setFlowError(null);
    setAbhaBusy("verify");
    try {
      const r = await abhaVerifyOtp({
        aadhaarSha256Hex: aadhaarHashHex,
        otp: abhaOtp,
        txnId: abhaTxnId,
      });
      if (!r.ok) {
        setFlowError(r.error);
        return;
      }
      setAbhaId(r.abhaId ?? "");
      setFlowError(null);
      setRegStep("demographics");
    } finally {
      setAbhaBusy(false);
    }
  }

  async function handleFinalSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    if (!aadhaarHashHex && !registeredWithoutAadhaar) {
      setSubmitError("Identity verification is missing. Please restart registration.");
      return;
    }
    await submitPatient(duplicateOverrideId);
  }

  /**
   * Split out from the submit handler so "different patient, continue" from the
   * mobile-duplicate panel can retry the insert directly, rather than asking the desk
   * to press Create patient a second time.
   */
  async function submitPatient(overrideId: string | null) {
    setSubmitError(null);
    setIsSubmitting(true);

    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) {
      const dup = await checkPatientExistsByPhone(`+91${digits}`);
      if (!dup.error && dup.match && dup.id && dup.id !== overrideId) {
        setIsSubmitting(false);
        setDuplicateCandidate({
          id: dup.id,
          docpadId: dup.docpadId ?? "",
          fullName: dup.fullName ?? "",
          ageYears: dup.ageYears,
          matchedBy: "mobile",
        });
        return;
      }
    }

    const result = await registerNewPatient(
      buildValues(
        firstName,
        lastName,
        age,
        gender,
        phone,
        aadhaarHashHex,
        registeredWithoutAadhaar,
        abhaId,
        consentGiven,
        consentPurposes,
        addr1,
        addr2,
        city,
        state,
        pin,
        allergies,
        conditions,
        overrideId,
      ),
      orgId,
    );
    setIsSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    setAadhaarRawEphemeral(null);
    if (result.warning) setSubmitError(result.warning);
    onSuccess(result.patient);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const o = await getGrievanceOfficer();
      if (!cancelled) setOfficer(o);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stepLabel =
    regStep === "aadhaar_check" ? "1 — Aadhaar" : regStep === "abha_otp" ? "2 — ABHA OTP" : "3 — Patient details";

  const identitySteps = (
    <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{stepLabel}</p>
        <p className="text-xs text-gray-500">DocPad registration</p>
      </div>

      {flowError && (
        <div
          role="alert"
          className={`rounded-xl border px-4 py-3 text-sm ${
            flowError.startsWith("Patient already registered")
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {flowError}
        </div>
      )}

      {regStep === "aadhaar_check" && (
        <section>
          <SectionHeader
            letter="A"
            title="Aadhaar verification"
            subtitle="We hash your Aadhaar on this device with SHA-256. The number is never stored in the app or sent to the server."
          />
          <div className="space-y-4">
            <div>
              <label htmlFor={`${uid}-aadhaar-ephemeral`} className="mb-1.5 block text-sm font-medium text-gray-800">
                Aadhaar number <span className="text-red-500">*</span>
              </label>
              <input
                ref={aadhaarInputRef}
                id={`${uid}-aadhaar-ephemeral`}
                type="password"
                name={`aadhaar-${uid}`}
                autoComplete="new-password"
                inputMode="numeric"
                maxLength={12}
                placeholder="12-digit Aadhaar"
                className={inputCls}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 12);
                  e.target.value = v;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAadhaarVerify();
                  }
                }}
              />
              <p className="mt-2 text-xs text-gray-500">
                Duplicate check uses a SHA-256 hash only (DPDPA 2023). For ABHA OTP, the same session sends the 12-digit
                number to the DocPad Edge Function (government bridge only)—not to Postgres RPCs—and it is cleared after
                registration or if you start over.
              </p>
            </div>
            <button
              type="button"
              disabled={identityBusy}
              onClick={() => void handleAadhaarVerify()}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-8"
            >
              {identityBusy ? "Checking…" : "Continue"}
            </button>
            <button
              type="button"
              onClick={handleSkipAadhaar}
              className="block text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
            >
              Patient doesn&rsquo;t have their Aadhaar — register with mobile number only
            </button>
          </div>
        </section>
      )}

      {regStep === "abha_otp" && (
        <section>
          <SectionHeader
            letter="B"
            title="ABHA OTP enrollment"
            subtitle="Request an OTP to the mobile linked with Aadhaar, then verify to link ABHA."
          />
          <div className="space-y-4">
            <button
              type="button"
              disabled={abhaBusy === "send"}
              onClick={() => void handleSendAbhaOtp()}
              className="w-full rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-semibold text-blue-900 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-6"
            >
              {abhaBusy === "send" ? "Sending…" : "Send OTP"}
            </button>
            {otpSentHint && (
              <p className="text-sm text-gray-600">
                If OTP was sent, enter it below. OTP is requested via the <code className="rounded bg-gray-100 px-1">abha-enrol</code>{" "}
                Edge Function; verify may use <code className="rounded bg-gray-100 px-1">abha_verify_otp</code> in Supabase if
                configured.
              </p>
            )}
            <div>
              <label htmlFor={`${uid}-abha-otp`} className="mb-1.5 block text-sm font-medium text-gray-800">
                OTP
              </label>
              <input
                id={`${uid}-abha-otp`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter OTP"
                value={abhaOtp}
                onChange={(e) => setAbhaOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className={inputCls}
              />
            </div>
            <button
              type="button"
              disabled={abhaBusy === "verify"}
              onClick={() => void handleVerifyAbhaOtp()}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-8"
            >
              {abhaBusy === "verify" ? "Verifying…" : "Verify & continue"}
            </button>
          </div>
        </section>
      )}
    </div>
  );

  const demographicsBody = (
    <>
      {submitError && (
        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {registeredWithoutAadhaar ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <span className="font-medium text-gray-900">Registering without Aadhaar.</span>{" "}
          No ABHA ID was linked. It can be added to this record later if the patient brings their Aadhaar.
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
          <span className="font-medium">Aadhaar verified.</span>{" "}
          {abhaId ? (
            <>
              ABHA linked: <span className="font-mono font-semibold">{abhaId}</span>
            </>
          ) : (
            "ABHA verification completed — you can add an ABHA ID later if needed."
          )}
        </div>
      )}

      <div className="space-y-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{stepLabel}</p>
          <button
            type="button"
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
            onClick={() => {
              setRegStep("aadhaar_check");
              setAadhaarHashHex(null);
              setAadhaarRawEphemeral(null);
              setAbhaTxnId(null);
              setAbhaOtp("");
              setAbhaId("");
              setOtpSentHint(false);
              setFlowError(null);
              setRegisteredWithoutAadhaar(false);
              setDuplicateCandidate(null);
              setDuplicateOverrideId(null);
              if (aadhaarInputRef.current) aadhaarInputRef.current.value = "";
            }}
          >
            Start over
          </button>
        </div>

        <section>
          <SectionHeader letter="C" title="Core Identifiers" subtitle="Identity and contact details of the patient." />
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-firstName`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  First name <span className="text-red-500">*</span>
                </label>
                <input
                  id={`${uid}-firstName`}
                  type="text"
                  required
                  placeholder="e.g. Ramesh"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-lastName`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  Last name
                </label>
                <input
                  id={`${uid}-lastName`}
                  type="text"
                  placeholder="e.g. Kumar"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-age`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  Age (years) <span className="text-red-500">*</span>
                </label>
                <input
                  id={`${uid}-age`}
                  type="number"
                  required
                  min={0}
                  max={130}
                  placeholder="e.g. 45"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-gender`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  Gender
                </label>
                <select
                  id={`${uid}-gender`}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="unknown">Prefer not to say</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor={`${uid}-phone`} className="mb-1.5 block text-sm font-medium text-gray-800">
                Mobile number <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <span className="flex shrink-0 items-center rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-700">
                  +91
                </span>
                <input
                  id={`${uid}-phone`}
                  type="tel"
                  inputMode="numeric"
                  required
                  placeholder="10-digit number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className={inputCls}
                />
              </div>
            </div>

            {abhaId ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <span className="font-medium text-gray-800">ABHA ID</span>
                <p className="mt-1 font-mono text-gray-900">{abhaId}</p>
              </div>
            ) : (
              <div>
                <label htmlFor={`${uid}-abha-manual`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  ABHA ID <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id={`${uid}-abha-manual`}
                  type="text"
                  placeholder="e.g. if you have a health ID number"
                  value={abhaId}
                  onChange={(e) => setAbhaId(e.target.value)}
                  className={inputCls}
                />
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <p className="text-sm font-semibold text-gray-900">
                Consent under the DPDP Act 2023
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Read these out to the patient and tick what they agree to. Each one is recorded
                separately and can be withdrawn later from their record.
              </p>

              <label className="mt-3 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-blue-600"
                />
                <span className="text-sm text-gray-800">
                  <span className="font-medium">{CONSENT_PURPOSES[0].label}</span>
                  <span className="ml-1 text-red-500">*</span>
                  <span className="block text-xs text-gray-600">{CONSENT_PURPOSES[0].description}</span>
                </span>
              </label>

              {CONSENT_PURPOSES.slice(1).map((p) => (
                <label key={p.key} className="mt-2.5 flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={consentPurposes.includes(p.key)}
                    onChange={(e) =>
                      setConsentPurposes((prev) =>
                        e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key),
                      )
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-blue-600"
                  />
                  <span className="text-sm text-gray-800">
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-gray-600">{p.description}</span>
                  </span>
                </label>
              ))}

              <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-600">
                {officer?.name ? (
                  <p>
                    Questions or complaints about personal data go to{" "}
                    <span className="font-medium text-gray-800">{officer.name}</span>
                    {officer.phone ? `, ${officer.phone}` : ""}
                    {officer.email ? `, ${officer.email}` : ""}.
                    {officer.data_retention_years
                      ? ` Records are kept for ${officer.data_retention_years} years.`
                      : ""}
                  </p>
                ) : (
                  <p className="text-amber-700">
                    No grievance officer has been set for this hospital yet. The DPDP Act requires one
                    to be published — an administrator can add it under Privacy &amp; data rights.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader letter="D" title="Basic Demographics" subtitle="Address and location details." />
          <div className="space-y-4">
            <div>
              <label htmlFor={`${uid}-addr1`} className="mb-1.5 block text-sm font-medium text-gray-800">
                Address line 1
              </label>
              <input
                id={`${uid}-addr1`}
                type="text"
                placeholder="House / flat number, street"
                value={addr1}
                onChange={(e) => setAddr1(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor={`${uid}-addr2`} className="mb-1.5 block text-sm font-medium text-gray-800">
                Address line 2
              </label>
              <input
                id={`${uid}-addr2`}
                type="text"
                placeholder="Area, landmark (optional)"
                value={addr2}
                onChange={(e) => setAddr2(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor={`${uid}-city`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  City
                </label>
                <input
                  id={`${uid}-city`}
                  type="text"
                  placeholder="e.g. Delhi"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-state`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  State
                </label>
                <select
                  id={`${uid}-state`}
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-pin`} className="mb-1.5 block text-sm font-medium text-gray-800">
                  PIN code
                </label>
                <input
                  id={`${uid}-pin`}
                  type="text"
                  inputMode="numeric"
                  placeholder="6 digits"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionHeader
            letter="E"
            title="Health Alerts"
            subtitle="Optional — helps flag important conditions during consultations."
          />
          <div className="space-y-4">
            <TagListInput
              id={`${uid}-allergies`}
              label="Known allergies"
              placeholder="e.g. Penicillin, Peanuts"
              items={allergies}
              onAdd={(v) => setAllergies((a) => [...a, v])}
              onRemove={(v) => setAllergies((a) => a.filter((x) => x !== v))}
            />
            <TagListInput
              id={`${uid}-conditions`}
              label="Chronic conditions"
              placeholder="e.g. Diabetes Type 2, Hypertension"
              items={conditions}
              onAdd={(v) => setConditions((a) => [...a, v])}
              onRemove={(v) => setConditions((a) => a.filter((x) => x !== v))}
            />
          </div>
        </section>
      </div>
    </>
  );

  if (variant === "modal") {
    return (
      <form onSubmit={regStep === "demographics" ? handleFinalSubmit : (e) => e.preventDefault()} className="pb-4">
        {duplicateCandidate && (
          <div className="mb-4">
            <DuplicateReviewPanel
              candidate={duplicateCandidate}
              onSame={handleDuplicateSame}
              onDifferent={handleDuplicateDifferent}
              onCancel={() => setDuplicateCandidate(null)}
            />
          </div>
        )}
        {regStep !== "demographics" ? identitySteps : demographicsBody}
        <div className="sticky bottom-0 z-10 -mx-5 mt-6 border-t border-gray-200 bg-white px-5 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            {regStep === "demographics" && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl bg-blue-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Creating patient…" : "Create patient"}
              </button>
            )}
          </div>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={regStep === "demographics" ? handleFinalSubmit : (e) => e.preventDefault()}
      className="mt-8"
    >
      {duplicateCandidate && (
        <div className="mx-auto mb-4 max-w-3xl">
          <DuplicateReviewPanel
            candidate={duplicateCandidate}
            onSame={handleDuplicateSame}
            onDifferent={handleDuplicateDifferent}
            onCancel={() => setDuplicateCandidate(null)}
          />
        </div>
      )}
      {regStep !== "demographics" ? identitySteps : demographicsBody}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white px-4 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            ← Back to search
          </button>
          {regStep === "demographics" && (
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-blue-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creating patient…" : "Create DocPad patient →"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
