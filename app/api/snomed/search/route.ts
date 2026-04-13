import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  filterFindingResultsForBodySite,
  rankSnomedResultsForBodySite,
  type SnomedRow,
} from "../../../lib/snomedBodySiteRank";
import { filterSnomedByBodySiteAnatomy } from "../../../lib/snomedAnatomyExclusions";
import { expandValueSetFromCsiro } from "../../../lib/snomedCsiroExpand";
import {
  buildConstrainedSearchEcl,
  HIERARCHY_ECL,
  hasActiveConstraints,
  type ConstrainedEclInput,
} from "../../../lib/snomedEclBuilder";
import { resolveIndiaRefsetId } from "../../../lib/indiaSnomedRefsets";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export type SnomedResult = SnomedRow;

const CSIRO_TIMEOUT_MS = 4000;
const CACHE_LIMIT = 25;

type CacheFilterMode = "finding_diagnosis" | "procedure";

function sanitizeIlikeFragment(q: string): string {
  return q.trim().replace(/[%_,]/g, "").slice(0, 80);
}

function dedupeByConceptIdPreserveOrder(rows: SnomedResult[]): SnomedResult[] {
  const seen = new Set<string>();
  const out: SnomedResult[] = [];
  for (const r of rows) {
    const id = (r.conceptId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

function rowFromSearchSnomedCachedRpc(row: unknown): SnomedResult | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const conceptId = String(o.sctid ?? o.concept_id ?? o.conceptId ?? "").trim();
  const term = String(o.term ?? o.display_term ?? o.fsn ?? "").trim();
  if (!conceptId || !term) return null;
  return { conceptId, term, icd10: null };
}

/** Tiered cache RPC — finding term only in `p_query`; body site passed separately. */
async function trySearchSnomedCached(params: {
  query: string;
  specialty: string | null;
  bodySite: string | null;
  doctorId: string | null;
  limit: number;
}): Promise<SnomedResult[] | null> {
  try {
    const { data, error } = await supabase.rpc("search_snomed_cached", {
      p_query: params.query,
      p_specialty: params.specialty,
      p_body_site: params.bodySite,
      p_doctor_id: params.doctorId,
      p_limit: params.limit,
    });
    if (error) {
      console.warn("[SNOMED] search_snomed_cached:", error.message);
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    const mapped = data.map(rowFromSearchSnomedCachedRpc).filter(Boolean) as SnomedResult[];
    return mapped.length > 0 ? mapped : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[SNOMED] search_snomed_cached exception:", msg);
    return null;
  }
}

function rowFromSnomedCacheTable(row: {
  concept_id: unknown;
  term: unknown;
  display_term?: unknown;
}): SnomedResult | null {
  const conceptId = String(row.concept_id ?? "").trim();
  const term =
    String(row.term ?? "").trim() ||
    String(row.display_term ?? "").trim();
  if (!conceptId || !term) return null;
  return { conceptId, term, icd10: null };
}

async function searchSnomedCacheTable(params: {
  frag: string;
  hierarchy: string;
  cacheFilter: CacheFilterMode | null;
  limit: number;
}): Promise<SnomedResult[]> {
  const pattern = `%${params.frag}%`;
  let q = supabase
    .from("snomed_cache")
    .select("concept_id, term, display_term, category, usage_count")
    .order("usage_count", { ascending: false })
    .limit(params.limit);

  if (params.cacheFilter === "finding_diagnosis") {
    q = q.or("category.eq.finding,category.eq.disorder").ilike("term", pattern);
  } else if (params.cacheFilter === "procedure") {
    q = q.eq("category", "procedure").or(`term.ilike.${pattern},display_term.ilike.${pattern}`);
  } else {
    q = q.eq("category", params.hierarchy).ilike("term", pattern);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[SNOMED] snomed_cache table:", error.message);
    return [];
  }
  const mapped = (data ?? [])
    .map((row) =>
      rowFromSnomedCacheTable(row as { concept_id: unknown; term: unknown; display_term?: unknown }),
    )
    .filter(Boolean) as SnomedResult[];
  return dedupeByConceptIdPreserveOrder(mapped);
}

async function searchSnomedConceptCacheTable(params: {
  frag: string;
  conceptType: "finding" | "procedure";
  limit: number;
}): Promise<SnomedResult[]> {
  const pattern = `%${params.frag}%`;
  const { data, error } = await supabase
    .from("snomed_concept_cache")
    .select("sctid, pt_term, icd10_map, concept_type")
    .eq("concept_type", params.conceptType)
    .ilike("pt_term", pattern)
    .limit(params.limit);

  if (error) {
    console.warn("[SNOMED] snomed_concept_cache:", error.message);
    return [];
  }

  const out: SnomedResult[] = [];
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const conceptId = String(r.sctid ?? r.concept_id ?? "").trim();
    const term = String(r.pt_term ?? "").trim();
    if (!conceptId || !term) continue;
    const icdRaw = r.icd10_map;
    const icd10 = icdRaw != null && String(icdRaw).trim() !== "" ? String(icdRaw).trim() : null;
    out.push({ conceptId, term, icd10 });
  }
  return dedupeByConceptIdPreserveOrder(out);
}

async function collectTieredSnomedResults(params: {
  frag: string;
  hierarchy: string;
  cacheFilter: CacheFilterMode | null;
  conceptCacheType: "finding" | "procedure" | null;
  eclForExpand: string;
}): Promise<{ rows: SnomedResult[]; usedLocalCache: boolean }> {
  let merged: SnomedResult[] = await searchSnomedCacheTable({
    frag: params.frag,
    hierarchy: params.hierarchy,
    cacheFilter: params.cacheFilter,
    limit: CACHE_LIMIT,
  });

  if (params.conceptCacheType && merged.length < 3) {
    const tier2 = await searchSnomedConceptCacheTable({
      frag: params.frag,
      conceptType: params.conceptCacheType,
      limit: CACHE_LIMIT,
    });
    const seen = new Set(merged.map((r) => r.conceptId));
    for (const r of tier2) {
      if (seen.has(r.conceptId)) continue;
      seen.add(r.conceptId);
      merged.push(r);
    }
    merged = dedupeByConceptIdPreserveOrder(merged);
  }

  if (merged.length > 0) {
    return { rows: merged, usedLocalCache: true };
  }

  const fromCsiro = dedupeByConceptIdPreserveOrder(
    await expandValueSetFromCsiro(params.eclForExpand, params.frag, 15, CSIRO_TIMEOUT_MS),
  );
  return { rows: fromCsiro, usedLocalCache: false };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const bodySiteParam = searchParams.get("bodySite");
  const hierarchy = searchParams.get("hierarchy") || "diagnosis";

  const descendantOf = searchParams.get("descendantOf");
  const findingSiteConcept = searchParams.get("findingSiteConcept");
  const morphologyConcept = searchParams.get("morphologyConcept");
  const indiaRefsetKey = searchParams.get("indiaRefset");
  const specialtyParam = searchParams.get("specialty");
  const doctorIdParam = searchParams.get("doctorId");

  const eclRaw = searchParams.get("ecl");
  const decodedEcl = eclRaw ? decodeURIComponent(eclRaw).trim() : "";
  const cacheFilterRaw = searchParams.get("cacheFilter");
  const cacheFilter: CacheFilterMode | null =
    cacheFilterRaw === "finding_diagnosis" || cacheFilterRaw === "procedure" ? cacheFilterRaw : null;
  const conceptCacheTypeRaw = searchParams.get("conceptCacheType");
  const conceptCacheType: "finding" | "procedure" | null =
    conceptCacheTypeRaw === "finding" || conceptCacheTypeRaw === "procedure" ? conceptCacheTypeRaw : null;

  if (!query) return NextResponse.json({ results: [] });
  const frag = sanitizeIlikeFragment(query);
  if (frag.length < 2) return NextResponse.json({ results: [] });

  const bodySiteRaw = (bodySiteParam ?? "").trim();
  const applyBodySitePipeline =
    (hierarchy === "finding" || hierarchy === "complaint") && bodySiteRaw.length > 0;

  const indiaRefsetId = resolveIndiaRefsetId(indiaRefsetKey);

  const constraintInput: ConstrainedEclInput = {
    hierarchy,
    descendantOf,
    findingSiteConcept,
    morphologyConcept,
    indiaRefsetId,
  };

  const constrained = hasActiveConstraints(constraintInput);

  const skipRpc = Boolean(decodedEcl || cacheFilter);

  const baseHierarchyEcl = HIERARCHY_ECL[hierarchy] ?? HIERARCHY_ECL.diagnosis;
  const eclForExpand = decodedEcl || baseHierarchyEcl;

  try {
    let candidates: SnomedResult[] = [];
    let usedCache = false;

    if (constrained) {
      const ecl = buildConstrainedSearchEcl(constraintInput);
      candidates = dedupeByConceptIdPreserveOrder(
        await expandValueSetFromCsiro(ecl, frag, 22, CSIRO_TIMEOUT_MS),
      );
    } else if (skipRpc) {
      const tiered = await collectTieredSnomedResults({
        frag,
        hierarchy,
        cacheFilter,
        conceptCacheType,
        eclForExpand,
      });
      candidates = tiered.rows;
      usedCache = tiered.usedLocalCache;
    } else {
      const rpcFirst = await trySearchSnomedCached({
        query: frag,
        specialty: specialtyParam?.trim() || null,
        bodySite: applyBodySitePipeline ? bodySiteRaw : null,
        doctorId: doctorIdParam?.trim() || null,
        limit: CACHE_LIMIT,
      });

      if (rpcFirst && rpcFirst.length > 0) {
        candidates = rpcFirst;
        usedCache = true;
      } else {
        const { data: cacheData, error: cacheError } = await supabase
          .from("snomed_cache")
          .select("concept_id, term, category, usage_count")
          .eq("category", hierarchy)
          .ilike("term", `%${frag}%`)
          .order("usage_count", { ascending: false })
          .limit(CACHE_LIMIT);

        if (cacheError) {
          console.error("[SNOMED] Supabase cache error:", cacheError.message);
        }

        const fromCache: SnomedResult[] = dedupeByConceptIdPreserveOrder(
          (cacheData || [])
            .map((row) => ({
              conceptId: String(row.concept_id).trim(),
              term: String(row.term).trim(),
              icd10: null,
            }))
            .filter((r) => r.conceptId && r.term),
        );

        if (fromCache.length > 0) {
          candidates = fromCache;
          usedCache = true;
        } else {
          candidates = dedupeByConceptIdPreserveOrder(
            await expandValueSetFromCsiro(baseHierarchyEcl, frag, 15, CSIRO_TIMEOUT_MS),
          );
        }
      }
    }

    const limit = constrained ? 22 : usedCache ? 20 : 15;
    let finalResults = dedupeByConceptIdPreserveOrder(candidates).slice(0, limit);

    if (applyBodySitePipeline) {
      const siteTrim = bodySiteRaw;
      finalResults = filterFindingResultsForBodySite(finalResults, siteTrim);
      if (finalResults.length === 0) {
        return NextResponse.json({ results: [] });
      }
      const { ranked } = rankSnomedResultsForBodySite(finalResults, siteTrim);
      finalResults = filterSnomedByBodySiteAnatomy(ranked, siteTrim);
      if (finalResults.length === 0) {
        return NextResponse.json({ results: [] });
      }
    }

    return NextResponse.json({ results: finalResults });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SNOMED] Critical search error:", msg);
    return NextResponse.json({ results: [] });
  }
}
