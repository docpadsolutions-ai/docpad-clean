import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/app/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Short-lived signed URL for encrypted backup objects (operational restore is out-of-band).
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 503 });
  }

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { backup_id?: string };
  try {
    body = (await req.json()) as { backup_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const backupId = (body.backup_id ?? "").trim();
  if (!backupId) {
    return NextResponse.json({ error: "backup_id is required." }, { status: 400 });
  }

  const admin = createSupabaseAdmin();
  const { data: row, error: rowErr } = await admin
    .from("backup_logs")
    .select("hospital_id, storage_object_path, status")
    .eq("id", backupId)
    .maybeSingle();

  if (rowErr || !row?.storage_object_path) {
    return NextResponse.json({ error: "Backup artifact not available." }, { status: 404 });
  }

  const { data: isAdmin, error: adminErr } = await supabase.rpc("_caller_is_hospital_staff_admin", {
    p_hospital_id: row.hospital_id as string,
  });
  if (adminErr || !isAdmin) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (row.status !== "completed") {
    return NextResponse.json({ error: "Backup is not completed." }, { status: 409 });
  }

  const path = String(row.storage_object_path);
  const { data: signed, error: signErr } = await admin.storage
    .from("hospital-backups")
    .createSignedUrl(path, 120);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: signErr?.message ?? "Could not sign URL." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
