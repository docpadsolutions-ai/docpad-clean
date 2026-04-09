import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/app/lib/supabase/admin";
import { loadBackupRow, runHospitalBackupJob } from "@/app/lib/backup/runHospitalBackup";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Runs pg_dump → AES-256-GCM → Storage after public.trigger_manual_backup when client_run_required is true.
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
  const row = await loadBackupRow(admin, backupId);
  if (!row) {
    return NextResponse.json({ error: "Backup job not found." }, { status: 404 });
  }

  const { data: isAdmin, error: adminErr } = await supabase.rpc("_caller_is_hospital_staff_admin", {
    p_hospital_id: row.hospital_id,
  });
  if (adminErr || !isAdmin) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (row.status !== "queued") {
    return NextResponse.json({ error: "Backup job is not queued.", status: row.status }, { status: 409 });
  }

  await runHospitalBackupJob(admin, backupId, row.hospital_id);
  return NextResponse.json({ ok: true });
}
