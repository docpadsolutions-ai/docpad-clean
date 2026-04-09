"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/app/supabase";

export type ABHALinkPatient = {
  id: string;
  name: string;
  gender: "M" | "F" | "O";
  yearOfBirth: number;
};

export type ABHALinkPhase = "idle" | "otp_sent" | "linked" | "error";

function pickTxnId(abdm: Record<string, unknown> | null | undefined): string {
  if (!abdm) return "";
  const candidates = [
    abdm.txnId,
    abdm.transactionId,
    abdm.txn_id,
    abdm.transaction_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  const nested = abdm.auth as Record<string, unknown> | undefined;
  if (nested) {
    const t = nested.transactionId ?? nested.txnId;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return "";
}

function pickMobileLinked(abdm: Record<string, unknown> | null | undefined): boolean {
  if (!abdm) return true;
  const v = abdm.mobileLinked ?? abdm.mobile_linked ?? abdm.mobileOtpSent ?? abdm.mobile_otp_sent;
  if (typeof v === "boolean") return v;
  if (v === "N" || v === false || v === 0) return false;
  return true;
}

function pickLinkedAbha(abdm: Record<string, unknown> | null | undefined): string | null {
  if (!abdm) return null;
  const keys = [
    "abhaNumber",
    "abha_number",
    "healthId",
    "health_id",
    "abhaAddress",
    "abha_address",
  ];
  for (const k of keys) {
    const v = abdm[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const link = abdm.link as Record<string, unknown> | undefined;
  if (link) {
    for (const k of keys) {
      const v = link[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * ABHA ↔ patient linking via `abha-link-init` / `abha-link-confirm` Edge Functions (M2).
 */
export function useABHALinking(patient: ABHALinkPatient | null) {
  const [phase, setPhase] = useState<ABHALinkPhase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const [lastAbdm, setLastAbdm] = useState<Record<string, unknown> | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTxnId(null);
    setLastAbdm(null);
  }, []);

  const sendInit = useCallback(
    async (abhaNumber: string, opts?: { authMode?: "aadhaar_otp" | "mobile_otp" }) => {
      if (!patient?.id) {
        const msg = "Patient context is missing.";
        setError(msg);
        setPhase("error");
        return { ok: false as const, error: msg };
      }
      const num = abhaNumber.replace(/\s/g, "").trim();
      if (!num) {
        const msg = "Enter an ABHA number or address.";
        setError(msg);
        return { ok: false as const, error: msg };
      }

      setBusy(true);
      setError(null);
      try {
        const requestBody: Record<string, unknown> = {
          abhaNumber: num,
          patient: {
            id: patient.id,
            name: patient.name,
            gender: patient.gender,
            yearOfBirth: patient.yearOfBirth,
          },
        };
        if (opts?.authMode) requestBody.authMode = opts.authMode;

        const { data, error: fnErr } = await supabase.functions.invoke("abha-link-init", {
          body: requestBody,
        });

        if (fnErr) {
          throw new Error(fnErr.message);
        }

        const body = data as {
          ok?: boolean;
          error?: string;
          abdm?: Record<string, unknown>;
        };

        if (body?.ok === false) {
          throw new Error(body.error ?? "Link init failed");
        }

        const abdm = (body?.abdm ?? null) as Record<string, unknown> | null;
        setLastAbdm(abdm);
        const tid = pickTxnId(abdm);
        setTxnId(tid || null);
        setPhase("otp_sent");
        const mobileLinked = pickMobileLinked(abdm);
        return { ok: true as const, txnId: tid, mobileLinked };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPhase("error");
        return { ok: false as const, error: msg };
      } finally {
        setBusy(false);
      }
    },
    [patient],
  );

  const confirmOtp = useCallback(async (otp: string) => {
    const code = otp.replace(/\D/g, "").trim();
    if (code.length < 4) {
      const msg = "Enter the OTP from the patient.";
      setError(msg);
      return { ok: false as const, error: msg };
    }
    if (!txnId) {
      const msg = "Send OTP first (no transaction id yet).";
      setError(msg);
      return { ok: false as const, error: msg };
    }

    setBusy(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("abha-link-confirm", {
        body: { otp: code, txnId },
      });

      if (fnErr) {
        throw new Error(fnErr.message);
      }

      const body = data as {
        ok?: boolean;
        error?: string;
        abdm?: Record<string, unknown>;
      };

      if (body?.ok === false) {
        throw new Error(body.error ?? "OTP confirmation failed");
      }

      const abdm = (body?.abdm ?? null) as Record<string, unknown> | null;
      setLastAbdm(abdm);
      setPhase("linked");
      const linked = pickLinkedAbha(abdm);
      return { ok: true as const, linkedAbha: linked, abdm };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase("error");
      return { ok: false as const, error: msg };
    } finally {
      setBusy(false);
    }
  }, [txnId]);

  return {
    phase,
    busy,
    error,
    txnId,
    lastAbdm,
    sendInit,
    confirmOtp,
    reset,
  };
}
