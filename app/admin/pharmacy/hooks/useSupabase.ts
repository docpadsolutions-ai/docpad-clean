"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../../supabase";

/**
 * Same browser client as `fetchAuthOrgId` / `app/supabase.ts`.
 * Avoids multiple GoTrueClient instances (shared storage key → flaky session/JWT).
 */
export function useSupabase(): SupabaseClient {
  return supabase;
}
