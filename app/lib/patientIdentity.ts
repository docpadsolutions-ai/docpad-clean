import { supabase } from "../supabase";

/**
 * Client-side SHA-256 of the Aadhaar string (12 digits). Raw value is never sent to Supabase — only this hex digest.
 */
export async function hashAadhaar(aadhaarStr: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("SHA-256 is only available in the browser.");
  }
  const msgBuffer = new TextEncoder().encode(aadhaarStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** UTF-8 bytes → hex SHA-256 (same as {@link hashAadhaar} for UTF-8 input). */
export async function sha256HexUtf8(plain: string): Promise<string> {
  return hashAadhaar(plain);
}

/** Keep digits only; caller validates length. */
export function normalizeAadhaarDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export type CheckPatientExistsResult = {
  match: boolean;
  fullName: string | null;
  docpadId: string | null;
  error: Error | null;
};

/**
 * Calls `public.check_patient_exists(p_aadhaar_hash text)`.
 *
 * Expected shapes (any one):
 * - ABDM / DocPad: `{ existing_name, existing_docpad_id }` or table row with those columns
 * - `{ matched: true, patient_full_name, patient_docpad_id }` or `full_name` / `docpad_id`
 * - Returns a setof / table — first row used
 * - Returns `boolean` (match with no details)
 *
 * ```sql
 * create or replace function public.check_patient_exists(p_aadhaar_hash text)
 * returns table (matched boolean, patient_full_name text, patient_docpad_id text)
 * language sql stable security definer
 * set search_path = public, identity_vault
 * as $$
 *   select true, p.full_name, p.docpad_id
 *   from identity_vault.patient_identity_link l
 *   join public.patients p on p.id = l.patient_id
 *   where l.aadhaar_hash = p_aadhaar_hash
 *   limit 1;
 * $$;
 * ```
 */
export async function checkPatientExistsByAadhaarHash(
  aadhaarSha256Hex: string,
): Promise<CheckPatientExistsResult> {
  const hash = aadhaarSha256Hex.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return { match: false, fullName: null, docpadId: null, error: new Error("Invalid identity hash.") };
  }

  const { data, error } = await supabase.rpc("check_patient_exists", {
    p_aadhaar_hash: hash,
  });

  if (error) {
    return { match: false, fullName: null, docpadId: null, error: new Error(error.message) };
  }

  if (typeof data === "boolean") {
    return {
      match: data,
      fullName: null,
      docpadId: null,
      error: null,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row == null || typeof row !== "object") {
    return { match: false, fullName: null, docpadId: null, error: null };
  }

  const o = row as Record<string, unknown>;
  const existingName = o.existing_name ?? o.patient_full_name ?? o.full_name ?? o.name;
  const existingDocpad = o.existing_docpad_id ?? o.patient_docpad_id ?? o.docpad_id ?? o.docpadid;
  const hasIdentityHint =
    (existingName != null && String(existingName).trim() !== "") ||
    (existingDocpad != null && String(existingDocpad).trim() !== "");
  const match = Boolean(o.matched ?? o.match ?? o.exists ?? o.found) || hasIdentityHint;
  const fullNameRaw = existingName;
  const docpadRaw = existingDocpad;

  return {
    match,
    fullName: fullNameRaw != null && String(fullNameRaw).trim() !== "" ? String(fullNameRaw).trim() : null,
    docpadId: docpadRaw != null && String(docpadRaw).trim() !== "" ? String(docpadRaw).trim() : null,
    error: null,
  };
}
