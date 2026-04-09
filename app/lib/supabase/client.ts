import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (anon key). Used by `app/supabase.ts`.
 * Uses @supabase/ssr so the session is synced to cookies for middleware (createServerClient).
 */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createBrowserClient(url.trim(), key.trim());
}
