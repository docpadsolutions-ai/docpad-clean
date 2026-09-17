import type { SupabaseClient } from "@supabase/supabase-js";
import { practitionersOrFilterForAuthUid } from "../../lib/practitionerAuthLookup";

/** Resolves current user's `practitioners.id` for `uploaded_by`. */
export async function getUploaderPractitionerId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return null;
  const { data } = await supabase.from("practitioners").select("id").or(practitionersOrFilterForAuthUid(uid)).maybeSingle();
  const id = data && typeof data === "object" && "id" in data ? String((data as { id: unknown }).id ?? "").trim() : "";
  return id || null;
}
