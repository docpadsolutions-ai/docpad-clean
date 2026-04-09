import { createBrowserSupabaseClient } from "./lib/supabase/client";

const globalForSupabase = globalThis as unknown as {
  __docpadSupabase?: ReturnType<typeof createBrowserSupabaseClient>;
};

export const supabase =
  globalForSupabase.__docpadSupabase ?? createBrowserSupabaseClient();

if (process.env.NODE_ENV !== "production") {
  globalForSupabase.__docpadSupabase = supabase;
}
