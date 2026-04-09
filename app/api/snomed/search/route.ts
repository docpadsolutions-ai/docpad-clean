import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  filterFindingResultsForBodySite,
  rankSnomedResultsForBodySite,
  type SnomedRow,
} from "../../../lib/snomedBodySiteRank";
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const bodySiteParam = searchParams.get("bodySite");
  const hierarchy = searchParams.get("hierarchy") || "diagnosis";

  const descendantOf = searchParams.get("descendantOf");
  const findingSiteConcept = searchParams.get("findingSiteConcept");
  const morphologyConcept = searchParams.get("morphologyConcept");
  const indiaRefsetKey = searchParams.get("indiaRefset");

  if (!query) return NextResponse.json({ results: [] });
  const frag = sanitizeIlikeFragment(query);
  if (frag.length < 2) return NextResponse.json({ results: [] });

  const bodySiteFrag =
    hierarchy === "finding" && bodySiteParam?.trim()
      ? sanitizeIlikeFragment(bodySiteParam)
      : "";

  const indiaRefsetId = resolveIndiaRefsetId(indiaRefsetKey);

  const constraintInput: ConstrainedEclInput = {
    hierarchy,
    descendantOf,
    findingSiteConcept,
    morphologyConcept,
    indiaRefsetId,
  };

  const constrained = hasActiveConstraints(constraintInput);

  try {
    let candidates: SnomedResult[] = [];
    let usedCache = false;

    if (constrained) {
      const ecl = buildConstrainedSearchEcl(constraintInput);
      candidates = dedupeByConceptIdPreserveOrder(
        await expandValueSetFromCsiro(ecl, frag, 22, CSIRO_TIMEOUT_MS),
      );
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
        (cacheData || []).map((row) => ({
          conceptId: String(row.concept_id).trim(),
          term: String(row.term).trim(),
          icd10: null,
        })).filter((r) => r.conceptId && r.term),
      );

      if (fromCache.length > 0) {
        candidates = fromCache;
        usedCache = true;
      } else {
        const baseEcl = HIERARCHY_ECL[hierarchy] ?? HIERARCHY_ECL.diagnosis;
        candidates = dedupeByConceptIdPreserveOrder(
          await expandValueSetFromCsiro(baseEcl, frag, 15, CSIRO_TIMEOUT_MS),
        );
      }
    }

    const limit = constrained ? 22 : usedCache ? 20 : 15;
    let finalResults = dedupeByConceptIdPreserveOrder(candidates).slice(0, limit);

    if (bodySiteFrag) {
      const siteTrim = (bodySiteParam ?? "").trim();
      finalResults = filterFindingResultsForBodySite(finalResults, siteTrim);
      if (finalResults.length === 0) {
        return NextResponse.json({ results: [] });
      }
      const { ranked } = rankSnomedResultsForBodySite(finalResults, siteTrim);
      finalResults = ranked;
    }

    return NextResponse.json({ results: finalResults });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SNOMED] Critical search error:", msg);
    return NextResponse.json({ results: [] });
  }
}
