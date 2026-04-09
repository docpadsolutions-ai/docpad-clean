import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type ValidHierarchy = "diagnosis" | "complaint" | "procedure" | "allergy" | "finding";
const VALID_HIERARCHIES: ValidHierarchy[] = ["diagnosis", "complaint", "procedure", "allergy", "finding"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { conceptId?: unknown; term?: unknown; hierarchy?: unknown; icd10?: unknown };
    const { conceptId, term, hierarchy, icd10 = null } = body;

    if (!conceptId || !term) {
      return NextResponse.json({ error: "Missing required fields: conceptId and term." }, { status: 400 });
    }

    const safeHierarchy: ValidHierarchy = VALID_HIERARCHIES.includes(hierarchy as ValidHierarchy)
      ? (hierarchy as ValidHierarchy)
      : "diagnosis";

    const conceptIdStr = String(conceptId);
    const termStr = String(term).trim();
    const searchTerm = termStr.toLowerCase();

    const { data: existing } = await supabase
      .from("snomed_cache")
      .select("usage_count, hierarchy")
      .eq("concept_id", conceptIdStr)
      .maybeSingle();

    if (existing) {
      const prev = Number(existing.usage_count ?? 0);
      await supabase
        .from("snomed_cache")
        .update({
          usage_count: Number.isFinite(prev) ? prev + 1 : 1,
          hierarchy: safeHierarchy,
          category: safeHierarchy,
          last_accessed: new Date().toISOString(),
        })
        .eq("concept_id", conceptIdStr);

      console.log(`[CACHE] usage_count++ for: ${termStr} (hierarchy=${safeHierarchy})`);
    } else {
      await supabase.from("snomed_cache").insert([
        {
          search_term: searchTerm,
          term: termStr,
          concept_id: conceptIdStr,
          hierarchy: safeHierarchy,
          category: safeHierarchy,
          icd10_code: icd10 ?? null,
          usage_count: 1,
        },
      ]);

      console.log(`[CACHE] Learned new concept: ${termStr} (hierarchy=${safeHierarchy})`);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[CACHE ERROR]:", msg);
    return NextResponse.json({ error: "Failed to cache concept" }, { status: 500 });
  }
}
