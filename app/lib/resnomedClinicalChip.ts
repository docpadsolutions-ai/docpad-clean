import type { SupabaseClient } from "@supabase/supabase-js";
import { composeBodySiteLabel, fetchSnomedForEntity, type SnomedClientHit } from "./clinicalVoicePipeline";
import type { ClinicalChip, ClinicalLaterality } from "./clinicalChipTypes";

function rowFromRpc(row: unknown): SnomedClientHit | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const conceptId = String(o.sctid ?? o.concept_id ?? o.conceptId ?? "").trim();
  const term = String(o.term ?? o.display_term ?? o.fsn ?? "").trim();
  if (!conceptId || !term) return null;
  return { conceptId, term };
}

/**
 * Tiered SNOMED resolution after inline edit: RPC cache → API with body site → API finding-only.
 */
export async function resnomedAfterClinicalChipEdit(
  supabase: SupabaseClient,
  opts: {
    finding: string;
    bodySite: string | null;
    laterality: ClinicalLaterality;
    specialty: string | null;
    doctorId: string | null;
    indiaRefset: string | null;
    hierarchy: "complaint" | "finding";
  },
): Promise<{ top: SnomedClientHit | null; alternatives: SnomedClientHit[] }> {
  const finding = opts.finding.trim();
  if (finding.length < 2) {
    return { top: null, alternatives: [] };
  }

  const bodySiteLabel = composeBodySiteLabel(opts.laterality, opts.bodySite);

  try {
    const { data, error } = await supabase.rpc("search_snomed_cached", {
      p_query: finding,
      p_specialty: opts.specialty?.trim() || null,
      p_body_site: opts.bodySite?.trim() || null,
      p_doctor_id: opts.doctorId?.trim() || null,
      p_limit: 5,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      const mapped = data.map(rowFromRpc).filter(Boolean) as SnomedClientHit[];
      if (mapped.length > 0) {
        return {
          top: mapped[0],
          alternatives: mapped.slice(1, 4),
        };
      }
    }
  } catch {
    // Fall through to HTTP search
  }

  const withSite = await fetchSnomedForEntity({
    finding,
    bodySiteLabel,
    hierarchy: opts.hierarchy,
    specialty: opts.specialty,
    doctorId: opts.doctorId,
    indiaRefset: opts.indiaRefset,
  });
  if (withSite.top) {
    return {
      top: withSite.top,
      alternatives: [...withSite.alternatives],
    };
  }

  const findingOnly = await fetchSnomedForEntity({
    finding,
    bodySiteLabel: "",
    hierarchy: opts.hierarchy,
    specialty: opts.specialty,
    doctorId: opts.doctorId,
    indiaRefset: opts.indiaRefset,
  });
  return {
    top: findingOnly.top,
    alternatives: [...findingOnly.alternatives],
  };
}
