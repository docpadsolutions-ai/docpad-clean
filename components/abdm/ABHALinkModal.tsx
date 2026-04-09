"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { useABHALinking, type ABHALinkPatient } from "@/hooks/useABHALinking";

export type AbdmPatientForLink = {
  id: string;
  full_name: string | null;
  sex: string | null;
  age_years: number | null;
};

export type AbhaAuthMethod = "aadhaar_otp" | "mobile_otp";

type Props = {
  open: boolean;
  onClose: () => void;
  patient: AbdmPatientForLink;
  abhaId?: string | null;
  onLinked?: (abha: string) => void;
};

function mapSexToAbdm(s: string | null | undefined): "M" | "F" | "O" {
  const v = (s ?? "").toLowerCase();
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m")) return "M";
  return "O";
}

/**
 * Multi-step ABHA link: auth method → identifier → OTP via `abha-link-init` / `abha-link-confirm`.
 */
export function ABHALinkModal({ open, onClose, patient, abhaId, onLinked }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [authMethod, setAuthMethod] = useState<AbhaAuthMethod | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [mobileLinked, setMobileLinked] = useState(true);

  const linkPatient: ABHALinkPatient | null = useMemo(() => {
    const id = patient.id?.trim();
    if (!id) return null;
    const yob =
      patient.age_years != null && !Number.isNaN(Number(patient.age_years))
        ? new Date().getFullYear() - Number(patient.age_years)
        : 1990;
    return {
      id,
      name: patient.full_name?.trim() || "Patient",
      gender: mapSexToAbdm(patient.sex),
      yearOfBirth: yob,
    };
  }, [patient]);

  const { phase, busy, error, txnId, sendInit, confirmOtp, reset } = useABHALinking(linkPatient);

  const fullReset = useCallback(() => {
    setStep(1);
    setAuthMethod(null);
    setIdentifier("");
    setOtp("");
    setMobileLinked(true);
    reset();
  }, [reset]);

  useEffect(() => {
    if (!open) fullReset();
  }, [open, fullReset]);

  const closeModal = useCallback(() => {
    fullReset();
    onClose();
  }, [fullReset, onClose]);

  const handleSendInit = useCallback(async () => {
    if (!authMethod) {
      toast.error("Choose how to verify.");
      return;
    }
    const r = await sendInit(identifier, { authMode: authMethod });
    if (!r.ok) {
      if (r.error) toast.error(r.error);
      return;
    }
    setMobileLinked(r.mobileLinked);
    setStep(3);
    toast.success(
      r.mobileLinked
        ? "OTP sent — enter the code from the patient’s Aadhaar-linked mobile or ABHA flow."
        : "Link initiated. If no OTP appears, complete steps in ABHA / CM as directed.",
    );
  }, [authMethod, identifier, sendInit]);

  const handleConfirmOtp = useCallback(async () => {
    const r = await confirmOtp(otp);
    if (!r.ok) {
      if (r.error) toast.error(r.error);
      return;
    }
    const chosen = r.linkedAbha?.trim() || identifier.replace(/\s/g, "").trim();
    if (chosen) {
      const { error: upErr } = await supabase.from("patients").update({ abha_id: chosen }).eq("id", patient.id.trim());
      if (upErr) {
        toast.error(`ABDM ok but EMR update failed: ${upErr.message}`);
      } else {
        toast.success("ABHA linked.");
      }
      onLinked?.(chosen);
    } else {
      toast.success("ABHA linking completed.");
    }
    closeModal();
  }, [closeModal, confirmOtp, identifier, onLinked, otp, patient.id]);

  const linked = Boolean(abhaId?.trim());
  const showOtp = mobileLinked && (phase === "otp_sent" || (phase === "error" && txnId));

  if (!open || linked) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl" role="dialog" aria-modal>
        <h2 className="text-lg font-bold text-gray-900">Link ABHA</h2>
        <p className="mt-1 text-[11px] text-gray-500">
          {step === 1 && "Choose how the patient will verify."}
          {step === 2 && authMethod === "aadhaar_otp" && "Enter Aadhaar number to request OTP."}
          {step === 2 && authMethod === "mobile_otp" && "Enter mobile number registered with ABHA."}
          {step === 3 && "Enter the OTP to complete linking."}
        </p>
        {error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => {
                setAuthMethod("aadhaar_otp");
                setStep(2);
              }}
              className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-slate-100"
            >
              Aadhaar OTP
              <span className="mt-0.5 block text-[11px] font-normal text-gray-500">Verify using Aadhaar-linked OTP flow</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMethod("mobile_otp");
                setStep(2);
              }}
              className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-slate-100"
            >
              Mobile OTP
              <span className="mt-0.5 block text-[11px] font-normal text-gray-500">OTP to mobile registered with ABHA</span>
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 space-y-3">
            <button type="button" onClick={() => setStep(1)} className="text-xs font-semibold text-blue-600 hover:underline">
              ← Back
            </button>
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-700">
                {authMethod === "aadhaar_otp" ? "Aadhaar number" : "Mobile number"}
              </span>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder={authMethod === "aadhaar_otp" ? "12-digit Aadhaar" : "10-digit mobile"}
                inputMode="numeric"
              />
            </label>
            <button
              type="button"
              disabled={
                busy ||
                (authMethod === "aadhaar_otp" ? identifier.replace(/\D/g, "").length < 12 : identifier.replace(/\D/g, "").length < 10)
              }
              onClick={() => void handleSendInit()}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Request OTP"}
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => {
                setStep(2);
                setOtp("");
                reset();
              }}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              ← Back
            </button>
            {phase === "otp_sent" && !mobileLinked ? (
              <p className="text-xs text-amber-800">
                Gateway did not flag mobile OTP for this step. Finish linking in the ABHA app or retry.
              </p>
            ) : null}
            {showOtp ? (
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-700">OTP</span>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
                  inputMode="numeric"
                  placeholder="OTP"
                />
              </label>
            ) : (
              <p className="text-sm text-gray-600">Waiting for transaction…</p>
            )}
            {txnId ? <p className="font-mono text-[10px] text-gray-400">txnId: {txnId}</p> : null}
            {showOtp ? (
              <button
                type="button"
                disabled={busy || otp.length < 4}
                onClick={() => void handleConfirmOtp()}
                className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "…" : "Confirm & link"}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={closeModal} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
