import { supabase } from "@/lib/supabase";

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
  /** Patient row id — present once `check_patient_exists`/`check_patient_exists_by_phone` return it (Sep 2026). */
  id: string | null;
  fullName: string | null;
  docpadId: string | null;
  /** Present once the RPCs return `existing_age_years` (Sep 2026). */
  ageYears: number | null;
  error: Error | null;
};

const NO_MATCH: CheckPatientExistsResult = {
  match: false,
  id: null,
  fullName: null,
  docpadId: null,
  ageYears: null,
  error: null,
};

/**
 * Shared parser for both duplicate-check RPCs. Tolerant of older/renamed column
 * shapes on purpose — this used to be duplicated inline in the registration form for
 * the Aadhaar case, and diverged, which is how the un-castable `existing_id` case slid
 * through untested. One parser now, used by both checks.
 */
function parseDuplicateRows(data: unknown): CheckPatientExistsResult {
  if (typeof data === "boolean") {
    return { ...NO_MATCH, match: data };
  }

  const rows = Array.isArray(data) ? data : data != null && typeof data === "object" ? [data] : [];
  const row0 = rows[0] as Record<string, unknown> | undefined;
  if (row0 == null) return NO_MATCH;

  const existingIdRaw = row0.existing_id ?? row0.id;
  const existingId = existingIdRaw != null && String(existingIdRaw).trim() !== "" ? String(existingIdRaw).trim() : null;

  const existingName = row0.existing_name ?? row0.patient_full_name ?? row0.full_name ?? row0.name;
  const existingDocpad = row0.existing_docpad_id ?? row0.patient_docpad_id ?? row0.docpad_id ?? row0.docpadid;
  const existingAgeRaw = row0.existing_age_years ?? row0.age_years;

  const hasIdentityHint =
    existingId != null ||
    (existingName != null && String(existingName).trim() !== "") ||
    (existingDocpad != null && String(existingDocpad).trim() !== "");
  const match = Boolean(row0.matched ?? row0.match ?? row0.exists ?? row0.found) || hasIdentityHint;

  return {
    match,
    id: existingId,
    fullName: existingName != null && String(existingName).trim() !== "" ? String(existingName).trim() : null,
    docpadId: existingDocpad != null && String(existingDocpad).trim() !== "" ? String(existingDocpad).trim() : null,
    ageYears: existingAgeRaw != null && !Number.isNaN(Number(existingAgeRaw)) ? Number(existingAgeRaw) : null,
    error: null,
  };
}

/**
 * Calls `public.check_patient_exists(p_aadhaar_hash text)`.
 * Returns `existing_id`, `existing_docpad_id`, `existing_name`, `existing_age_years` as of
 * the Sep 2026 mobile-duplicate-detection migration — enough to either display the match
 * or route straight to the existing chart, not just enough to print an error string.
 */
export async function checkPatientExistsByAadhaarHash(
  aadhaarSha256Hex: string,
): Promise<CheckPatientExistsResult> {
  const hash = aadhaarSha256Hex.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return { ...NO_MATCH, error: new Error("Invalid identity hash.") };
  }

  const { data, error } = await supabase.rpc("check_patient_exists", {
    p_aadhaar_hash: hash,
  });

  if (error) {
    return { ...NO_MATCH, error: new Error(error.message) };
  }

  return parseDuplicateRows(data);
}

/**
 * Calls `public.check_patient_exists_by_phone(p_phone text)`.
 *
 * The Aadhaar check above is the only duplicate check that existed before Sep 2026, so
 * a patient who has no Aadhaar — or who simply doesn't want to give it — had no
 * duplicate check run for them at all. This is the mobile-number equivalent: same
 * hospital-scoped lookup, same return shape, so the caller can treat either match the
 * same way. Pass the full E.164-ish number as stored on `patients.phone` (e.g. `+919876543210`);
 * the hash is computed server-side so the caller never has to keep the two hashing
 * schemes in sync.
 */
export async function checkPatientExistsByPhone(fullPhone: string): Promise<CheckPatientExistsResult> {
  const phone = fullPhone.trim();
  if (!phone) return NO_MATCH;

  const { data, error } = await supabase.rpc("check_patient_exists_by_phone", {
    p_phone: phone,
  });

  if (error) {
    return { ...NO_MATCH, error: new Error(error.message) };
  }

  return parseDuplicateRows(data);
}
