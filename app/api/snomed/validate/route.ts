import { NextRequest, NextResponse } from "next/server";
import { resolveIndiaRefsetId } from "../../../lib/indiaSnomedRefsets";
import { validateConceptInValueSet } from "../../../lib/snomedCsiroExpand";
import { buildConstrainedSearchEcl, HIERARCHY_ECL, sanitizeSctId, type ConstrainedEclInput } from "../../../lib/snomedEclBuilder";

const CSIRO_TIMEOUT_MS = 4000;

/**
 * Validates that a SNOMED concept is allowed under a hierarchy ECL (and optional India refset / refinements).
 * GET ?conceptId=386661006&hierarchy=complaint&indiaRefset=orthopedics&descendantOf=...
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const conceptIdRaw = searchParams.get("conceptId");
  const conceptId = sanitizeSctId(conceptIdRaw);
  if (!conceptId) {
    return NextResponse.json({ ok: false, error: "Missing or invalid conceptId" }, { status: 400 });
  }

  const hierarchy = searchParams.get("hierarchy") || "diagnosis";
  const descendantOf = searchParams.get("descendantOf");
  const findingSiteConcept = searchParams.get("findingSiteConcept");
  const morphologyConcept = searchParams.get("morphologyConcept");
  const indiaRefsetKey = searchParams.get("indiaRefset");

  const constraintInput: ConstrainedEclInput = {
    hierarchy,
    descendantOf,
    findingSiteConcept,
    morphologyConcept,
    indiaRefsetId: resolveIndiaRefsetId(indiaRefsetKey),
  };

  const useConstrained = Boolean(
    sanitizeSctId(descendantOf ?? undefined) ||
      sanitizeSctId(findingSiteConcept ?? undefined) ||
      sanitizeSctId(morphologyConcept ?? undefined) ||
      resolveIndiaRefsetId(indiaRefsetKey),
  );

  const ecl = useConstrained
    ? buildConstrainedSearchEcl(constraintInput)
    : HIERARCHY_ECL[hierarchy] ?? HIERARCHY_ECL.diagnosis;

  const { ok, display } = await validateConceptInValueSet(ecl, conceptId, CSIRO_TIMEOUT_MS);
  return NextResponse.json({ ok, conceptId, display: display ?? null, ecl });
}
