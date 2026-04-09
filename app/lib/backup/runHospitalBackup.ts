import { execFile } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

const BUCKET = "hospital-backups";

export type BackupLogRow = {
  id: string;
  hospital_id: string;
  status: string;
};

export async function loadBackupRow(admin: SupabaseClient, backupId: string): Promise<BackupLogRow | null> {
  const { data, error } = await admin
    .from("backup_logs")
    .select("id, hospital_id, status")
    .eq("id", backupId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: String(data.id),
    hospital_id: String(data.hospital_id),
    status: String(data.status),
  };
}

/**
 * pg_dump (schema-only) → AES-256-GCM → Storage `hospital-backups/{hospital_id}/{backup_id}.sql.enc`.
 * Requires `pg_dump` on PATH and DATABASE_URL (direct/session connection string).
 */
export async function runHospitalBackupJob(admin: SupabaseClient, backupId: string, hospitalId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    await markFailed(admin, backupId, "DATABASE_URL is not set on the application server.");
    return;
  }

  await admin
    .from("backup_logs")
    .update({ status: "running", error_message: null })
    .eq("id", backupId);

  let plain: Buffer;
  try {
    const { stdout } = await execFileAsync(
      "pg_dump",
      ["-d", databaseUrl, "--schema=public", "--schema-only", "--no-owner", "--no-acl"],
      {
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env },
      },
    );
    plain = Buffer.from(stdout, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markFailed(
      admin,
      backupId,
      msg.includes("ENOENT")
        ? "pg_dump was not found on the server PATH. Install PostgreSQL client tools on the host running Next.js."
        : `pg_dump failed: ${msg}`,
    );
    return;
  }

  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]);

  const keyHash = createHash("sha256").update(key).digest("hex");
  const objectPath = `${hospitalId}/${backupId}.sql.enc`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, payload, {
    contentType: "application/octet-stream",
    upsert: false,
  });

  if (upErr) {
    await markFailed(admin, backupId, `Storage upload failed: ${upErr.message}`);
    return;
  }

  const { error: upLogErr } = await admin
    .from("backup_logs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      size_bytes: payload.length,
      encrypted: true,
      encryption_key_hash: keyHash,
      storage_object_path: objectPath,
      error_message: null,
    })
    .eq("id", backupId);

  if (upLogErr) {
    await markFailed(admin, backupId, `Failed to update backup_logs: ${upLogErr.message}`);
  }
}

async function markFailed(admin: SupabaseClient, backupId: string, message: string): Promise<void> {
  await admin
    .from("backup_logs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message.slice(0, 4000),
    })
    .eq("id", backupId);
}
