"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Database, Download, HardDrive, KeyRound, Shield } from "lucide-react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "backups" as const, label: "Backups", icon: HardDrive },
  { id: "auth" as const, label: "Authentication", icon: KeyRound },
  { id: "sessions" as const, label: "Session Management", icon: Shield },
  { id: "export" as const, label: "Data Export", icon: Database },
];

type TabId = (typeof TABS)[number]["id"];

type BackupRow = {
  id: string;
  created_at: string;
  completed_at: string | null;
  size_bytes: number | null;
  status: string;
  encrypted: boolean;
  encryption_key_hash: string | null;
  storage_object_path: string | null;
  error_message: string | null;
};

function formatBytes(n: number | null): string {
  if (n == null || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function timeToInputValue(t: string | null | undefined): string {
  if (!t) return "02:00";
  const s = String(t).trim();
  if (s.length >= 5) return s.slice(0, 5);
  return s;
}

export default function SystemSecurityPage() {
  const [tab, setTab] = useState<TabId>("backups");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupRunning, setBackupRunning] = useState(false);
  const [freq, setFreq] = useState<"daily" | "weekly" | "monthly">("daily");
  const [runAt, setRunAt] = useState("02:00");
  const [tz, setTz] = useState("Asia/Kolkata");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);

  const refreshBackups = useCallback(async (hid: string) => {
    setBackupsLoading(true);
    const { data, error } = await supabase.rpc("list_hospital_backups", {
      p_hospital_id: hid,
      p_limit: 10,
    });
    setBackupsLoading(false);
    if (error) {
      setLoadErr(error.message);
      setBackups([]);
      return;
    }
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setBackups(
      rows.map((r) => ({
        id: String(r.id),
        created_at: String(r.created_at),
        completed_at: r.completed_at != null ? String(r.completed_at) : null,
        size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
        status: String(r.status),
        encrypted: Boolean(r.encrypted),
        encryption_key_hash: r.encryption_key_hash != null ? String(r.encryption_key_hash) : null,
        storage_object_path: r.storage_object_path != null ? String(r.storage_object_path) : null,
        error_message: r.error_message != null ? String(r.error_message) : null,
      })),
    );
  }, []);

  const loadSchedule = useCallback(async (hid: string) => {
    setScheduleLoading(true);
    setScheduleMsg(null);
    const { data, error } = await supabase.rpc("get_hospital_backup_schedule", { p_hospital_id: hid });
    setScheduleLoading(false);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    const row = Array.isArray(data) && data.length > 0 ? (data[0] as Record<string, unknown>) : null;
    if (row) {
      const f = String(row.frequency ?? "daily");
      if (f === "daily" || f === "weekly" || f === "monthly") setFreq(f);
      setRunAt(timeToInputValue(String(row.run_at ?? "02:00:00")));
      setTz(String(row.timezone ?? "Asia/Kolkata"));
      setScheduleEnabled(Boolean(row.enabled));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { hospitalId: hid, error } = await fetchHospitalIdFromPractitionerAuthId();
      if (cancelled) return;
      if (error) {
        setLoadErr(error.message);
        return;
      }
      if (!hid) {
        setLoadErr("No hospital context for your account.");
        return;
      }
      setHospitalId(hid);
      await Promise.all([refreshBackups(hid), loadSchedule(hid)]);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSchedule, refreshBackups]);

  async function onBackupNow() {
    if (!hospitalId) return;
    setBackupRunning(true);
    setLoadErr(null);
    try {
      const { data, error } = await supabase.rpc("trigger_manual_backup", { p_hospital_id: hospitalId });
      if (error) throw new Error(error.message);
      const payload = data as { backup_id?: string; client_run_required?: boolean } | null;
      const backupId = payload?.backup_id != null ? String(payload.backup_id) : "";
      if (!backupId) throw new Error("No backup_id returned from trigger_manual_backup.");

      if (payload?.client_run_required !== false) {
        const runRes = await fetch("/api/admin/backups/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ backup_id: backupId }),
        });
        if (!runRes.ok) {
          const j = (await runRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `Backup worker failed (${runRes.status})`);
        }
      }

      await refreshBackups(hospitalId);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupRunning(false);
    }
  }

  async function onSaveSchedule() {
    if (!hospitalId) return;
    setScheduleSaving(true);
    setScheduleMsg(null);
    const runAtSql = runAt.length === 5 ? `${runAt}:00` : runAt;
    const { error } = await supabase.rpc("upsert_hospital_backup_schedule", {
      p_hospital_id: hospitalId,
      p_frequency: freq,
      p_run_at: runAtSql,
      p_timezone: tz.trim() || "Asia/Kolkata",
      p_enabled: scheduleEnabled,
    });
    setScheduleSaving(false);
    if (error) {
      setScheduleMsg(error.message);
      return;
    }
    setScheduleMsg("Schedule saved. Wire pg_cron to your worker using these values when ready.");
  }

  async function onRestoreDownload(backupId: string) {
    setLoadErr(null);
    const res = await fetch("/api/admin/backups/signed-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ backup_id: backupId }),
    });
    const j = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !j?.url) {
      setLoadErr(j?.error ?? "Could not get download link.");
      return;
    }
    window.open(j.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="bg-background p-8 text-foreground">
      <div className="mb-6">
        <Link href="/dashboard/admin" className="text-sm font-medium text-blue-600 hover:text-blue-700">
          ← Administration
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">System security</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Hospital-scoped controls for backups, access, sessions, and regulated exports.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-border pb-px">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-t-md border border-transparent px-3 py-2 text-sm font-medium transition-colors",
              tab === id
                ? "border-border border-b-background bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {loadErr && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadErr}
        </div>
      )}

      {tab === "backups" && (
        <div className="space-y-6">
          <Card className="rounded-xl border-border shadow-sm">
            <CardHeader>
              <CardTitle>Database backups</CardTitle>
              <CardDescription>
                Encrypted schema exports to Storage bucket <code className="text-xs">hospital-backups</code>. Aligns
                with NABH 6th Ed section 9.4.2 (data security and backups) and DPDPA 2023 section 8 (technical
                safeguards). <code className="text-xs">pg_dump</code> runs on the application server (see{" "}
                <code className="text-xs">DATABASE_URL</code>, PostgreSQL client tools).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void onBackupNow()} disabled={!hospitalId || backupRunning}>
                {backupRunning ? "Backing up…" : "Backup Now"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Starts <code className="rounded bg-muted px-1">trigger_manual_backup</code> then runs the worker when
                required.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border shadow-sm">
            <CardHeader>
              <CardTitle>Automated schedule</CardTitle>
              <CardDescription>
                Preferred window for daily, weekly, or monthly jobs. Execution still requires pg_cron (or similar)
                calling your deployed backup worker with these parameters.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {scheduleLoading ? (
                <p className="text-sm text-muted-foreground">Loading schedule…</p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Frequency</Label>
                      <Select value={freq} onValueChange={(v) => setFreq(v as typeof freq)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="backup-time">Local time</Label>
                      <Input
                        id="backup-time"
                        type="time"
                        value={runAt}
                        onChange={(e) => setRunAt(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="backup-tz">Timezone (IANA)</Label>
                      <Input
                        id="backup-tz"
                        value={tz}
                        onChange={(e) => setTz(e.target.value)}
                        placeholder="Asia/Kolkata"
                      />
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={scheduleEnabled}
                      onChange={(e) => setScheduleEnabled(e.target.checked)}
                    />
                    Enable automated backups (metadata only until cron is configured)
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="secondary" onClick={() => void onSaveSchedule()} disabled={!hospitalId || scheduleSaving}>
                      {scheduleSaving ? "Saving…" : "Save schedule"}
                    </Button>
                    {scheduleMsg && <span className="text-xs text-muted-foreground">{scheduleMsg}</span>}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border shadow-sm">
            <CardHeader>
              <CardTitle>Recent backups</CardTitle>
              <CardDescription>Last 10 jobs for your hospital.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {backupsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : backups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No backups yet.</p>
              ) : (
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Started</th>
                      <th className="py-2 pr-3 font-medium">Size</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Encrypted</th>
                      <th className="py-2 pr-3 font-medium">Restore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map((b) => (
                      <tr key={b.id} className="border-b border-border/80">
                        <td className="py-2 pr-3 align-top">{formatTs(b.created_at)}</td>
                        <td className="py-2 pr-3 align-top">{formatBytes(b.size_bytes)}</td>
                        <td className="py-2 pr-3 align-top">
                          <span className="capitalize">{b.status}</span>
                          {b.error_message && (
                            <span className="mt-0.5 block text-xs text-destructive">{b.error_message}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-top">{b.encrypted ? "Yes" : "No"}</td>
                        <td className="py-2 pr-3 align-top">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            disabled={b.status !== "completed"}
                            title="Download encrypted backup artifact for operational restore (decrypt off-app)."
                            onClick={() => void onRestoreDownload(b.id)}
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden />
                            Restore
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "auth" && (
        <Card className="max-w-2xl rounded-xl border-border shadow-sm">
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>
              Strengthen sign-in for clinical and admin users (MFA, password rotation, and break-glass accounts) as
              part of your NABH and DPDPA technical control program.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Supabase Auth policies and SSO integration are configured in the Supabase dashboard and your IdP.</p>
            <p>This screen will host hospital-level authentication policy toggles in a follow-up.</p>
          </CardContent>
        </Card>
      )}

      {tab === "sessions" && (
        <Card className="max-w-2xl rounded-xl border-border shadow-sm">
          <CardHeader>
            <CardTitle>Session management</CardTitle>
            <CardDescription>
              Idle timeout, concurrent session limits, and forced logout support audit expectations under DPDPA section
              8.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Session length and refresh behavior are driven by Supabase JWT settings and your application middleware.</p>
            <p>Hospital-specific session rules can be added here next.</p>
          </CardContent>
        </Card>
      )}

      {tab === "export" && (
        <Card className="max-w-2xl rounded-xl border-border shadow-sm">
          <CardHeader>
            <CardTitle>Data export</CardTitle>
            <CardDescription>
              Regulated exports for access requests and portability (DPDPA). Use auditable, role-gated exports only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Patient-level and hospital-level export wizards will plug in here; backup artifacts above are encrypted
              schema dumps, not chart exports.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
