"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DocPadLogoMark } from "../DocPadLogoMark";
import { supabase } from "../../supabase";
import {
  completeInvitationSignupRpcArgs,
  isAuthUserAlreadyRegisteredError,
  type InviteProfileFields,
} from "../../lib/inviteSignupAuth";
import {
  classifyInviteRole,
  validateDoctorSignUp,
  validateStaffSignUp,
  type DoctorSignUpFields,
  type StaffSignUpFields,
} from "../../lib/joinSignUpValidation";

const SPECIALTIES = [
  "General Medicine",
  "General Surgery",
  "Pediatrics",
  "Gynecology & Obstetrics",
  "Cardiology",
  "Orthopedics",
  "Neurology",
  "Dermatology",
  "Ophthalmology",
  "ENT",
  "Emergency Medicine",
  "Radiology",
  "Pathology",
  "Anesthesiology",
  "Psychiatry",
  "Other",
];

const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20";

const selectCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem] bg-[right_0.5rem_center] bg-no-repeat pr-9";

function Req() {
  return <span className="ml-0.5 text-red-500">*</span>;
}

function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-700">
      {children}
      {required && <Req />}
    </label>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.4 9.4 0 0112 5c6.5 0 10 7 10 7a18.5 18.5 0 01-5.1 5.3M6.2 6.2C3.8 8.1 2 12 2 12s3.5 7 10 7a9.7 9.7 0 004.7-1.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 8v1M12 11v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function JoinFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");
  const emailParam = searchParams.get("email");

  type PageStatus = "loading" | "invalid" | "valid";
  const [pageStatus, setPageStatus] = useState<PageStatus>("loading");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [invitationOrgId, setInvitationOrgId] = useState<string | null>(null);
  const [invitationRole, setInvitationRole] = useState<string | null>(null);
  const [invitationDesignation, setInvitationDesignation] = useState<string | null>(null);
  const [roleKind, setRoleKind] = useState<"doctor" | "staff" | null>(null);

  const [doctorFullName, setDoctorFullName] = useState("");
  const [doctorMedReg, setDoctorMedReg] = useState("");
  const [doctorQualifications, setDoctorQualifications] = useState("");
  const [doctorSpecialization, setDoctorSpecialization] = useState("");
  const [doctorPhone, setDoctorPhone] = useState("");

  const [staffFullName, setStaffFullName] = useState("");
  const [staffPhone, setStaffPhone] = useState("");
  const [staffNotes, setStaffNotes] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  const [consentAccurate, setConsentAccurate] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitErrorRef = useRef<HTMLDivElement>(null);

  const consentsComplete = consentAccurate && consentTerms;

  useLayoutEffect(() => {
    if (submitError && submitErrorRef.current) {
      submitErrorRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [submitError]);

  useEffect(() => {
    if (!tokenParam && !emailParam?.trim()) {
      setPageStatus("invalid");
      return;
    }
    let cancelled = false;

    async function loadInvitation() {
      type InviteRow = {
        token: string;
        email: string;
        hospital_id: string | null;
        role: string | null;
        designation: string | null;
      };

      let data: InviteRow | null = null;

      if (tokenParam) {
        const { data: row, error } = await supabase
          .from("invitations")
          .select("token, email, hospital_id, role, designation")
          .eq("token", tokenParam)
          .eq("status", "pending")
          .maybeSingle();
        if (cancelled) return;
        if (error || !row) {
          setPageStatus("invalid");
          return;
        }
        data = row as InviteRow;
      } else {
        const em = emailParam!.trim().toLowerCase();
        const { data: rows, error } = await supabase
          .from("invitations")
          .select("token, email, hospital_id, role, designation")
          .eq("email", em)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (error || !rows?.length) {
          setPageStatus("invalid");
          return;
        }
        data = rows[0] as InviteRow;
      }

      const roleStr = data.role != null && String(data.role).trim() !== "" ? String(data.role).trim() : null;
      const kind = classifyInviteRole(roleStr);
      if (kind === "unknown") {
        setPageStatus("invalid");
        return;
      }

      setInviteToken(data.token);
      setEmail(String(data.email ?? ""));
      setInvitationOrgId(data.hospital_id != null ? String(data.hospital_id) : null);
      setInvitationRole(roleStr);
      const des = data.designation != null ? String(data.designation).trim() : "";
      setInvitationDesignation(des || null);
      setRoleKind(kind);
      setPageStatus("valid");
    }

    void loadInvitation();
    return () => {
      cancelled = true;
    };
  }, [tokenParam, emailParam]);

  async function handleSignUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    if (!consentAccurate || !consentTerms) {
      setSubmitError("Please accept both consent checkboxes to continue.");
      return;
    }

    const token = inviteToken;
    if (!token) {
      setSubmitError("Missing invitation.");
      return;
    }
    if (invitationOrgId == null || invitationOrgId === "") {
      setSubmitError("Invalid invitation. Please refresh the page or use your invite link again.");
      return;
    }
    if (roleKind == null) {
      setSubmitError("Invalid invitation.");
      return;
    }

    let validationError: string | null = null;
    if (roleKind === "doctor") {
      const f: DoctorSignUpFields = {
        fullName: doctorFullName,
        medicalRegNumber: doctorMedReg,
        qualifications: doctorQualifications,
        specialization: doctorSpecialization,
        phone: doctorPhone,
        password,
        confirmPassword,
      };
      validationError = validateDoctorSignUp(f);
    } else {
      const f: StaffSignUpFields = {
        fullName: staffFullName,
        phone: staffPhone,
        experienceNotes: staffNotes,
        password,
        confirmPassword,
      };
      validationError = validateStaffSignUp(f);
    }
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setIsSubmitting(true);

    const fullName =
      roleKind === "doctor" ? doctorFullName.trim() : staffFullName.trim();

    const inviteUserData: Record<string, string> = {
      invite_token: token,
      full_name: fullName,
    };
    if (roleKind === "doctor") {
      inviteUserData.hpr_id = doctorMedReg.trim();
      inviteUserData.qualification = doctorQualifications.trim();
      inviteUserData.specialization = doctorSpecialization.trim();
      const d = doctorPhone.replace(/\D/g, "");
      if (d.length >= 10) {
        inviteUserData.phone = `+91${d.slice(-10)}`;
      }
    } else {
      const s = staffPhone.replace(/\D/g, "");
      if (s.length >= 10) {
        inviteUserData.phone = `+91${s.slice(-10)}`;
      }
      const notes = staffNotes.trim();
      if (notes) {
        inviteUserData.staff_notes = notes;
      }
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: inviteUserData },
    });

    if (!authError && authData.user?.id) {
      setIsSubmitting(false);
      router.push("/dashboard");
      return;
    }

    if (authError && isAuthUserAlreadyRegisteredError(authError)) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setIsSubmitting(false);
        setSubmitError(
          signInError.message.toLowerCase().includes("invalid")
            ? "This email already has an account. Enter the correct password for that account to accept this invite."
            : signInError.message,
        );
        return;
      }

      const profileForRpc: InviteProfileFields =
        roleKind === "doctor"
          ? {
              roleKind: "doctor",
              fullName,
              doctorMedReg,
              doctorQualifications,
              doctorSpecialization,
              doctorPhone,
              staffPhone: "",
              staffNotes: "",
            }
          : {
              roleKind: "staff",
              fullName,
              doctorMedReg: "",
              doctorQualifications: "",
              doctorSpecialization: "",
              doctorPhone: "",
              staffPhone,
              staffNotes,
            };

      const { error: rpcError } = await supabase.rpc(
        "complete_invitation_signup",
        completeInvitationSignupRpcArgs(token, profileForRpc),
      );
      if (rpcError) {
        setIsSubmitting(false);
        setSubmitError(rpcError.message);
        return;
      }

      setIsSubmitting(false);
      router.push("/dashboard");
      return;
    }

    if (authError) {
      setIsSubmitting(false);
      setSubmitError(authError.message);
      return;
    }

    setIsSubmitting(false);
    setSubmitError(
      "Account could not be created. Try again or check your email for a confirmation link.",
    );
  }

  if (pageStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <svg className="h-8 w-8 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-label="Loading">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
      </div>
    );
  }

  if (pageStatus === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
        <div className="w-full max-w-md rounded-xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <svg
              className="h-7 w-7 text-amber-700"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-amber-900">Invitation needed</h1>
          <p className="mt-3 text-sm leading-relaxed text-amber-950/90">
            Invalid or expired invitation link. Please contact the hospital admin.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-sm font-semibold text-amber-800 hover:underline"
          >
            ← Back to Login
          </Link>
        </div>
      </div>
    );
  }

  const headline =
    roleKind === "doctor" ? "Create your clinical account" : "Join your hospital team";
  const sub =
    roleKind === "doctor"
      ? "Complete your profile to start seeing patients on DocPad."
      : "A few quick details — then you’re in.";

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <div className="mx-auto max-w-lg px-6 pt-8 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex w-fit items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-800"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to Login
          </Link>
          <div className="flex items-center gap-2.5">
            <DocPadLogoMark className="h-10 w-10" />
            <div>
              <p className="text-sm font-bold leading-tight text-gray-900">DocPad</p>
              <p className="text-xs text-gray-500">Hospital workspace</p>
            </div>
          </div>
        </div>
        <h1 className="mt-8 text-2xl font-bold tracking-tight text-gray-900">{headline}</h1>
        <p className="mt-1 text-sm text-gray-600">{sub}</p>
      </div>

      <div className="mx-auto max-w-lg px-6">
        <form onSubmit={handleSignUp} className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-start gap-3 rounded-lg bg-blue-50 px-4 py-3">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <p className="text-sm text-blue-900">
              {roleKind === "doctor" ? (
                <>
                  Fields marked with <span className="font-medium text-red-600">*</span> are required for
                  licensed clinicians.
                </>
              ) : (
                <>
                  Only your <span className="font-medium">name</span> is required besides email and password.
                  Other fields are optional.
                </>
              )}
            </p>
          </div>

          <div className="mb-6">
            <FieldLabel htmlFor="emailField" required>
              Email
            </FieldLabel>
            <input
              id="emailField"
              type="email"
              value={email}
              readOnly
              className={`${inputCls} cursor-not-allowed bg-gray-50 text-gray-600`}
            />
          </div>

          {roleKind === "doctor" ? (
            <section className="mb-8 space-y-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Doctor profile</h2>
              <div>
                <FieldLabel htmlFor="doc-full-name" required>
                  Full name
                </FieldLabel>
                <input
                  id="doc-full-name"
                  type="text"
                  autoComplete="name"
                  placeholder="As it should appear on prescriptions"
                  value={doctorFullName}
                  onChange={(e) => setDoctorFullName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <FieldLabel htmlFor="doc-med-reg" required>
                  Medical registration number
                </FieldLabel>
                <input
                  id="doc-med-reg"
                  type="text"
                  placeholder="e.g. NMC registration number"
                  value={doctorMedReg}
                  onChange={(e) => setDoctorMedReg(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <FieldLabel htmlFor="doc-qual" required>
                  Degrees / qualifications
                </FieldLabel>
                <input
                  id="doc-qual"
                  type="text"
                  placeholder="e.g. MBBS, MD (Medicine)"
                  value={doctorQualifications}
                  onChange={(e) => setDoctorQualifications(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <FieldLabel htmlFor="doc-spec" required>
                  Specialization
                </FieldLabel>
                <select
                  id="doc-spec"
                  value={doctorSpecialization}
                  onChange={(e) => setDoctorSpecialization(e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select specialization</option>
                  {SPECIALTIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel htmlFor="doc-phone" required>
                  Phone
                </FieldLabel>
                <div className="flex gap-2">
                  <span className="flex items-center rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm font-medium whitespace-nowrap text-gray-700">
                    +91
                  </span>
                  <input
                    id="doc-phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="9876543210"
                    value={doctorPhone}
                    onChange={(e) => setDoctorPhone(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </section>
          ) : (
            <section className="mb-8 space-y-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Your details</h2>
              <div>
                <FieldLabel htmlFor="staff-full-name" required>
                  Full name
                </FieldLabel>
                <input
                  id="staff-full-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Name shown in the app"
                  value={staffFullName}
                  onChange={(e) => setStaffFullName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <FieldLabel htmlFor="staff-phone">Phone number</FieldLabel>
                <div className="flex gap-2">
                  <span className="flex items-center rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm font-medium whitespace-nowrap text-gray-700">
                    +91
                  </span>
                  <input
                    id="staff-phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="Optional"
                    value={staffPhone}
                    onChange={(e) => setStaffPhone(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="staff-notes">Experience / notes</FieldLabel>
                <textarea
                  id="staff-notes"
                  rows={3}
                  placeholder="Optional — years of experience, department, etc."
                  value={staffNotes}
                  onChange={(e) => setStaffNotes(e.target.value)}
                  className={inputCls}
                />
              </div>
            </section>
          )}

          <section className="mb-8 space-y-5 border-t border-gray-100 pt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Account</h2>
            <div>
              <FieldLabel htmlFor="password" required>
                Password
              </FieldLabel>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition hover:text-gray-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="confirmPassword" required>
                Confirm password
              </FieldLabel>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirmPass ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`${inputCls} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition hover:text-gray-600"
                  aria-label={showConfirmPass ? "Hide password" : "Show password"}
                >
                  {showConfirmPass ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </section>

          <section className="mb-8 space-y-4 border-t border-gray-100 pt-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Consent</h2>
            <label className="flex cursor-pointer gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={consentAccurate}
                onChange={(e) => setConsentAccurate(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-blue-600"
              />
              <span>
                {roleKind === "doctor" ? (
                  <>
                    I confirm that the information provided is accurate and I am a licensed medical
                    professional.
                    <Req />
                  </>
                ) : (
                  <>
                    I confirm that the information I provided is accurate.
                    <Req />
                  </>
                )}
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={consentTerms}
                onChange={(e) => setConsentTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-blue-600"
              />
              <span>
                I agree to DocPad&apos;s Terms of Service and Privacy Policy.
                <Req />
              </span>
            </label>
          </section>

          <div ref={submitErrorRef} className="min-h-0 scroll-mt-4">
            {submitError ? (
              <div
                role="alert"
                aria-live="assertive"
                className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 shadow-sm"
              >
                {submitError}
              </div>
            ) : null}
          </div>

          <div className="border-t border-gray-100 pt-6">
            {!consentsComplete ? (
              <p className="mb-3 text-sm text-gray-500">Accept both consent boxes to enable Sign up.</p>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href="/"
                className="rounded-lg border border-gray-300 px-5 py-2.5 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Back to Login
              </Link>
              <button
                type="submit"
                disabled={isSubmitting || !consentsComplete}
                className="rounded-lg bg-blue-600 px-8 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
              >
                {isSubmitting ? "Creating account…" : "Sign up"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
