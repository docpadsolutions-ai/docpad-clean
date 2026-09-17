import { supabase } from "@/lib/supabase";

/**
 * DPDP Act 2023 — consent record and data principal rights.
 *
 * Consent used to be a checkbox that gated the registration form and was then
 * discarded. These helpers write it down: which purposes the patient agreed to,
 * when, how it was taken and by whom, plus the grievance register and the
 * correction workflow that the Act requires a fiduciary to run.
 */

export type ConsentPurpose =
  | "treatment"
  | "billing_insurance"
  | "health_records_sharing"
  | "reminders_communication"
  | "research_anonymised";

export const CONSENT_PURPOSES: {
  key: ConsentPurpose;
  label: string;
  description: string;
  required: boolean;
}[] = [
  {
    key: "treatment",
    label: "Treatment and clinical records",
    description: "Storing and using health data to examine, diagnose and treat the patient.",
    required: true,
  },
  {
    key: "billing_insurance",
    label: "Billing and insurance",
    description: "Raising invoices and sharing what an insurer or TPA needs to settle a claim.",
    required: false,
  },
  {
    key: "reminders_communication",
    label: "Appointment reminders",
    description: "Sending visit, follow-up and report messages on WhatsApp or SMS.",
    required: false,
  },
  {
    key: "health_records_sharing",
    label: "Sharing records with other providers",
    description: "Sending records to another hospital or to ABDM when the patient asks for it.",
    required: false,
  },
  {
    key: "research_anonymised",
    label: "Anonymised research",
    description: "Using de-identified data for audit and clinical research.",
    required: false,
  },
];

export type ConsentMethod = "verbal" | "written" | "digital" | "otp";

export type GrievanceOfficer = {
  hospital_name: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  privacy_notice_url: string | null;
  privacy_notice_version: string | null;
  data_retention_years: number | null;
};

export type ConsentRecord = {
  id: string;
  purpose: ConsentPurpose;
  status: "given" | "withdrawn";
  method: ConsentMethod;
  given_at: string;
  given_by_name: string | null;
  given_by_relation: string | null;
  notice_version: string | null;
  recorded_by: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
};

export type DataPrincipalRequest = {
  id: string;
  request_type: "access" | "correction" | "erasure" | "grievance";
  status: "open" | "under_review" | "actioned" | "rejected" | "closed";
  subject: string;
  details: string | null;
  raised_at: string;
  sla_due_at: string;
  reviewed_at: string | null;
  resolution: string | null;
  applied_changes: { field: string; from: string | null; to: string | null; at: string }[] | null;
  patient_id?: string | null;
  patient_name?: string | null;
  docpad_id?: string | null;
  requested_by_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  raised_by_name?: string | null;
  reviewed_by_name?: string | null;
  overdue?: boolean;
};

export type ConsentRegister = {
  generated_at: string;
  patient: { id: string; docpad_id: string | null; full_name: string | null; phone: string | null; registered_at: string } | null;
  hospital: {
    name: string | null;
    address: string | null;
    grievance_officer: { name: string | null; email: string | null; phone: string | null };
    privacy_notice_url: string | null;
    privacy_notice_version: string | null;
    data_retention_years: number | null;
  } | null;
  consents: ConsentRecord[];
  requests: DataPrincipalRequest[];
};

export async function getGrievanceOfficer(hospitalId?: string | null): Promise<GrievanceOfficer | null> {
  const { data, error } = await supabase.rpc("get_grievance_officer", {
    p_hospital_id: hospitalId?.trim() || null,
  });
  if (error || !data) return null;
  return data as GrievanceOfficer;
}

export async function recordPatientConsent(
  patientId: string,
  purposes: ConsentPurpose[],
  opts?: { method?: ConsentMethod; givenByName?: string | null; givenByRelation?: string | null },
): Promise<string | null> {
  if (purposes.length === 0) return "At least one consent purpose is required.";
  const { error } = await supabase.rpc("record_patient_consent", {
    p_patient_id: patientId,
    p_purposes: purposes,
    p_method: opts?.method ?? "verbal",
    p_given_by_name: opts?.givenByName ?? null,
    p_given_by_relation: opts?.givenByRelation ?? null,
  });
  return error?.message ?? null;
}

export async function withdrawPatientConsent(consentId: string, reason?: string | null): Promise<string | null> {
  const { error } = await supabase.rpc("withdraw_patient_consent", {
    p_consent_id: consentId,
    p_reason: reason?.trim() || null,
  });
  return error?.message ?? null;
}

export async function getPatientConsentRegister(
  patientId: string,
): Promise<{ register: ConsentRegister | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_patient_consent_register", { p_patient_id: patientId });
  if (error) return { register: null, error: error.message };
  return { register: (data as ConsentRegister) ?? null, error: null };
}

export async function raiseDataPrincipalRequest(input: {
  patientId: string;
  requestType: DataPrincipalRequest["request_type"];
  subject: string;
  details?: string | null;
  requestedByName?: string | null;
  requestedByRelation?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}): Promise<{ requestId: string | null; slaDueAt: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("raise_data_principal_request", {
    p_patient_id: input.patientId,
    p_request_type: input.requestType,
    p_subject: input.subject,
    p_details: input.details?.trim() || null,
    p_requested_by_name: input.requestedByName?.trim() || null,
    p_requested_by_relation: input.requestedByRelation?.trim() || null,
    p_contact_phone: input.contactPhone?.trim() || null,
    p_contact_email: input.contactEmail?.trim() || null,
  });
  if (error) return { requestId: null, slaDueAt: null, error: error.message };
  const r = data as { request_id?: string; sla_due_at?: string } | null;
  return { requestId: r?.request_id ?? null, slaDueAt: r?.sla_due_at ?? null, error: null };
}

export async function listDataPrincipalRequests(status?: string | null): Promise<DataPrincipalRequest[]> {
  const { data, error } = await supabase.rpc("list_data_principal_requests", {
    p_status: status?.trim() || null,
    p_limit: 200,
  });
  if (error || !Array.isArray(data)) return [];
  return data as DataPrincipalRequest[];
}

export async function reviewDataPrincipalRequest(
  requestId: string,
  status: "under_review" | "actioned" | "rejected" | "closed",
  resolution?: string | null,
): Promise<string | null> {
  const { error } = await supabase.rpc("review_data_principal_request", {
    p_request_id: requestId,
    p_status: status,
    p_resolution: resolution?.trim() || null,
  });
  return error?.message ?? null;
}

/**
 * Fields a correction request may change. The database enforces the same list —
 * this copy is only so the UI can offer a sensible dropdown.
 */
export const CORRECTABLE_FIELDS = [
  { key: "full_name", label: "Full name" },
  { key: "phone", label: "Mobile number" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "age_years", label: "Age" },
  { key: "sex", label: "Sex" },
  { key: "blood_group", label: "Blood group" },
  { key: "address_line1", label: "Address line 1" },
  { key: "address_line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "PIN code" },
  { key: "abha_address", label: "ABHA address" },
] as const;

export async function applyPatientCorrection(
  requestId: string,
  field: string,
  newValue: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("apply_patient_correction", {
    p_request_id: requestId,
    p_field: field,
    p_new_value: newValue,
  });
  return error?.message ?? null;
}

export async function updateGrievanceOfficer(input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  privacyNoticeUrl?: string | null;
  privacyNoticeVersion?: string | null;
  dataRetentionYears?: number | null;
}): Promise<string | null> {
  const { error } = await supabase.rpc("update_grievance_officer", {
    p_name: input.name?.trim() || null,
    p_email: input.email?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_privacy_notice_url: input.privacyNoticeUrl?.trim() || null,
    p_privacy_notice_version: input.privacyNoticeVersion?.trim() || null,
    p_data_retention_years: input.dataRetentionYears ?? null,
  });
  return error?.message ?? null;
}
