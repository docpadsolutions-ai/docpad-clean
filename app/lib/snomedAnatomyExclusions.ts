import type { SnomedRow } from "./snomedBodySiteRank";

/** Reject SNOMED concepts whose FSN implies incompatible anatomy vs stated body site. */
export function filterSnomedByBodySiteAnatomy(
  results: SnomedRow[],
  bodySite?: string | null,
): SnomedRow[] {
  if (!bodySite?.trim()) return results;

  const ANATOMY_EXCLUSIONS: Record<string, string[]> = {
    toe: ["conjunctiv", "nasal", "oral", "ear", "vagina", "rectal", "urethral", "penile", "ocular", "pharyn"],
    finger: ["conjunctiv", "nasal", "oral", "ear", "vagina", "rectal", "toe", "ocular", "pharyn"],
    knee: ["elbow", "shoulder", "hip", "wrist", "ankle", "conjunctiv", "oral"],
    hip: ["shoulder", "knee", "elbow", "wrist", "ankle", "conjunctiv"],
    shoulder: ["hip", "knee", "ankle", "elbow", "conjunctiv"],
    elbow: ["knee", "hip", "shoulder", "ankle", "conjunctiv"],
    ankle: ["wrist", "elbow", "shoulder", "conjunctiv"],
    wrist: ["ankle", "knee", "hip", "conjunctiv"],
    thigh: ["inguinal", "abdomin", "conjunctiv", "forearm", "arm"],
    spine: ["conjunctiv", "oral", "nasal", "abdomin"],
    back: ["conjunctiv", "oral", "nasal"],
    chest: ["abdomin", "conjunctiv", "oral", "nasal"],
    abdomen: ["chest", "thorax", "conjunctiv", "oral"],
    eye: ["nasal", "oral", "ear", "vagina", "rectal"],
    ear: ["eye", "nasal", "oral", "vagina", "rectal", "conjunctiv"],
    throat: ["conjunctiv", "rectal", "vagina", "urethral"],
    foot: ["hand", "conjunctiv", "oral", "nasal"],
    hand: ["foot", "conjunctiv", "oral", "nasal"],
    leg: ["arm", "conjunctiv", "oral"],
    arm: ["leg", "conjunctiv", "oral"],
    neck: ["conjunctiv", "rectal", "vagina"],
    scalp: ["conjunctiv", "rectal", "vagina", "oral"],
  };

  const bodySiteLower = bodySite.toLowerCase();
  let exclusions: string[] = [];
  for (const [key, excl] of Object.entries(ANATOMY_EXCLUSIONS)) {
    if (bodySiteLower.includes(key)) {
      exclusions = [...exclusions, ...excl];
    }
  }

  if (exclusions.length === 0) return results;

  return results.filter((r) => {
    const termLower = `${r.term ?? ""} ${(r as { fsn?: string }).fsn ?? ""}`.toLowerCase();
    return !exclusions.some((excl) => termLower.includes(excl));
  });
}
