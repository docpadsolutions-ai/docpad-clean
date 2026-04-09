import { supabase } from "../supabase";

/**
 * ABHA OTP — duplicate check uses hash-only RPC; ABDM bridge uses Edge Function `abha-enrol`
 * with raw 12-digit Aadhaar (in-memory on the client until OTP flow completes).
 *
 * `abha_verify_otp` may remain a Supabase RPC that maps hash + OTP server-side.
 */

function parseTxnId(data: unknown): string | null {
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const t = o.txn_id ?? o.txnId ?? o.transaction_id;
    if (t != null && String(t).trim() !== "") return String(t).trim();
  }
  return null;
}

export async function abhaSendOtp(aadhaarNumber12: string): Promise<
  { ok: true; txnId: string | null } | { ok: false; error: string }
> {
  const digits = aadhaarNumber12.replace(/\D/g, "");
  if (digits.length !== 12) {
    return { ok: false, error: "Aadhaar must be 12 digits for ABHA OTP." };
  }

  // Temporary bypass: Edge Function not deploying locally — mock success so stepper can reach OTP step.
  // const { data, error } = await supabase.functions.invoke("abha-enrol", {
  //   body: {
  //     aadhaar_number: digits,
  //     action: "GENERATE_OTP",
  //   },
  // });
  const data: Record<string, unknown> = {
    status: "SUCCESS",
    message: "Mock OTP Sent",
    txnId: "mock-123",
  };
  // Mock path: no Functions error. When restoring `invoke`, use: `if (error) return { ok: false, error: error.message || "..." };`

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    if (o.error != null && String(o.error).trim() !== "") {
      const detail = o.detail != null ? ` ${JSON.stringify(o.detail)}` : "";
      return { ok: false, error: `${String(o.error)}${detail}` };
    }
  }

  const txnId = parseTxnId(data);
  return { ok: true, txnId };
}

export async function abhaVerifyOtp(input: {
  aadhaarSha256Hex: string;
  otp: string;
  txnId?: string | null;
}): Promise<{ ok: true; abhaId: string | null } | { ok: false; error: string }> {
  const hash = input.aadhaarSha256Hex.trim().toLowerCase();
  const otp = input.otp.replace(/\D/g, "").trim();
  if (otp.length < 4) return { ok: false, error: "Enter the OTP you received." };

  const { data, error } = await supabase.rpc("abha_verify_otp", {
    p_aadhaar_hash: hash,
    p_otp: otp,
    p_txn_id: input.txnId?.trim() || null,
  });

  if (error) return { ok: false, error: error.message };

  let abhaId: string | null = null;
  if (typeof data === "string" && data.trim()) abhaId = data.trim();
  else if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const a = o.abha_id ?? o.abhaId ?? o.health_id;
    if (a != null && String(a).trim() !== "") abhaId = String(a).trim();
  }

  return { ok: true, abhaId };
}
