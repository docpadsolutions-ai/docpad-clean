/**
 * Near-duplicate patient name checks for search results and queue lists.
 * Uses Levenshtein distance ≤ 3 and/or same first name + same last initial.
 */

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const t = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = t;
    }
  }
  return row[n]!;
}

function normalizeFullName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function firstNameAndLastInitial(fullName: string): { first: string; lastI: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", lastI: "" };
  const first = parts[0]!.toLowerCase();
  const lastPart = parts.length > 1 ? parts[parts.length - 1]! : "";
  const lastI = lastPart ? lastPart.charAt(0).toLowerCase() : "";
  return { first, lastI };
}

/** True if names are “similar” by Levenshtein ≤ 3 or same first + last initial. */
export function patientNamesSimilar(a: string, b: string): boolean {
  const na = normalizeFullName(a);
  const nb = normalizeFullName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (levenshtein(na, nb) <= 3) return true;
  const fa = firstNameAndLastInitial(a);
  const fb = firstNameAndLastInitial(b);
  if (fa.first && fa.lastI && fa.first === fb.first && fa.lastI === fb.lastI) return true;
  return false;
}

export type PatientNameEntry = { id: string; fullName: string };

/** IDs that have at least one similar-named peer in the same set (for row highlight + badge). */
export function patientIdsWithSimilarNamePeer(entries: PatientNameEntry[]): Set<string> {
  const flagged = new Set<string>();
  const n = entries.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (patientNamesSimilar(entries[i]!.fullName, entries[j]!.fullName)) {
        flagged.add(entries[i]!.id);
        flagged.add(entries[j]!.id);
      }
    }
  }
  return flagged;
}

/** Display names of other options similar to the selected row (excluding selected id). */
export function similarFullNamesToSelected(
  selectedId: string,
  selectedName: string,
  options: PatientNameEntry[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const o of options) {
    if (o.id === selectedId) continue;
    if (!patientNamesSimilar(selectedName, o.fullName)) continue;
    const label = o.fullName.trim() || "—";
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

/** Non-blocking toast body when picking a patient with similar names still in the result list. */
export function similarPatientNamesWarningBody(
  selectedDisplayName: string,
  otherDisplayNames: string[],
): string | undefined {
  const a = selectedDisplayName.trim() || "Patient";
  const others = otherDisplayNames.map((s) => s.trim()).filter(Boolean);
  if (others.length === 0) return undefined;
  const all = [...new Set([a, ...others])];
  if (all.length < 2) return undefined;
  const listed =
    all.length === 2
      ? `${all[0]} and ${all[1]}`
      : `${all.slice(0, -1).join(", ")}, and ${all[all.length - 1]!}`;
  return `${listed} are in your search results. Verify before proceeding.`;
}
