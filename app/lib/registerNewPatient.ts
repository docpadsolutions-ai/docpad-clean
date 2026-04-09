import { supabase } from "../supabase";

export function generateDocpadId(): string {
  return `DCP-${Math.floor(100000 + Math.random() * 900000)}`;
}

export type NewPatientFormValues = {
  firstName: string;
  lastName: string;
  age: string;
  gender: string;
  phone: string;
  /** Lowercase hex SHA-256 of normalized 12-digit Aadhaar — never raw Aadhaar. */
  aadhaarSha256Hex: string | null;
  abhaId: string;
  consentGiven: boolean;
  addr1: string;
  addr2: string;
  city: string;
  state: string;
  pin: string;
  allergies: string[];
  conditions: string[];
};

export type RegisteredPatientRow = {
  id: string;
  full_name: string;
  docpad_id: string;
  age_years: number;
};

/**
 * Single source of truth for inserting a new `patients` row (OPD new visit + triage modal).
 */
export async function registerNewPatient(
  values: NewPatientFormValues,
  orgId: string | null,
): Promise<{ ok: true; patient: RegisteredPatientRow } | { ok: false; error: string }> {
  const first = values.firstName.trim();
  const last = values.lastName.trim();
  if (!first) return { ok: false, error: "First name is required." };
  if (!values.age || isNaN(Number(values.age)) || Number(values.age) <= 0) {
    return { ok: false, error: "Enter a valid age." };
  }
  if (values.phone.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "Enter a valid 10-digit mobile number." };
  }
  if (!values.consentGiven) {
    return { ok: false, error: "Please confirm patient consent before registering." };
  }

  const hash = values.aadhaarSha256Hex?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return { ok: false, error: "Identity verification is incomplete. Go back and confirm Aadhaar first." };
  }

  const docpadId = generateDocpadId();
  const fullName = [first, last].filter(Boolean).join(" ");

  const { data: patientData, error } = await supabase
    .from("patients")
    .insert({
      docpad_id: docpadId,
      full_name: fullName,
      age_years: parseInt(values.age, 10),
      sex: (values.gender || "unknown").toLowerCase(),
      phone: `+91${values.phone.replace(/\D/g, "")}`,
      aadhaar_hash: hash,
      abha_id: values.abhaId.trim() || null,
      address_line1: values.addr1.trim() || null,
      address_line2: values.addr2.trim() || null,
      city: values.city.trim() || null,
      state: values.state || null,
      pin_code: values.pin.trim() || null,
      known_allergies: values.allergies.length > 0 ? values.allergies : null,
      chronic_conditions: values.conditions.length > 0 ? values.conditions : null,
      hospital_id: orgId ?? null,
    })
    .select("id, full_name, docpad_id, age_years")
    .single();

  if (error) return { ok: false, error: error.message };

  const id = patientData?.id != null ? String(patientData.id) : "";
  if (!id) return { ok: false, error: "Patient was created but no id was returned." };

  return {
    ok: true,
    patient: {
      id,
      full_name: String(patientData?.full_name ?? fullName),
      docpad_id: patientData?.docpad_id != null ? String(patientData.docpad_id) : docpadId,
      age_years:
        patientData?.age_years != null && !Number.isNaN(Number(patientData.age_years))
          ? Number(patientData.age_years)
          : parseInt(values.age, 10),
    },
  };
}

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu & Kashmir",
  "Ladakh",
  "Chandigarh",
  "Puducherry",
] as const;
