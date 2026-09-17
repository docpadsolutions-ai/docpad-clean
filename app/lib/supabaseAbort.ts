/** Chain PostgREST / RPC builder with an AbortSignal when provided. */
export function sx<T>(q: T, signal: AbortSignal | undefined): T {
  if (!signal) return q;
  const b = q as T & { abortSignal: (s: AbortSignal) => T };
  return b.abortSignal(signal);
}

/** True when Supabase returned an error object for a locally aborted fetch. */
export function isSupabaseAbortError(error: { message?: string; hint?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = (error.message ?? "").toLowerCase();
  const h = (error.hint ?? "").toLowerCase();
  return m.includes("abort") || h.includes("aborted");
}
