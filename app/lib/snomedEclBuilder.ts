/**
 * Compose SNOMED ECL strings for Ontoserver `fhir_vs=ecl/...` expansion.
 */
export const SNOMED_ATTRIBUTE = {
  FINDING_SITE: "363698007",
  ASSOCIATED_MORPHOLOGY: "116676008",
} as const;

export const HIERARCHY_ECL: Record<string, string> = {
  diagnosis: "<< 404684003",
  complaint: "<< 404684003",
  finding: "<< 404684003",
  procedure: "<< 71388002",
  allergy: "<< 763158003",
};

export function sanitizeSctId(raw: string | null | undefined): string | null {
  const s = raw?.trim() ?? "";
  if (!/^\d+$/.test(s)) return null;
  return s;
}

export type ConstrainedEclInput = {
  hierarchy: string;
  descendantOf?: string | null;
  findingSiteConcept?: string | null;
  morphologyConcept?: string | null;
  indiaRefsetId?: string | null;
};

export function buildConstrainedSearchEcl(input: ConstrainedEclInput): string {
  const h = (input.hierarchy || "diagnosis").trim();
  const root = HIERARCHY_ECL[h] ?? HIERARCHY_ECL.diagnosis;
  const desc = sanitizeSctId(input.descendantOf ?? undefined);
  const site = sanitizeSctId(input.findingSiteConcept ?? undefined);
  const morph = sanitizeSctId(input.morphologyConcept ?? undefined);
  const refset = sanitizeSctId(input.indiaRefsetId ?? undefined);

  const clinical = h === "diagnosis" || h === "complaint" || h === "finding";

  let expr: string;

  if (clinical && (site || morph)) {
    const parts: string[] = [];
    if (site) parts.push(`${SNOMED_ATTRIBUTE.FINDING_SITE} = << ${site}`);
    if (morph) parts.push(`${SNOMED_ATTRIBUTE.ASSOCIATED_MORPHOLOGY} = << ${morph}`);
    const [op, conceptId] = root.split(/\s+/);
    expr = `${op} ${conceptId} : ${parts.join(", ")}`;
    if (desc) expr = `(${expr}) AND (<< ${desc})`;
  } else if (desc) {
    expr = `(${root}) AND (<< ${desc})`;
  } else {
    expr = root;
  }

  if (refset) {
    expr = `(${expr}) AND ^ ${refset}`;
  }

  return expr;
}

export function hasActiveConstraints(input: ConstrainedEclInput): boolean {
  return Boolean(
    sanitizeSctId(input.descendantOf ?? undefined) ||
      sanitizeSctId(input.findingSiteConcept ?? undefined) ||
      sanitizeSctId(input.morphologyConcept ?? undefined) ||
      sanitizeSctId(input.indiaRefsetId ?? undefined),
  );
}
