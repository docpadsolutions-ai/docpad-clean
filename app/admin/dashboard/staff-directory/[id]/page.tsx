"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { formatPractitionerRoleDisplay } from "@/app/lib/practitionerRoleDisplay";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { StaffPerformanceTab } from "./StaffPerformanceTab";

export type StaffDirectoryDetailRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  sub_role: string;
  hpr_id: string | null;
  specialization: string | null;
  is_active: boolean;
  last_login: string | null;
  account_created_at: string | null;
  invite_accepted_at: string | null;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function pickIso(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function roleLabel(raw: string): string {
  return formatPractitionerRoleDisplay(raw);
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isNurseRole(r: StaffDirectoryDetailRow): boolean {
  return /\bnurse\b/i.test(r.role) || /\bnurse\b/i.test(r.sub_role);
}

export default function StaffDirectoryDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id.trim() : "";

  const [row, setRow] = useState<StaffDirectoryDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nurseWardToday, setNurseWardToday] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"profile" | "performance">("profile");

  const load = useCallback(async (practitionerId: string) => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("get_staff_directory_entry", {
      p_practitioner_id: practitionerId,
    });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setRow(null);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    const r = list[0];
    if (!r) {
      setRow(null);
      setError("Staff member not found or you do not have access.");
      return;
    }
    setRow({
      id: String(r.id),
      full_name: String(r.full_name ?? "—"),
      email: String(r.email ?? "—"),
      phone: r.phone != null && String(r.phone).trim() ? String(r.phone).trim() : null,
      role: String(r.role ?? "—"),
      sub_role: String(r.sub_role ?? "—"),
      hpr_id: r.hpr_id != null && String(r.hpr_id).trim() ? String(r.hpr_id) : null,
      specialization: r.specialization != null && String(r.specialization).trim() ? String(r.specialization).trim() : null,
      is_active: Boolean(r.is_active),
      last_login: pickIso(r.last_login),
      account_created_at: pickIso(r.account_created_at),
      invite_accepted_at: pickIso(r.invite_accepted_at),
    });
  }, []);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("Missing staff id.");
      return;
    }
    void load(id);
  }, [id, load]);

  useEffect(() => {
    if (!row || !isNurseRole(row)) {
      setNurseWardToday(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      if (cancelled || !hid) return;
      const ymd = todayYmd();
      const [{ data: assigns }, { data: wards }] = await Promise.all([
        supabase
          .from("ward_staff_assignments")
          .select("ward_id, shift")
          .eq("hospital_id", hid)
          .eq("practitioner_id", row.id)
          .eq("assigned_date", ymd)
          .maybeSingle(),
        supabase.from("ipd_wards").select("id, name").eq("hospital_id", hid),
      ]);
      if (cancelled) return;
      const a = assigns as Record<string, unknown> | null;
      if (!a?.ward_id) {
        setNurseWardToday("Not assigned today");
        return;
      }
      const wmap = new Map((wards ?? []).map((w) => [String((w as Record<string, unknown>).id), String((w as Record<string, unknown>).name ?? "Ward")]));
      const wn = wmap.get(String(a.ward_id)) ?? "Ward";
      const shift = String(a.shift ?? "").trim();
      setNurseWardToday(shift ? `${wn} · ${shift}` : wn);
    })();
    return () => {
      cancelled = true;
    };
  }, [row]);

  const headerSubtitle = useMemo(() => {
    if (!row) return null;
    return row.is_active ? "Active account" : "Inactive account";
  }, [row]);

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <Button variant="outline" asChild>
          <Link href="/admin/dashboard/staff-directory">← Staff directory</Link>
        </Button>

        {loading ? (
          <Card className="border-border shadow-sm">
            <CardContent className="py-12">
              <p className="text-center text-sm text-muted-foreground">Loading staff profile…</p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-border shadow-sm">
            <CardContent className="py-8">
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            </CardContent>
          </Card>
        ) : row ? (
          <>
            <Card className="border-border shadow-sm">
              <CardHeader className="space-y-4 border-b border-border pb-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <CardTitle className="text-2xl font-bold tracking-tight">{row.full_name}</CardTitle>
                    {headerSubtitle ? (
                      <CardDescription className="text-base">{headerSubtitle}</CardDescription>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-start gap-3 sm:items-end">
                    <span className="inline-flex w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                      {roleLabel(row.role)}
                    </span>
                    <div className="flex flex-col gap-1.5 sm:items-end">
                      <span className="text-xs font-medium text-muted-foreground">Account status</span>
                      <div
                        role="switch"
                        aria-checked={row.is_active}
                        aria-disabled="true"
                        title="Status changes are not available yet"
                        className={cn(
                          "pointer-events-none relative inline-flex h-9 w-[3.75rem] shrink-0 rounded-full border border-border p-0.5 opacity-80",
                          row.is_active ? "bg-green-500/15" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none absolute top-0.5 h-7 w-7 rounded-full bg-background shadow-sm ring-1 ring-border transition-[left]",
                            row.is_active ? "left-0.5" : "left-[calc(100%-1.875rem)]",
                          )}
                          aria-hidden
                        />
                        <span className="sr-only">{row.is_active ? "Active" : "Inactive"}</span>
                      </div>
                      <span className="text-xs font-semibold text-foreground">{row.is_active ? "Active" : "Inactive"}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/40 p-1 dark:bg-muted/20">
              <button
                type="button"
                onClick={() => setDetailTab("profile")}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                  detailTab === "profile"
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Profile
              </button>
              <button
                type="button"
                onClick={() => setDetailTab("performance")}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                  detailTab === "performance"
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Performance
              </button>
            </div>

            {detailTab === "performance" ? (
              <StaffPerformanceTab practitionerId={row.id} />
            ) : (
              <>
            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Contact</CardTitle>
                <CardDescription>Reach this team member when details are on file.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</p>
                  {row.email && row.email !== "—" ? (
                    <a href={`mailto:${row.email}`} className="mt-1 inline-block font-medium text-blue-600 hover:underline">
                      {row.email}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">—</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone</p>
                  <p className="mt-1 text-sm text-foreground">
                    {row.phone ? (
                      <a href={`tel:${row.phone}`} className="font-medium text-blue-600 hover:underline">
                        {row.phone}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Not on file</span>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

            {row && isNurseRole(row) ? (
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Ward assignment (today)</CardTitle>
                  <CardDescription>Shift-based ward coverage for IPD nursing.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-foreground">{nurseWardToday ?? "Loading…"}</p>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/admin/dashboard/staff-directory">Open staff directory to assign</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Professional info</CardTitle>
                <CardDescription>Registry and role details for this hospital.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">HPR ID</p>
                  <p className="mt-1 font-mono text-sm text-foreground">{row.hpr_id ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Designation / sub-role</p>
                  <p className="mt-1 text-sm capitalize text-foreground">{roleLabel(row.sub_role)}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Specialization</p>
                  <p className="mt-1 text-sm">
                    {row.specialization ? (
                      <span className="text-foreground">{row.specialization}</span>
                    ) : (
                      <span className="text-muted-foreground">Not on file</span>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Account details</CardTitle>
                <CardDescription>Sign-in and onboarding timestamps from Auth and invitations.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last login</p>
                  <p className="mt-1 text-sm text-foreground">{formatDateTime(row.last_login)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">From Supabase Auth when the user has signed in.</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account created</p>
                  <p className="mt-1 text-sm text-foreground">{formatDateTime(row.account_created_at)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invite accepted</p>
                  <p className="mt-1 text-sm text-foreground">
                    {row.invite_accepted_at ? formatDateTime(row.invite_accepted_at) : <span className="text-muted-foreground">—</span>}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Actions</CardTitle>
                <CardDescription>Destructive actions will be enabled in a later release.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" variant="outline" disabled className="border-red-200 text-red-600 dark:border-red-900/50 dark:text-red-400">
                  Deactivate account
                </Button>
              </CardContent>
            </Card>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
