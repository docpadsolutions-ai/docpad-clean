"use server";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/supabase/server";

export type AiSummaryResult =
  | { success: true; summary: string; cached: boolean }
  | { success: false; error: string };

type EncounterRow = {
  id: string;
  encounter_date: string | null;
  created_at: string | null;
  chief_complaint: string | null;
  working_diagnosis: string | null;
  plan_details: unknown;
};

type PrescriptionRow = {
  encounter_id: string | null;
  drug_name: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
};

/** Server actions are public endpoints: only staff of the patient's own hospital may read or summarise. */
async function staffCanAccessPatient(patientId: string): Promise<boolean> {
  const gate = await requireStaff();
  if (!gate.ok) return false;
  const { data } = await createSupabaseAdmin()
    .from("patients")
    .select("hospital_id")
    .eq("id", patientId)
    .maybeSingle();
  return !!data && (data as { hospital_id: string | null }).hospital_id === gate.staff.hospitalId;
}

function buildPatientHistoryText(
  encounters: EncounterRow[],
  prescriptions: PrescriptionRow[],
): string {
  if (encounters.length === 0) return "No past encounters on record.";

  const rxByEncounter = new Map<string, PrescriptionRow[]>();
  for (const rx of prescriptions) {
    if (!rx.encounter_id) continue;
    const list = rxByEncounter.get(rx.encounter_id) ?? [];
    list.push(rx);
    rxByEncounter.set(rx.encounter_id, list);
  }

  return encounters
    .map((enc) => {
      const date = (enc.encounter_date ?? enc.created_at ?? "Unknown date").slice(0, 10);
      const cc = enc.chief_complaint?.trim() || null;
      const dx = enc.working_diagnosis?.trim() || null;

      let advice: string | null = null;
      try {
        const pd = enc.plan_details as Record<string, unknown> | null;
        const raw = pd?.advice_notes;
        if (typeof raw === "string" && raw.trim()) advice = raw.trim();
      } catch { /* ignore */ }

      const rxList = rxByEncounter.get(enc.id) ?? [];
      const rxText =
        rxList.length > 0
          ? rxList
              .map((r) =>
                [r.drug_name, r.dose, r.frequency, r.duration?.trim() || null]
                  .filter(Boolean)
                  .join(" "),
              )
              .filter(Boolean)
              .join(", ")
          : null;

      const parts = [
        `Date: ${date}`,
        cc ? `C/O: ${cc}` : null,
        dx ? `Dx: ${dx}` : null,
        rxText ? `Rx: ${rxText}` : null,
        advice ? `Advice: ${advice}` : null,
      ].filter(Boolean);

      return parts.join(" | ");
    })
    .join("\n");
}

export async function generateAiSummary(patientId: string): Promise<AiSummaryResult> {
  if (!patientId.trim()) return { success: false, error: "missing_patient_id" };
  if (!(await staffCanAccessPatient(patientId.trim()))) return { success: false, error: "forbidden" };

  const supabase = createSupabaseAdmin();

  // Fetch last 10 OPD encounters
  const { data: encounters, error: encErr } = await supabase
    .from("opd_encounters")
    .select("id, encounter_date, created_at, chief_complaint, working_diagnosis, plan_details")
    .eq("patient_id", patientId.trim())
    .order("created_at", { ascending: false })
    .limit(10);

  if (encErr) return { success: false, error: encErr.message };

  const encounterIds = (encounters ?? []).map((e) => e.id);

  // Fetch prescriptions for those encounters in one query
  const { data: rxRows } = encounterIds.length > 0
    ? await supabase
        .from("prescriptions")
        .select("encounter_id, medicine_name, dosage_text, dosage, frequency, duration")
        .in("encounter_id", encounterIds)
    : { data: [] };
  const prescriptions: PrescriptionRow[] = (
    (rxRows ?? []) as {
      encounter_id: string | null;
      medicine_name: string | null;
      dosage_text: string | null;
      dosage: string | null;
      frequency: string | null;
      duration: string | null;
    }[]
  ).map((r) => ({
    encounter_id: r.encounter_id,
    drug_name: r.medicine_name,
    dose: r.dosage_text ?? r.dosage,
    frequency: r.frequency,
    duration: r.duration,
  }));

  const patientHistory = buildPatientHistoryText(
    (encounters ?? []) as EncounterRow[],
    (prescriptions ?? []) as PrescriptionRow[],
  );

  // Call the generate-patient-summary edge function
  const { data: edgeJson, error: edgeFnErr } = await supabase.functions.invoke(
    "generate-patient-summary",
    { body: { patient_history: patientHistory } },
  );
  if (edgeFnErr) {
    return { success: false, error: `fetch_failed: ${edgeFnErr.message}` };
  }

  const edgeData = edgeJson as Record<string, unknown> | null;
  if (!edgeData?.success) {
    return { success: false, error: String(edgeData?.error ?? "edge_error") };
  }

  const summary = String(edgeData.summary ?? "").trim();
  if (!summary) return { success: false, error: "empty_summary" };

  // Cache the summary in the patients row
  await supabase
    .from("patients")
    .update({
      ai_clinical_summary: summary,
      summary_last_updated: new Date().toISOString(),
    })
    .eq("id", patientId.trim());

  return { success: true, summary, cached: false };
}

export async function loadCachedAiSummary(
  patientId: string,
): Promise<{ summary: string | null; lastUpdated: string | null }> {
  if (!patientId.trim()) return { summary: null, lastUpdated: null };
  if (!(await staffCanAccessPatient(patientId.trim()))) return { summary: null, lastUpdated: null };
  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("patients")
    .select("ai_clinical_summary, summary_last_updated")
    .eq("id", patientId.trim())
    .maybeSingle();
  return {
    summary: data?.ai_clinical_summary ? String(data.ai_clinical_summary) : null,
    lastUpdated: data?.summary_last_updated ? String(data.summary_last_updated) : null,
  };
}
