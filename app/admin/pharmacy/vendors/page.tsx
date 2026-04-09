"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditVendorModal } from "@/components/admin/EditVendorModal";
import { fetchAuthOrgId } from "../../../lib/authOrg";
import { Button } from "../../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { useSupabase } from "../hooks/useSupabase";

type VendorRow = {
  id: string;
  vendor_name: string;
  contact_person: string | null;
  phone: string;
  drug_license_no: string;
  is_active: boolean;
};

type StatusFilter = "all" | "active" | "inactive";

/** PostgREST: no matching RPC overload (often HTTP 404 on /rpc/get_vendors). */
function isRpcSignatureMismatch(
  err: { code?: string; message?: string; details?: string } | null,
): boolean {
  if (!err) return false;
  if (err.code === "PGRST202" || err.code === "PGRST203") return true;
  const m = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  return (
    m.includes("could not find the function") ||
    m.includes("no matches were found in the schema cache") ||
    m.includes("not found") ||
    m.includes(" 404") ||
    m.includes("404 ")
  );
}

function filterRowsByStatus(rows: VendorRow[], status: StatusFilter): VendorRow[] {
  if (status === "all") return rows;
  if (status === "active") return rows.filter((r) => r.is_active);
  return rows.filter((r) => !r.is_active);
}

/** DB default for pharmacy_vendors.is_active is true; older RPCs may omit the column. */
function parseIsActive(raw: unknown): boolean {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (["false", "f", "0", "no", "n"].includes(s)) return false;
    if (["true", "t", "1", "yes", "y"].includes(s)) return true;
  }
  return true;
}

function parseVendorRow(o: Record<string, unknown>): VendorRow {
  const rawId = o.id ?? o.vendor_id;
  let id = rawId != null && rawId !== "" ? String(rawId) : "";
  if (id === "undefined" || id === "null") id = "";

  return {
    id,
    vendor_name: String(o.vendor_name ?? ""),
    contact_person: o.contact_person != null ? String(o.contact_person) : null,
    phone: String(o.phone ?? ""),
    drug_license_no: String(o.drug_license_no ?? ""),
    is_active: parseIsActive(o.is_active),
  };
}

/** PostgREST usually returns an array; some clients/versions may return one row as a single object. */
function parseVendorRows(raw: unknown): VendorRow[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((r) => parseVendorRow(r as Record<string, unknown>));
  if (typeof raw === "object" && raw !== null && "id" in raw) {
    return [parseVendorRow(raw as Record<string, unknown>)];
  }
  return [];
}

export default function PharmacyVendorsPage() {
  const supabase = useSupabase();
  const vendorFetchGen = useRef(0);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [editVendorId, setEditVendorId] = useState<string | null>(null);

  /** Drop stale RPC results when the status filter changes mid-flight. */
  const fetchVendorsList = useCallback(
    async (hid: string) => {
      const gen = ++vendorFetchGen.current;
      setLoading(true);
      setLoadError(null);

      const primary = await supabase.rpc("get_vendors", {
        p_hospital_id: hid,
        p_status: statusFilter,
      });
      if (gen !== vendorFetchGen.current) return;

      if (!primary.error) {
        setRows(parseVendorRows(primary.data));
        setLoading(false);
        return;
      }

      if (isRpcSignatureMismatch(primary.error)) {
        const legacyOneArg = await supabase.rpc("get_vendors", { p_hospital_id: hid });
        if (gen !== vendorFetchGen.current) return;

        if (!legacyOneArg.error) {
          setRows(filterRowsByStatus(parseVendorRows(legacyOneArg.data), statusFilter));
          setLoading(false);
          return;
        }

        if (isRpcSignatureMismatch(legacyOneArg.error)) {
          const authScoped =
            statusFilter === "all"
              ? await supabase.rpc("get_vendors")
              : await supabase.rpc("get_vendors", { p_status: statusFilter });
          if (gen !== vendorFetchGen.current) return;

          if (!authScoped.error) {
            setRows(parseVendorRows(authScoped.data));
            setLoading(false);
            return;
          }
          setLoadError(authScoped.error.message);
          setRows([]);
          setLoading(false);
          return;
        }

        setLoadError(legacyOneArg.error.message);
        setRows([]);
        setLoading(false);
        return;
      }

      setLoadError(primary.error.message);
      setRows([]);
      setLoading(false);
    },
    [statusFilter, supabase],
  );

  const load = useCallback(() => {
    if (hospitalId) void fetchVendorsList(hospitalId);
  }, [hospitalId, fetchVendorsList]);

  /** Org context once on mount (does not re-run when filter changes). */
  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError(null);

      const { orgId, error } = await fetchAuthOrgId();

      if (error) {
        setOrgError(error.message);
        setHospitalId(null);
        setRows([]);
        setLoading(false);
        return;
      }

      const id = orgId?.trim() ?? "";
      if (!id) {
        setOrgError("No hospital context — cannot load vendors.");
        setHospitalId(null);
        setRows([]);
        setLoading(false);
        return;
      }

      setOrgError(null);
      setHospitalId(id);
    })();
  }, []);

  /** Fetch list when hospital + filter are known; filter changes no longer re-run auth or race the previous RPC. */
  useEffect(() => {
    if (!hospitalId) return;
    void fetchVendorsList(hospitalId);
  }, [hospitalId, fetchVendorsList]);

  /** After successful create on /add, force one extra list fetch. */
  useEffect(() => {
    if (!hospitalId || typeof window === "undefined") return;
    if (sessionStorage.getItem("docpad_refetch_vendors") !== "1") return;
    sessionStorage.removeItem("docpad_refetch_vendors");
    void fetchVendorsList(hospitalId);
  }, [hospitalId, fetchVendorsList]);

  const deactivate = async (row: VendorRow) => {
    if (!row.is_active) return;
    const label = row.vendor_name.trim() || "this vendor";
    if (!window.confirm(`Deactivate "${label}"? They will show as inactive.`)) return;
    setDeactivatingId(row.id);
    const { error } = await supabase.rpc("deactivate_vendor", { p_vendor_id: row.id });
    setDeactivatingId(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    void load();
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pharmacy vendors</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage distributors linked to your hospital.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[140px]" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Button asChild>
              <Link href="/admin/pharmacy/vendors/add">Add vendor</Link>
            </Button>
          </div>
        </div>

        {orgError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {orgError}
          </p>
        ) : null}

        {loadError ? (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Vendor name</TableHead>
                  <TableHead>Contact person</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Drug license</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      Loading vendors…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      {statusFilter === "all"
                        ? "No vendors yet. Add one to get started."
                        : "No vendors match this filter."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row, rowIndex) => (
                    <TableRow
                      key={
                        row.id
                          ? row.id
                          : `vendor-${rowIndex}-${row.phone}-${row.drug_license_no}-${row.vendor_name}`
                      }
                      className="border-border"
                    >
                      <TableCell className="font-medium">{row.vendor_name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.contact_person?.trim() || "—"}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{row.phone || "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{row.drug_license_no || "—"}</TableCell>
                      <TableCell>
                        {row.is_active ? (
                          <span className="inline-flex rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-500/20 dark:text-green-400">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                            Inactive
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => setEditVendorId(row.id)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10"
                            disabled={!row.is_active || deactivatingId === row.id}
                            onClick={() => void deactivate(row)}
                          >
                            {deactivatingId === row.id ? "…" : "Deactivate"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <Button variant="outline" asChild>
          <Link href="/admin/pharmacy">← Pharmacy</Link>
        </Button>

        <EditVendorModal
          open={editVendorId != null}
          onOpenChange={(next) => {
            if (!next) setEditVendorId(null);
          }}
          vendorId={editVendorId}
          hospitalId={hospitalId}
          supabase={supabase}
          onSaved={() => void load()}
        />
      </div>
    </div>
  );
}
