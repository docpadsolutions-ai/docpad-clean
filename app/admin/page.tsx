"use client";

import { useCallback, useState } from "react";
import { PermissionGate } from "../components/PermissionGate";
import { supabase } from "../supabase";

const ORG_ID = "e90e4607-dd60-4821-b736-02a2577432e0";

/** UI labels → exact `invitations.role` / `practitioners.role` values stored in DB. */
const INVITE_ROLE_TO_DB = {
  Doctor: "doctor",
  Nurse: "nurse",
  Receptionist: "receptionist",
  Pharmacist: "pharmacist",
  Admin: "admin",
  "Lab Tech": "lab_technician",
} as const;

const PRIMARY_ROLES = [
  "Doctor",
  "Nurse",
  "Receptionist",
  "Pharmacist",
  "Admin",
  "Lab Tech",
] as const satisfies readonly (keyof typeof INVITE_ROLE_TO_DB)[];
type PrimaryRole = (typeof PRIMARY_ROLES)[number];

const DOCTOR_DESIGNATIONS = [
  "Senior Consultant",
  "Consultant",
  "Associate Professor",
  "Assistant Professor",
  "Senior Resident",
  "Junior Resident",
] as const;
type DoctorDesignation = (typeof DOCTOR_DESIGNATIONS)[number];

const selectClassName =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none ring-blue-500/30 transition focus:border-blue-600 focus:ring-2";

export default function AdminPage() {
  const [email, setEmail] = useState("");
  const [primaryRole, setPrimaryRole] = useState<PrimaryRole>("Doctor");
  const [designation, setDesignation] = useState<DoctorDesignation>("Consultant");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const copyInviteLink = useCallback(async () => {
    if (!inviteUrl?.trim()) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyFeedback("Copied to clipboard");
      window.setTimeout(() => setCopyFeedback(null), 2500);
    } catch {
      setCopyFeedback("Could not copy — select the link and copy manually");
      window.setTimeout(() => setCopyFeedback(null), 3500);
    }
  }, [inviteUrl]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSuccess(false);
    setError(null);
    setInviteUrl(null);
    setCopyFeedback(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter an email address.");
      return;
    }

    setIsLoading(true);

    const roleForDb = INVITE_ROLE_TO_DB[primaryRole];
    const designationForDb =
      primaryRole === "Doctor" ? designation.toLowerCase() : null;

    const { data: inviteData, error: insertError } = await supabase
      .from("invitations")
      .insert({
        email: trimmed,
        role: roleForDb,
        designation: designationForDb,
        hospital_id: ORG_ID,
      })
      .select("token")
      .single();

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    try {
      const inviteRes = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          role: roleForDb,
          designation: designationForDb,
          token: inviteData.token,
        }),
      });
      const inviteBody = (await inviteRes.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        inviteUrl?: string;
      };
      if (!inviteRes.ok) {
        setError(inviteBody.error ?? `Invite email failed (${inviteRes.status}).`);
        setIsLoading(false);
        return;
      }
      const url =
        typeof inviteBody.inviteUrl === "string" && inviteBody.inviteUrl.trim() !== ""
          ? inviteBody.inviteUrl.trim()
          : null;
      setInviteUrl(url);
    } catch (err) {
      console.error("Failed to send email", err);
      setError(err instanceof Error ? err.message : "Could not reach invite service.");
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setSuccess(true);
    setEmail("");
  }

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Invite staff to DocPad</p>

        <PermissionGate
          permission="can_invite_staff"
          fallback={
            <div
              className="mt-8 rounded-xl border border-gray-100 bg-white p-8 text-sm text-gray-600 shadow-sm"
              role="status"
            >
              You don&apos;t have permission to invite staff. Ask a hospital administrator.
            </div>
          }
        >
        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-6 rounded-xl border border-gray-100 bg-white p-8 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-gray-900">Invite staff</h2>

          {success ? (
            <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
              <p role="status" className="font-medium">
                Invitation created. {inviteUrl ? "Copy the link below and share it with the invitee." : "Check your email."}
              </p>
              {inviteUrl ? (
                <div className="space-y-2">
                  <label htmlFor="invite-url-display" className="sr-only">
                    Invite link
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                    <input
                      id="invite-url-display"
                      type="text"
                      readOnly
                      value={inviteUrl}
                      className="min-w-0 flex-1 rounded-lg border border-green-200/80 bg-white px-3 py-2 font-mono text-xs text-gray-900 shadow-inner"
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      type="button"
                      onClick={() => void copyInviteLink()}
                      className="shrink-0 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800"
                    >
                      Copy link
                    </button>
                  </div>
                  {copyFeedback ? (
                    <p className="text-xs text-green-800" role="status" aria-live="polite">
                      {copyFeedback}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          <div>
            <label htmlFor="invite-email" className="mb-2 block text-sm font-medium text-gray-800">
              Email
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="doctor@hospital.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSuccess(false);
                setError(null);
                setInviteUrl(null);
                setCopyFeedback(null);
              }}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none ring-blue-500/30 transition focus:border-blue-600 focus:ring-2"
            />
          </div>

          <div className="space-y-0">
            <div>
              <label htmlFor="invite-primary-role" className="mb-2 block text-sm font-medium text-gray-800">
                Role
              </label>
              <select
                id="invite-primary-role"
                name="primaryRole"
                value={primaryRole}
                onChange={(e) => {
                  const v = e.target.value as PrimaryRole;
                  setPrimaryRole(v);
                  setSuccess(false);
                  setError(null);
                  setInviteUrl(null);
                  setCopyFeedback(null);
                }}
                className={selectClassName}
              >
                {PRIMARY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                primaryRole === "Doctor" ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
              aria-hidden={primaryRole !== "Doctor"}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={`transition-opacity duration-200 ${
                    primaryRole === "Doctor" ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <label htmlFor="invite-designation" className="mb-2 mt-4 block text-sm font-medium text-gray-800">
                    Sub-role
                  </label>
                  <select
                    id="invite-designation"
                    name="designation"
                    value={designation}
                    tabIndex={primaryRole === "Doctor" ? 0 : -1}
                    onChange={(e) => {
                      setDesignation(e.target.value as DoctorDesignation);
                      setSuccess(false);
                      setError(null);
                      setInviteUrl(null);
                      setCopyFeedback(null);
                    }}
                    className={selectClassName}
                  >
                    {DOCTOR_DESIGNATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Sending…" : "Send Invite"}
          </button>
        </form>
        </PermissionGate>
      </div>
    </div>
  );
}
