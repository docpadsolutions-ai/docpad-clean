"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Same browser client as `fetchAuthOrgId` / `lib/supabase`.
 * Avoids multiple GoTrueClient instances (shared storage key → flaky session/JWT).
 */
export function useSupabase(): SupabaseClient {
  return supabase;
}
