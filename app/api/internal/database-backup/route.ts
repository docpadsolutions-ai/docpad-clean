import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/app/lib/supabase/admin";
import { loadBackupRow, runHospitalBackupJob } from "@/app/lib/backup/runHospitalBackup";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Called from Supabase pg_net (optional) with DATABASE_BACKUP_INTERNAL_SECRET.
 * Must match public.backup_worker_settings.bearer_secret for the same project.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.DATABASE_BACKUP_INTERNAL_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "DATABASE_BACKUP_INTERNAL_SECRET is not configured." }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { backup_id?: string; hospital_id?: string };
  try {
    body = (await req.json()) as { backup_id?: string; hospital_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const backupId = (body.backup_id ?? "").trim();
  const hospitalId = (body.hospital_id ?? "").trim();
  if (!backupId || !hospitalId) {
    return NextResponse.json({ error: "backup_id and hospital_id are required." }, { status: 400 });
  }

  const admin = createSupabaseAdmin();
  const row = await loadBackupRow(admin, backupId);
  if (!row || row.hospital_id !== hospitalId) {
    return NextResponse.json({ error: "Backup job not found." }, { status: 404 });
  }

  if (row.status !== "queued") {
    return NextResponse.json({ error: "Backup job is not queued.", status: row.status }, { status: 409 });
  }

  await runHospitalBackupJob(admin, backupId, hospitalId);
  return NextResponse.json({ ok: true });
}
