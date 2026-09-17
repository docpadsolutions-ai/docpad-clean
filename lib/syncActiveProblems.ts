import type { SupabaseClient } from "@supabase/supabase-js";

export type DiagnosisForSync = {
  condition_name: string;
  snomed_code: string | null;
};

/**
 * Upserts into `active_problems` after an encounter save.
 * Requires a unique constraint on `(patient_id, condition_name)` for `onConflict`.
 */
export async function syncActiveProblemsFromEncounter(
  supabase: SupabaseClient,
  input: {
    patientId: string;
    orgId: string;
    diagnoses: DiagnosisForSync[];
  },
): Promise<{ error: Error | null }> {
  const { patientId, orgId, diagnoses } = input;
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const rows = diagnoses
    .map((d) => ({
      patient_id: patientId,
      org_id: orgId,
      condition_name: d.condition_name.trim(),
      snomed_code: d.snomed_code?.trim() || null,
      status: "active" as const,
      updated_at: now,
    }))
    .filter((r) => {
      if (!r.condition_name) return false;
      const k = r.condition_name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (rows.length === 0) return { error: null };

  const { error } = await supabase.from("active_problems").upsert(rows, {
    onConflict: "patient_id,condition_name",
  });

  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export function buildDiagnosesForSync(args: {
  diagnosisEntries: Array<{ term: string; snomed: string }>;
  persistDxTerm: string | null;
  diagnosisConceptId: string | null;
}): DiagnosisForSync[] {
  const out: DiagnosisForSync[] = [];
  for (const d of args.diagnosisEntries) {
    const name = d.term.trim();
    if (!name) continue;
    out.push({ condition_name: name, snomed_code: d.snomed?.trim() || null });
  }
  if (out.length === 0 && args.persistDxTerm?.trim()) {
    out.push({
      condition_name: args.persistDxTerm.trim(),
      snomed_code: args.diagnosisConceptId?.trim() || null,
    });
  }
  return out;
}
