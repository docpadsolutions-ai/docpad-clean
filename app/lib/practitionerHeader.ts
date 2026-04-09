import { practitionerDisplayNameFromRow, practitionerRoleRawFromRow } from "./practitionerAuthLookup";

type PractitionerHeaderRow = {
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  user_role?: unknown;
  role?: unknown;
  specialty?: unknown;
  qualification?: unknown;
};

/** Primary line for app chrome (e.g. OPD header). Adds "Dr." when role suggests a physician and the name is not already prefixed. */
export function practitionerHeaderTitle(row: PractitionerHeaderRow): string {
  const display = practitionerDisplayNameFromRow(row).trim();
  if (!display) return "";
  if (/^(dr\.?|doctor)\b/i.test(display)) return display;
  const raw = practitionerRoleRawFromRow(row) ?? "";
  const r = raw.toLowerCase();
  if (
    /\b(doctor|physician|surgeon|consultant|orthopedic|orthopaedic|cardio|pediatric|gynec|gynaec|psychiat|dermat|ent\b|md\b|mbbs)\b/.test(
      r,
    ) ||
    /\bdr\.?\b/.test(r)
  ) {
    return `Dr. ${display}`;
  }
  return display;
}

/** Subtitle under the name: `user_role`, legacy `role`, then `specialty` / `qualification`. */
export function practitionerHeaderSubtitle(row: PractitionerHeaderRow): string {
  const ur = row.user_role;
  if (ur != null && String(ur).trim() !== "") return String(ur).trim();
  const lr = row.role;
  if (lr != null && String(lr).trim() !== "") return String(lr).trim();
  const sp = row.specialty;
  if (sp != null && String(sp).trim() !== "") return String(sp).trim();
  const q = row.qualification;
  if (q != null && String(q).trim() !== "") return String(q).trim();
  return "";
}
