import { supabase } from "../supabase";
import { practitionersOrFilterForAuthUid } from "./practitionerAuthLookup";

/**
 * Current user's organization UUID from `practitioners.hospital_id`, via DB helper `auth_org()`.
 *
 * Run in Supabase (SQL editor):
 *
 * ```sql
 * create or replace function public.auth_org()
 * returns uuid
 * language sql
 * stable
 * security definer
 * set search_path = public
 * as $$
 *   select p.hospital_id
 *   from public.practitioners p
 *   where p.id = auth.uid()
 *   limit 1;
 * $$;
 *
 * grant execute on function public.auth_org() to authenticated;
 * ```
 */
export async function fetchAuthOrgId(): Promise<{ orgId: string | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("auth_org");
  if (error) return { orgId: null, error: new Error(error.message) };
  if (data == null || data === "") return { orgId: null, error: null };
  const id = String(data).trim();
  return { orgId: id || null, error: null };
}

/**
 * Hospital for the signed-in user: first matching `practitioners` row where `id = auth.uid()` OR
 * `user_id = auth.uid()` (same as `practitionersOrFilterForAuthUid`).
 */
export async function fetchHospitalIdFromPractitionerAuthId(): Promise<{
  hospitalId: string | null;
  error: Error | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return { hospitalId: null, error: null };
  }

  const uid = user.id;
  const { data: prac, error } = await supabase
    .from("practitioners")
    .select("hospital_id")
    .or(practitionersOrFilterForAuthUid(uid))
    .maybeSingle();

  if (error) {
    return { hospitalId: null, error: new Error(error.message) };
  }
  const hid = prac?.hospital_id;
  if (hid == null || hid === "") {
    return { hospitalId: null, error: null };
  }
  return { hospitalId: String(hid).trim(), error: null };
}

/**
 * Hospital UUID for the signed-in user: `practitioners.hospital_id` where `user_id = auth.uid()`.
 * Use for pharmacy inventory and other flows where the practitioner row is keyed by Supabase auth user id
 * (distinct from `fetchHospitalIdFromPractitionerAuthId()` when the session maps to `practitioners.id`).
 */
export async function fetchHospitalIdFromPractitionerUser(): Promise<{
  hospitalId: string | null;
  error: Error | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return { hospitalId: null, error: null };
  }

  const { data, error } = await supabase
    .from("practitioners")
    .select("hospital_id")
    .eq("user_id", user.id)
    .not("hospital_id", "is", null)
    .limit(1);

  if (error) {
    return { hospitalId: null, error: new Error(error.message) };
  }
  const hid = data?.[0]?.hospital_id;
  if (hid == null || hid === "") {
    return { hospitalId: null, error: null };
  }
  return { hospitalId: String(hid).trim(), error: null };
}
