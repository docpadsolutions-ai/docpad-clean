import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (anon key). Used by `lib/supabase/index.ts`.
 * Uses @supabase/ssr so the session is synced to cookies for proxy.ts and route handlers.
 */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createBrowserClient(url.trim(), key.trim(), {
    auth: {
      // Default 5s acquire timeout can race with concurrent auth work (Strict Mode, HMR)
      // and surface AbortError: "Lock was stolen by another request". Negative = no timer.
      // lockAcquireTimeout is a valid GoTrueClientOptions field not yet re-exported by supabase-js.
      lockAcquireTimeout: -1,
    } as never,
  });
}
