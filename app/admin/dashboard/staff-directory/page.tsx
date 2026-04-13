"use client";

import { formatDistanceToNow, isValid, parseISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { formatPractitionerRoleDisplay } from "@/app/lib/practitionerRoleDisplay";
import { practitionersOrFilterForAuthUid } from "@/app/lib/practitionerAuthLookup";
import { supabase } from "@/app/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type StaffDirectoryRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  sub_role: string;
  hpr_id: string | null;
  is_active: boolean;
  last_login: string | null;
  /** From `get_all_staff_performance_overview` (merged). */
  attendance_pct: number | null;
  actions_this_month: number | null;
  opd_seen: number | null;
};

function formatRelativeLastLogin(iso: string | null): string {
  if (!iso) return "Never";
  let d = parseISO(iso);
  if (!isValid(d)) d = new Date(iso);
  if (!isValid(d)) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
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

function isNurseRole(r: StaffDirectoryRow): boolean {
  return /\bnurse\b/i.test(r.role) || /\bnurse\b/i.test(r.sub_role);
}

function isDoctorRole(r: StaffDirectoryRow): boolean {
  const x = `${r.role} ${r.sub_role}`.toLowerCase();
  return /\bdoctor\b/i.test(x) || /\bphysician\b/i.test(x) || /\bconsultant\b/i.test(x);
}

function AttendancePctCell({ pct }: { pct: number | null }) {
  if (pct == null || Number.isNaN(pct)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const cls =
    pct >= 90
      ? "text-green-600 dark:text-green-400"
      : pct >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return <span className={cn("font-semibold tabular-nums", cls)}>{pct.toFixed(0)}%</span>;
}

export default function StaffDirectoryPage() {
  const router = useRouter();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<StaffDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [subRoleFilter, setSubRoleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [wardAssignmentsToday, setWardAssignmentsToday] = useState<Record<string, string>>({});
  const [wardOptions, setWardOptions] = useState<{ id: string; name: string }[]>([]);
  const [wardAssignOpenId, setWardAssignOpenId] = useState<string | null>(null);
  const [assignDate, setAssignDate] = useState(todayYmd);
  const [assignWardId, setAssignWardId] = useState("");
  const [assignShift, setAssignShift] = useState<"Morning" | "Afternoon" | "Night" | "General">("Morning");
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignerPractitionerId, setAssignerPractitionerId] = useState<string | null>(null);

  const load = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const [{ data, error: rpcErr }, perfRes] = await Promise.all([
      supabase.rpc("get_all_staff", { p_hospital_id: hid }),
      supabase.rpc("get_all_staff_performance_overview"),
    ]);
    if (rpcErr) {
      setLoading(false);
      setError(rpcErr.message);
      setRows([]);
      return;
    }
    const perfById = new Map<
      string,
      { attendance_pct: number | null; actions_this_month: number | null; opd_seen: number | null }
    >();
    if (!perfRes.error) {
      const plist = (Array.isArray(perfRes.data) ? perfRes.data : []) as Record<string, unknown>[];
      for (const p of plist) {
        const pid = String(p.practitioner_id ?? "");
        if (!pid) continue;
        const ap = p.attendance_pct;
        const at =
          typeof ap === "number" && Number.isFinite(ap)
            ? ap
            : typeof ap === "string"
              ? Number.parseFloat(ap)
              : null;
        const am = p.actions_this_month;
        const act =
          typeof am === "number" && Number.isFinite(am)
            ? am
            : typeof am === "string"
              ? Number.parseInt(am, 10)
              : null;
        const os = p.opd_seen;
        const opd =
          os == null
            ? null
            : typeof os === "number" && Number.isFinite(os)
              ? os
              : typeof os === "string"
                ? Number.parseInt(os, 10)
                : null;
        perfById.set(pid, {
          attendance_pct: at != null && !Number.isNaN(at) ? at : null,
          actions_this_month: act != null && !Number.isNaN(act) ? act : null,
          opd_seen: opd != null && !Number.isNaN(opd) ? opd : null,
        });
      }
    } else {
      console.warn("[staff-directory] get_all_staff_performance_overview:", perfRes.error.message);
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setRows(
      list.map((r) => {
        const id = String(r.id);
        const perf = perfById.get(id);
        return {
          id,
          full_name: String(r.full_name ?? "—"),
          email: String(r.email ?? "—"),
          role: String(r.role ?? "—"),
          sub_role: String(r.sub_role ?? "—"),
          hpr_id: r.hpr_id != null && String(r.hpr_id).trim() ? String(r.hpr_id) : null,
          is_active: Boolean(r.is_active),
          last_login: r.last_login != null ? String(r.last_login) : null,
          attendance_pct: perf?.attendance_pct ?? null,
          actions_this_month: perf?.actions_this_month ?? null,
          opd_seen: perf?.opd_seen ?? null,
        };
      }),
    );

    const ymd = todayYmd();
    const [{ data: wardsData, error: wErr }, { data: assignsData, error: aErr }] = await Promise.all([
      supabase.from("ipd_wards").select("id, name").eq("hospital_id", hid).order("name"),
      supabase.from("ward_staff_assignments").select("practitioner_id, shift, ward_id").eq("hospital_id", hid).eq("assigned_date", ymd),
    ]);
    if (wErr) console.warn("[staff-directory] ipd_wards:", wErr.message);
    if (aErr) console.warn("[staff-directory] ward_staff_assignments:", aErr.message);

    const wards = (wardsData ?? []) as { id: unknown; name: unknown }[];
    setWardOptions(
      wards.map((w) => ({
        id: String(w.id),
        name: String(w.name ?? "Ward"),
      })),
    );
    const wmap = new Map(wards.map((w) => [String(w.id), String(w.name ?? "Ward")]));
    const amap: Record<string, string> = {};
    for (const raw of assignsData ?? []) {
      const a = raw as Record<string, unknown>;
      const pid = String(a.practitioner_id ?? "");
      const wid = String(a.ward_id ?? "");
      const shift = String(a.shift ?? "").trim();
      const wn = wmap.get(wid) ?? "Ward";
      if (pid) amap[pid] = shift ? `${wn} · ${shift}` : wn;
    }
    setWardAssignmentsToday(amap);
    setLoading(false);
  }, []);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid) {
        setAssignerPractitionerId(null);
        return;
      }
      const { data: pr } = await supabase.from("practitioners").select("id").or(practitionersOrFilterForAuthUid(uid)).maybeSingle();
      setAssignerPractitionerId(pr?.id != null ? String(pr.id) : null);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid, error: e } = await fetchHospitalIdFromPractitionerAuthId();
      const id = hid?.trim() || null;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      if (!id) {
        setError("No hospital on your practitioner record. Contact support.");
        setLoading(false);
        return;
      }
      setHospitalId(id);
      await load(id);
    })();
  }, [load]);

  useEffect(() => {
    setSubRoleFilter("all");
  }, [roleFilter]);

  const roleOptions = useMemo(() => {
    const fromData = new Set<string>();
    for (const r of rows) {
      if (r.role && r.role !== "—") fromData.add(r.role.trim());
    }
    const preferred = ["doctor", "nurse", "admin", "administrator", "pharmacist", "receptionist", "lab_tech", "lab tech"];
    const sorted = Array.from(fromData).sort((a, b) => {
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      const ia = preferred.indexOf(la);
      const ib = preferred.indexOf(lb);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
    return sorted;
  }, [rows]);

  const subRoleOptions = useMemo(() => {
    const pool = roleFilter === "all" ? rows : rows.filter((r) => r.role === roleFilter);
    const s = new Set<string>();
    for (const r of pool) {
      if (r.sub_role && r.sub_role !== "—") s.add(r.sub_role.trim());
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows, roleFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (subRoleFilter !== "all" && r.sub_role !== subRoleFilter) return false;
      if (q) {
        const name = r.full_name.toLowerCase();
        const em = r.email.toLowerCase();
        if (!name.includes(q) && !em.includes(q)) return false;
      }
      return true;
    });
  }, [rows, roleFilter, subRoleFilter, search]);

  const goToStaff = useCallback(
    (id: string) => {
      router.push(`/admin/dashboard/staff-directory/${id}`);
    },
    [router],
  );

  const saveWardAssignment = useCallback(
    async (nurseId: string) => {
      if (!hospitalId || !assignerPractitionerId) {
        toast.error("Could not resolve your practitioner ID for assignment.");
        return;
      }
      if (!assignWardId) {
        toast.error("Select a ward.");
        return;
      }
      setAssignSaving(true);
      const { error } = await supabase.from("ward_staff_assignments").insert({
        hospital_id: hospitalId,
        practitioner_id: nurseId,
        ward_id: assignWardId,
        shift: assignShift,
        assigned_date: assignDate,
        assigned_by: assignerPractitionerId,
      });
      setAssignSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Ward assignment saved");
      setWardAssignOpenId(null);
      await load(hospitalId);
    },
    [hospitalId, assignerPractitionerId, assignWardId, assignShift, assignDate, load],
  );

  const emptyAfterLoad = !loading && !error && rows.length === 0;
  const emptyFiltered = !loading && !error && rows.length > 0 && filtered.length === 0;

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Staff directory</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Loaded with your practitioner <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">hospital_id</code> via{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">get_all_staff</code> and{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">get_all_staff_performance_overview</code>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin">← Admin home</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin">Invite staff</Link>
            </Button>
          </div>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-lg">Filters</CardTitle>
            <CardDescription>
              Sub-role options reflect the selected role. Search applies to name and email on this page.
            </CardDescription>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="staff-role">Role</Label>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger id="staff-role">
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {roleOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-sub">Sub-role</Label>
                <Select value={subRoleFilter} onValueChange={setSubRoleFilter}>
                  <SelectTrigger id="staff-sub">
                    <SelectValue
                      placeholder={
                        roleFilter === "all" ? "All sub-roles (any role)" : "Sub-roles for selected role"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sub-roles</SelectItem>
                    {subRoleOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-2">
                <Label htmlFor="staff-search">Search</Label>
                <Input
                  id="staff-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name or email"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 pt-0">
            {error ? (
              <div className="p-6 text-sm text-red-600" role="alert">
                {error}
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <div
                  className="h-9 w-9 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                  aria-hidden
                />
                <p className="text-sm font-medium text-muted-foreground">Loading staff directory…</p>
              </div>
            ) : emptyAfterLoad ? (
              <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                <p className="text-base font-semibold text-foreground">No staff members found</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  No practitioners are linked to this hospital yet, or the list is empty. Send invitations to onboard
                  your team.
                </p>
                <Button asChild>
                  <Link href="/admin">Invite staff</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border">
                        <TableHead className="min-w-[140px]">Name</TableHead>
                        <TableHead className="min-w-[180px]">Email</TableHead>
                        <TableHead className="min-w-[100px]">Role</TableHead>
                        <TableHead className="min-w-[120px]">Sub-role</TableHead>
                        <TableHead className="min-w-[100px]">HPR ID</TableHead>
                        <TableHead className="min-w-[90px]">Status</TableHead>
                        <TableHead className="min-w-[100px]">Attendance</TableHead>
                        <TableHead className="min-w-[90px]">This month</TableHead>
                        <TableHead className="min-w-[90px]">OPD seen</TableHead>
                        <TableHead className="min-w-[140px]">Last login</TableHead>
                        <TableHead className="w-[120px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emptyFiltered ? (
                        <TableRow>
                          <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                            No staff match the current filters. Try clearing role or search.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((r) => (
                          <Fragment key={r.id}>
                            <TableRow
                              role="link"
                              tabIndex={0}
                              className={`cursor-pointer transition-colors hover:bg-muted/50 focus:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring/30 ${
                                r.is_active ? "" : "bg-muted/40 text-muted-foreground"
                              }`}
                              onClick={() => goToStaff(r.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  goToStaff(r.id);
                                }
                              }}
                            >
                              <TableCell className="font-medium text-foreground">
                                <div>{r.full_name}</div>
                                {isNurseRole(r) ? (
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {wardAssignmentsToday[r.id] ?? "Not assigned today"}
                                  </div>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-sm">{r.email}</TableCell>
                              <TableCell>{roleLabel(r.role)}</TableCell>
                              <TableCell className="text-sm">{roleLabel(r.sub_role)}</TableCell>
                              <TableCell className="font-mono text-xs">{r.hpr_id ?? "—"}</TableCell>
                              <TableCell>
                                {r.is_active ? (
                                  <span className="inline-flex rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-500/20 dark:text-green-400">
                                    Active
                                  </span>
                                ) : (
                                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                                    Inactive
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <AttendancePctCell pct={r.attendance_pct} />
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground tabular-nums">
                                {r.actions_this_month != null ? r.actions_this_month : "—"}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums text-foreground">
                                {isDoctorRole(r) ? (r.opd_seen != null ? r.opd_seen : "—") : "—"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{formatRelativeLastLogin(r.last_login)}</TableCell>
                              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex flex-wrap justify-end gap-1.5">
                                  {isNurseRole(r) ? (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setWardAssignOpenId((id) => (id === r.id ? null : r.id));
                                        setAssignDate(todayYmd());
                                        setAssignShift("Morning");
                                        setAssignWardId(wardOptions[0]?.id ?? "");
                                      }}
                                    >
                                      Assign to ward
                                    </Button>
                                  ) : null}
                                  <Button variant="outline" size="sm" asChild>
                                    <Link href={`/admin/dashboard/staff-directory/${r.id}`}>View</Link>
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {wardAssignOpenId === r.id && isNurseRole(r) ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={11} className="bg-muted/30 p-4">
                                  <div className="mx-auto max-w-lg space-y-3 rounded-lg border border-border bg-background p-4 shadow-sm">
                                    <p className="text-sm font-semibold text-foreground">Ward assignment</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div className="space-y-1.5">
                                        <Label htmlFor={`ward-date-${r.id}`}>Date</Label>
                                        <Input
                                          id={`ward-date-${r.id}`}
                                          type="date"
                                          value={assignDate}
                                          onChange={(e) => setAssignDate(e.target.value)}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <Label htmlFor={`ward-sel-${r.id}`}>Ward</Label>
                                        <Select value={assignWardId} onValueChange={setAssignWardId}>
                                          <SelectTrigger id={`ward-sel-${r.id}`}>
                                            <SelectValue placeholder="Select ward" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {wardOptions.map((w) => (
                                              <SelectItem key={w.id} value={w.id}>
                                                {w.name}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>
                                    <div className="space-y-1.5">
                                      <span className="text-xs font-medium text-muted-foreground">Shift</span>
                                      <div className="flex flex-wrap gap-1.5">
                                        {(["Morning", "Afternoon", "Night", "General"] as const).map((sh) => (
                                          <button
                                            key={sh}
                                            type="button"
                                            onClick={() => setAssignShift(sh)}
                                            className={cn(
                                              "rounded-full px-3 py-1 text-xs font-semibold transition",
                                              assignShift === sh
                                                ? "bg-blue-600 text-white shadow-sm"
                                                : "bg-muted text-foreground ring-1 ring-border hover:bg-muted/80",
                                            )}
                                          >
                                            {sh}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Button type="button" size="sm" disabled={assignSaving} onClick={() => void saveWardAssignment(r.id)}>
                                        {assignSaving ? "Saving…" : "Save assignment"}
                                      </Button>
                                      <Button type="button" size="sm" variant="outline" onClick={() => setWardAssignOpenId(null)}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                {!emptyAfterLoad && hospitalId ? (
                  <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                    Showing {filtered.length} of {rows.length} staff · click a row or View to open details
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
