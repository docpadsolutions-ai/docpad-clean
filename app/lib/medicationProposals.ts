/**
 * Clinical proposals for drugs not yet in the hospital formulary (`hospital_inventory`) (FHIR / governance workflow).
 *
 * ```sql
 * create table medication_proposals (
 *   id uuid primary key default gen_random_uuid(),
 *   patient_id uuid not null references patients(id) on delete cascade,
 *   encounter_id uuid references opd_encounters(id) on delete set null,
 *   brand_name text not null,
 *   generic_name text not null,
 *   dosage_form_name text,
 *   dosage_form_code text,
 *   proposed_by uuid references auth.users(id),
 *   verification_status text not null default 'pending',
 *   created_at timestamptz default now()
 * );
 * -- dosage_form_code: SNOMED concept id (e.g. 385055001 Tablet); pairs with dosage_form_name for FHIR/ABDM.
 * ```
 */

import { supabase } from "../supabase";

export const MEDICATION_PROPOSALS_TABLE = "medication_proposals";

export type MedicationProposalInsert = {
  patient_id: string;
  encounter_id: string | null;
  brand_name: string;
  generic_name: string;
  /** SNOMED concept id for dosage form (ABDM / FHIR). */
  dosage_form_code: string | null;
  dosage_form_name: string | null;
  proposed_by: string | null;
  verification_status: "pending";
};

export async function insertMedicationProposal(
  row: MedicationProposalInsert,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.from(MEDICATION_PROPOSALS_TABLE).insert({
    patient_id: row.patient_id,
    encounter_id: row.encounter_id,
    brand_name: row.brand_name.trim(),
    generic_name: row.generic_name.trim(),
    dosage_form_code: row.dosage_form_code?.trim() || null,
    dosage_form_name: row.dosage_form_name?.trim() || null,
    proposed_by: row.proposed_by,
    verification_status: row.verification_status,
  });
  if (error) return { error: new Error(error.message) };
  return { error: null };
}
