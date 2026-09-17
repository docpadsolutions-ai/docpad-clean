/** PostgREST `.or()` filter: row where `id` or `user_id` matches Supabase auth uid. */
export function practitionersOrFilterForAuthUid(uid: string): string {
  return `id.eq.${uid},user_id.eq.${uid}`;
}

export function practitionerRoleRawFromRow(row: {
  user_role?: unknown;
  role?: unknown;
}): string | null {
  const ur = row.user_role;
  if (ur != null && String(ur).trim() !== "") {
    return String(ur).trim();
  }
  const lr = row.role;
  if (lr == null) return null;
  const s = String(lr).trim();
  return s || null;
}

export function practitionerDisplayNameFromRow(row: {
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
}): string {
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ");
}
