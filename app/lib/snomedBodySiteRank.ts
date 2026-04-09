/** SNOMED search row (API / cache / CSIRO) — `lowConfidence` set by body-site ranking when needed. */
export type SnomedRow = {
  conceptId: string;
  term: string;
  icd10: string | null;
  lowConfidence?: boolean;
};

const LATERALITY = new Set(["left", "right", "bilateral", "unilateral", "midline"]);
const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "at"]);

/** Rough anatomy regions for cross-region penalty (FSN contains wrong area). */
const REGION_PATTERNS: { id: string; re: RegExp }[] = [
  {
    id: "lower_limb",
    re: /\b(toe|toes|digit|digits|foot|feet|ankle|tibia|fibula|patella|knee|leg|legs|calf|calves|thigh|thighs|hip|hips|plantar|dorsal\s+foot)\b/i,
  },
  {
    id: "upper_limb",
    re: /\b(finger|fingers|hand|hands|wrist|wrists|forearm|elbow|elbows|arm|arms|shoulder|shoulders|thumb|thumbs|palm|knuckle)\b/i,
  },
  {
    id: "head_sense",
    re: /\b(eye|eyes|conjunctiv|conjunctiva|corneal|cornea|nasal|nose|nostril|nostrils|ear|ears|otic|auditory|oral|mouth|lip|lips|cheek|cheeks|facial|face|scalp|skull|eyelid|eyelids|pupil|lacrimal)\b/i,
  },
  { id: "neck_throat", re: /\b(throat|pharyn|pharynx|laryn|neck|cervical\s+spine)\b/i },
  {
    id: "chest",
    re: /\b(chest|lung|lungs|pulmon|pleur|cardiac|heart|breast|mammar)\b/i,
  },
  {
    id: "breast",
    re: /\b(nipple|nipples|mammary|breast|breasts|areolar|areolae)\b/i,
  },
  {
    id: "abdomen",
    re: /\b(abdomin|stomach|gastric|liver|hepatic|renal|kidney|kidneys|pelvis|pelvic|inguinal|umbilic)\b/i,
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tokens from free-text site like "right toe" or "[Right 1st toe]". */
export function bodySiteSearchTokens(site: string): string[] {
  const cleaned = site.replace(/[[\]]/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/[\s,;/]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Prefer longer / more specific tokens for substring match. */
function keywordMatchScore(termLower: string, keyword: string): number {
  if (keyword.length < 2) return 0;
  if (!termLower.includes(keyword)) return 0;
  try {
    const wb = new RegExp(`\\b${escapeRe(keyword)}\\b`, "i");
    return wb.test(termLower) ? 3 : 2;
  } catch {
    return 2;
  }
}

function scoreTermForBodySite(term: string, tokens: string[]): number {
  const t = term.toLowerCase();
  let s = 0;
  for (const kw of tokens) {
    if (LATERALITY.has(kw)) {
      if (keywordMatchScore(t, kw) > 0) s += 1;
      continue;
    }
    s += keywordMatchScore(t, kw);
  }
  return s;
}

function regionsMatchedByText(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const { id, re } of REGION_PATTERNS) {
    if (re.test(lower)) found.add(id);
  }
  return found;
}

function siteRegionsOverlapAllowed(siteRegions: Set<string>, allowed: Set<string>): boolean {
  for (const id of siteRegions) {
    if (allowed.has(id)) return true;
  }
  return false;
}

/**
 * FSN contains anatomy-specific wording (eye, ENT, pelvis, etc.) that must not map to an unrelated body site.
 * e.g. "Purulent conjunctival discharge" is rejected when bodySite is "Right toe".
 */
const ANATOMY_ISOLATION_MARKERS: { re: RegExp; compatibleSiteRegions: Set<string> }[] = [
  {
    re: /\b(conjunctival|conjunctiva|ocular|ophthalmic|lacrimal|corneal|cornea|eyelid|eyelids|pupil)\b/i,
    compatibleSiteRegions: new Set(["head_sense"]),
  },
  {
    re: /\b(nasal|nostril|nostrils|rhinitis|sinus|sinuses)\b/i,
    compatibleSiteRegions: new Set(["head_sense", "neck_throat"]),
  },
  {
    re: /\b(aural|otic|tympanic|auditory)\b|\bear\b|\bears\b/i,
    compatibleSiteRegions: new Set(["head_sense"]),
  },
  {
    re: /\b(vaginal|vulv|vulvar|cervix\b)\b/i,
    compatibleSiteRegions: new Set(["abdomen"]),
  },
  {
    re: /\b(rectal|rectum|anal)\b/i,
    compatibleSiteRegions: new Set(["abdomen"]),
  },
  {
    re: /\b(nipple|nipples|mammary|breast|breasts|areolar|areolae)\b/i,
    compatibleSiteRegions: new Set(["chest", "breast"]),
  },
];

export function termFailsBodySiteIsolation(term: string, bodySiteRaw: string): boolean {
  const site = bodySiteRaw.trim();
  if (!site) return false;
  const siteRegions = regionsMatchedByText(site);
  if (siteRegions.size === 0) return false;
  const t = term.trim();
  if (!t) return false;
  for (const { re, compatibleSiteRegions } of ANATOMY_ISOLATION_MARKERS) {
    if (!re.test(t)) continue;
    if (!siteRegionsOverlapAllowed(siteRegions, compatibleSiteRegions)) return true;
  }
  return false;
}

/** Drop SNOMED rows whose FSN implies a body system incompatible with the stated exam site. */
export function filterFindingResultsForBodySite(results: SnomedRow[], bodySiteRaw: string): SnomedRow[] {
  const site = bodySiteRaw.trim();
  if (!site) return results;
  return results.filter((r) => !termFailsBodySiteIsolation(r.term ?? "", site));
}

/** True if FSN suggests a different body region than the stated site. */
function hasCrossRegionConflict(siteRegions: Set<string>, termRegions: Set<string>): boolean {
  if (siteRegions.size === 0 || termRegions.size === 0) return false;
  for (const s of siteRegions) {
    if (termRegions.has(s)) return false;
  }
  return true;
}

/**
 * Re-rank SNOMED rows: boost rows whose display contains body-site tokens;
 * push down rows whose FSN suggests unrelated anatomy vs the site string.
 */
export function rankSnomedResultsForBodySite(
  results: SnomedRow[],
  bodySiteRaw: string,
): { ranked: SnomedRow[]; anySiteMatch: boolean } {
  const tokens = bodySiteSearchTokens(bodySiteRaw);
  const siteRegions = regionsMatchedByText(bodySiteRaw);

  if (tokens.length === 0) {
    return { ranked: results.map((r) => ({ ...r })), anySiteMatch: true };
  }

  const scored = results.map((r, originalIndex) => {
    const term = r.term ?? "";
    const termLower = term.toLowerCase();
    const siteScore = scoreTermForBodySite(term, tokens);
    const termRegions = regionsMatchedByText(term);
    const crossConflict =
      siteRegions.size > 0 && termRegions.size > 0 && hasCrossRegionConflict(siteRegions, termRegions);
    return { r, originalIndex, siteScore, crossConflict };
  });

  scored.sort((a, b) => {
    if (a.crossConflict !== b.crossConflict) return a.crossConflict ? 1 : -1;
    if (a.siteScore !== b.siteScore) return b.siteScore - a.siteScore;
    return a.originalIndex - b.originalIndex;
  });

  const top = scored[0];
  /** Generic SNOMED labels (e.g. "Pain", "Purulent discharge") rarely repeat the toe/chest in the FSN — do not treat that as low confidence. */
  const anySiteMatch = top != null && top.siteScore > 0;

  const ranked: SnomedRow[] = scored.map((x, i) => ({
    conceptId: x.r.conceptId,
    term: x.r.term,
    icd10: x.r.icd10,
    ...(i === 0 && top?.crossConflict ? { lowConfidence: true as const } : {}),
  }));

  return { ranked, anySiteMatch };
}
