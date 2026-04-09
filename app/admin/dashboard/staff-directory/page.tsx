"use client";

import { formatDistanceToNow, isValid, parseISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
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
};

function formatRelativeLastLogin(iso: string | null): string {
  if (!iso) return "Never";
  let d = parseISO(iso);
  if (!isValid(d)) d = new Date(iso);
  if (!isValid(d)) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

function roleLabel(raw: string): string {
  if (!raw || raw === "—") return "—";
  const s = raw.trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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

  const load = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("get_all_staff", { p_hospital_id: hid });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setRows([]);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setRows(
      list.map((r) => ({
        id: String(r.id),
        full_name: String(r.full_name ?? "—"),
        email: String(r.email ?? "—"),
        role: String(r.role ?? "—"),
        sub_role: String(r.sub_role ?? "—"),
        hpr_id: r.hpr_id != null && String(r.hpr_id).trim() ? String(r.hpr_id) : null,
        is_active: Boolean(r.is_active),
        last_login: r.last_login != null ? String(r.last_login) : null,
      })),
    );
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
              <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">get_all_staff</code>.
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
                        <TableHead className="min-w-[140px]">Last login</TableHead>
                        <TableHead className="w-[120px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emptyFiltered ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                            No staff match the current filters. Try clearing role or search.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((r) => (
                          <TableRow
                            key={r.id}
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
                            <TableCell className="font-medium text-foreground">{r.full_name}</TableCell>
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
                            <TableCell className="text-sm text-muted-foreground">{formatRelativeLastLogin(r.last_login)}</TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <Button variant="outline" size="sm" asChild>
                                <Link href={`/admin/dashboard/staff-directory/${r.id}`}>View</Link>
                              </Button>
                            </TableCell>
                          </TableRow>
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
