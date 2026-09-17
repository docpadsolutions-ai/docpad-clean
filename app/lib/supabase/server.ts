import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "./admin";

/**
 * Cookie-bound Supabase client for Route Handlers / Server Actions.
 * Queries run as the signed-in user, so RLS applies.
 */
export async function createSupabaseServer(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return null;

  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a context where cookies are read-only; the session refresh is handled by middleware.
        }
      },
    },
  });
}

export type StaffContext = {
  /** Client acting as the signed-in user (RLS enforced). */
  supabase: SupabaseClient;
  user: User;
  practitionerId: string;
  hospitalId: string;
  role: string | null;
};

type StaffResult = { ok: true; staff: StaffContext } | { ok: false; response: NextResponse };

/**
 * Gate for API routes: the caller must be signed in AND be an active practitioner linked to a hospital.
 * Usage:
 *   const gate = await requireStaff();
 *   if (!gate.ok) return gate.response;
 *   const { hospitalId } = gate.staff;
 */
export async function requireStaff(): Promise<StaffResult> {
  const supabase = await createSupabaseServer();
  if (!supabase) {
    return { ok: false, response: NextResponse.json({ error: "Server misconfiguration." }, { status: 503 }) };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  // Looked up with the service role so the gate does not depend on practitioners RLS.
  const admin = createSupabaseAdmin();
  const { data: prac, error } = await admin
    .from("practitioners")
    .select("id, hospital_id, is_active, user_role, role")
    .or(`user_id.eq.${user.id},id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();

  const row = prac as
    | { id: string; hospital_id: string | null; is_active: boolean | null; user_role: string | null; role: string | null }
    | null;

  if (error || !row || !row.hospital_id || row.is_active === false) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }

  return {
    ok: true,
    staff: {
      supabase,
      user,
      practitionerId: row.id,
      hospitalId: row.hospital_id,
      role: row.user_role ?? row.role ?? null,
    },
  };
}

/** Server-only Gemini key. NEXT_PUBLIC_GEMINI_API_KEY is accepted only as a migration fallback. */
export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim() || null;
}
