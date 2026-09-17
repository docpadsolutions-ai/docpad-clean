import type { SupabaseClient } from "@supabase/supabase-js";

/** Reinforce doctor-specific SNOMED picks for autocomplete (RPC on Supabase). */
export async function incrementDoctorConceptUsage(
  supabase: SupabaseClient,
  args: {
    doctorId: string;
    sctid: string;
    displayTerm: string;
    contextType: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc("increment_doctor_concept", {
    p_doctor_id: args.doctorId,
    p_sctid: args.sctid,
    p_display_term: args.displayTerm,
    p_context_type: args.contextType,
  });
  if (error) {
    console.warn("[SNOMED] increment_doctor_concept:", error.message);
  }
}
