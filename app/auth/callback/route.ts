import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  fetchPractitionerRoleColumnForAuth,
  resolveDefaultHomePathFromPractitionerRole,
} from "../../lib/postLoginHomePath";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const explicitNext =
    nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return NextResponse.redirect(new URL("/", origin));
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      let targetPath = explicitNext ?? "/dashboard";
      if (!explicitNext || targetPath === "/dashboard") {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const role = user?.id ? await fetchPractitionerRoleColumnForAuth(supabase, user.id) : null;
        targetPath = resolveDefaultHomePathFromPractitionerRole(role);
      }
      return NextResponse.redirect(new URL(targetPath, origin));
    }
  }

  return NextResponse.redirect(new URL("/", origin));
}
