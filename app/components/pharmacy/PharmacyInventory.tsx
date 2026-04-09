"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAuthOrgId, fetchHospitalIdFromPractitionerUser } from "@/app/lib/authOrg";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DrugTableRow, type DrugRow } from "./DrugTableRow";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 500;

export type PharmacyInventoryRole = "admin" | "viewer";

async function resolvePharmacyHospitalId(): Promise<{ hospitalId: string | null; error: string | null }> {
  const { orgId, error: orgErr } = await fetchAuthOrgId();
  if (orgErr) return { hospitalId: null, error: orgErr.message };
  const fromOrg = orgId?.trim() ?? "";
  if (fromOrg) return { hospitalId: fromOrg, error: null };

  const { hospitalId: hid, error: userErr } = await fetchHospitalIdFromPractitionerUser();
  if (userErr) return { hospitalId: null, error: userErr.message };
  const id = hid?.trim() ?? "";
  return { hospitalId: id || null, error: null };
}

function rowToDrugRow(r: Record<string, unknown>): DrugRow {
  const formRaw = r.dosage_form_name ?? r.form;
  const mrp = r.mrp;
  const mrpNum = mrp == null ? null : typeof mrp === "number" ? mrp : Number(mrp);
  const rl = r.reorder_level ?? r.min_stock;
  const minStock = typeof rl === "number" ? rl : rl != null ? Number(rl) : 0;
  return {
    id: String(r.id),
    generic_name: String(r.generic_name ?? ""),
    brand_name: String(r.brand_name ?? ""),
    form: formRaw != null && String(formRaw).trim() ? String(formRaw).trim() : null,
    strength: r.strength != null && String(r.strength).trim() ? String(r.strength).trim() : null,
    mrp: mrpNum != null && Number.isFinite(mrpNum) ? mrpNum : null,
    min_stock: Number.isFinite(minStock) ? minStock : 0,
    is_active: Boolean(r.is_active ?? true),
  };
}

type DrugSortKey = "generic_name" | "brand_name" | "form" | "strength" | "mrp" | "min_stock" | "status";
type SortConfig = { key: DrugSortKey; direction: "asc" | "desc" } | null;

function getSortComparable(d: DrugRow, key: DrugSortKey): string | number | boolean | null {
  if (key === "status") return d.is_active;
  const v = d[key];
  if (v === null || v === undefined) return null;
  return v as string | number;
}

type ColumnFiltersState = {
  generic_name: string;
  brand_name: string;
  form: string;
  strength: string;
  mrp: string;
  min_stock: string;
  status: "all" | "active" | "inactive";
};

const EMPTY_COLUMN_FILTERS: ColumnFiltersState = {
  generic_name: "",
  brand_name: "",
  form: "",
  strength: "",
  mrp: "",
  min_stock: "",
  status: "all",
};

function SortableHead({
  label,
  sortKey,
  sortConfig,
  onSort,
  className,
}: {
  label: string;
  sortKey: DrugSortKey;
  sortConfig: SortConfig;
  onSort: (key: DrugSortKey) => void;
  className?: string;
}) {
  return (
    <TableHead className={cn("p-0", className)}>
      <button
        type="button"
        className={cn(
          "flex w-full min-h-10 items-center gap-1 px-2 py-2 text-left text-sm font-medium text-foreground",
          "hover:bg-muted/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
        onClick={() => onSort(sortKey)}
      >
        <span className="uppercase tracking-wide">{label}</span>
        {sortConfig?.key === sortKey ? (
          <span className="text-muted-foreground tabular-nums" aria-hidden>
            {sortConfig.direction === "asc" ? "↑" : "↓"}
          </span>
        ) : null}
      </button>
    </TableHead>
  );
}

export function PharmacyInventory({
  role,
  variant = "standalone",
}: {
  role: PharmacyInventoryRole;
  variant?: "standalone" | "embedded";
}) {
  const readOnly = role === "viewer";

  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [page, setPage] = useState(1);

  const [drugs, setDrugs] = useState<DrugRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [genericName, setGenericName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [form, setForm] = useState("");
  const [strength, setStrength] = useState("");
  const [mrp, setMrp] = useState("");
  const [minStock, setMinStock] = useState("10");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [colFilters, setColFilters] = useState<ColumnFiltersState>(EMPTY_COLUMN_FILTERS);

  const handleSort = useCallback((key: DrugSortKey) => {
    setSortConfig((prev) => ({
      key,
      direction: prev?.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const searchFilteredDrugs = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return drugs;
    return drugs.filter((d) => {
      const hay = `${d.generic_name} ${d.brand_name} ${d.form ?? ""} ${d.strength ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [drugs, debouncedSearch]);

  const filteredDrugs = useMemo(() => {
    const g = colFilters.generic_name.trim().toLowerCase();
    const b = colFilters.brand_name.trim().toLowerCase();
    const f = colFilters.form.trim().toLowerCase();
    const st = colFilters.strength.trim().toLowerCase();
    const mrpQ = colFilters.mrp.trim().toLowerCase();
    const minQ = colFilters.min_stock.trim().toLowerCase();

    return searchFilteredDrugs.filter((d) => {
      if (g && !d.generic_name.toLowerCase().includes(g)) return false;
      if (b && !d.brand_name.toLowerCase().includes(b)) return false;
      if (f && !(d.form ?? "").toLowerCase().includes(f)) return false;
      if (st && !(d.strength ?? "").toLowerCase().includes(st)) return false;
      if (mrpQ) {
        const m = d.mrp == null ? "" : String(d.mrp);
        if (!m.toLowerCase().includes(mrpQ)) return false;
      }
      if (minQ) {
        const m = String(d.min_stock);
        if (!m.includes(minQ)) return false;
      }
      if (colFilters.status === "active" && !d.is_active) return false;
      if (colFilters.status === "inactive" && d.is_active) return false;
      return true;
    });
  }, [searchFilteredDrugs, colFilters]);

  const sortedDrugs = useMemo(() => {
    if (!sortConfig) return filteredDrugs;

    return [...filteredDrugs].sort((a, b) => {
      const aVal = getSortComparable(a, sortConfig.key);
      const bVal = getSortComparable(b, sortConfig.key);

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      if (typeof aVal === "boolean" && typeof bVal === "boolean") {
        const na = aVal ? 1 : 0;
        const nb = bVal ? 1 : 0;
        return sortConfig.direction === "asc" ? na - nb : nb - na;
      }

      return sortConfig.direction === "asc"
        ? String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" })
        : String(bVal).localeCompare(String(aVal), undefined, { sensitivity: "base" });
    });
  }, [filteredDrugs, sortConfig]);

  const pagedDrugs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedDrugs.slice(start, start + PAGE_SIZE);
  }, [sortedDrugs, page]);

  const totalPages = Math.max(1, Math.ceil(sortedDrugs.length / PAGE_SIZE));

  const hasActiveColumnFilters = useMemo(() => {
    return (
      colFilters.generic_name.trim() !== "" ||
      colFilters.brand_name.trim() !== "" ||
      colFilters.form.trim() !== "" ||
      colFilters.strength.trim() !== "" ||
      colFilters.mrp.trim() !== "" ||
      colFilters.min_stock.trim() !== "" ||
      colFilters.status !== "all"
    );
  }, [colFilters]);

  const load = useCallback(async (hid: string) => {
    const mySeq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("hospital_inventory")
        .select("*")
        .eq("hospital_id", hid)
        .order("generic_name", { ascending: true, nullsFirst: false });

      if (mySeq !== loadSeqRef.current) return;

      if (qErr) {
        setError(qErr.message);
        setDrugs([]);
        return;
      }

      const next = (data ?? []).map((row) => rowToDrugRow(row as Record<string, unknown>));
      setDrugs(next);
      setError(null);
    } finally {
      if (mySeq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid, error: msg } = await resolvePharmacyHospitalId();
      if (msg) {
        setError(msg);
        setLoading(false);
        return;
      }
      if (!hid) {
        setError("No hospital context — cannot load data.");
        setLoading(false);
        return;
      }
      setHospitalId(hid);
    })();
  }, []);

  useEffect(() => {
    if (!hospitalId) return;
    void load(hospitalId);
  }, [hospitalId, load]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    colFilters.generic_name,
    colFilters.brand_name,
    colFilters.form,
    colFilters.strength,
    colFilters.mrp,
    colFilters.min_stock,
    colFilters.status,
  ]);

  const openModal = () => {
    setFormError(null);
    setGenericName("");
    setBrandName("");
    setForm("");
    setStrength("");
    setMrp("");
    setMinStock("10");
    setModalOpen(true);
  };

  const submitCreate = async () => {
    if (!hospitalId || readOnly) return;
    setFormError(null);
    if (!genericName.trim()) {
      setFormError("Generic name is required.");
      return;
    }
    if (!brandName.trim()) {
      setFormError("Brand name is required.");
      return;
    }
    const ms = Number(minStock);
    if (!Number.isFinite(ms) || ms < 0) {
      setFormError("Min stock must be a non-negative number.");
      return;
    }
    let mrpVal: number | null = null;
    if (mrp.trim() !== "") {
      const n = Number(mrp);
      if (!Number.isFinite(n) || n < 0) {
        setFormError("MRP must be a non-negative number or empty.");
        return;
      }
      mrpVal = n;
    }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc("create_drug", {
      p_hospital_id: hospitalId,
      p_generic_name: genericName.trim(),
      p_brand_name: brandName.trim(),
      p_form: form.trim() || null,
      p_strength: strength.trim() || null,
      p_mrp: mrpVal,
      p_min_stock: ms,
    });
    setSaving(false);
    if (rpcErr) {
      setFormError(rpcErr.message);
      return;
    }
    setModalOpen(false);
    setPage(1);
    await load(hospitalId);
  };

  const outerClass =
    variant === "embedded" ? "space-y-4" : "min-h-screen bg-background px-4 py-8 text-foreground sm:px-6";

  return (
    <div className={outerClass}>
      <div className={variant === "embedded" ? "space-y-4" : "mx-auto max-w-6xl space-y-6"}>
        {variant === "standalone" ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                {role === "admin" ? "Administration" : "Pharmacy"}
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                {role === "admin" ? "Pharmacy drug master" : "Hospital formulary"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Same <code className="rounded bg-muted px-1 text-xs">hospital_inventory</code> as dashboard inventory
                ({PAGE_SIZE} rows per page client-side, full list loaded).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {role === "admin" ? (
                <>
                  <Button variant="outline" asChild>
                    <Link href="/dashboard/admin">← Admin home</Link>
                  </Button>
                  <Button type="button" onClick={openModal}>
                    Add drug
                  </Button>
                </>
              ) : (
                <Button variant="outline" asChild>
                  <Link href="/dashboard/pharmacy/inventory">Stock management (inventory)</Link>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Formulary</h2>
              <p className="text-xs text-slate-500">
                Full hospital_inventory list (read-only). Manage batches and stock on the inventory page.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/pharmacy/inventory">Inventory</Link>
            </Button>
          </div>
        )}

        {role === "admin" && variant === "standalone" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Purchase orders</CardTitle>
                <CardDescription className="text-xs">Vendor PO workflow (coming soon).</CardDescription>
              </CardHeader>
            </Card>
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Vendors</CardTitle>
                <CardDescription className="text-xs">
                  <Link href="/admin/pharmacy/vendors" className="text-blue-600 hover:underline">
                    Manage vendors →
                  </Link>
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Stock management</CardTitle>
                <CardDescription className="text-xs">Restock, batches, and adjustments.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/dashboard/pharmacy/inventory">Open inventory</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Card className="border-border shadow-sm">
          <CardHeader className="space-y-4 border-b border-border pb-4">
            <div>
              <CardTitle className="text-lg">Drugs</CardTitle>
              <CardDescription>
                {drugs.length} formulary line{drugs.length === 1 ? "" : "s"} loaded · search & column filters are
                client-side.
              </CardDescription>
            </div>
            <div className="max-w-md space-y-2">
              <Label htmlFor="drug-search">Search</Label>
              <Input
                id="drug-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Generic, brand, form, strength…"
                autoComplete="off"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-0 pt-0">
            {error ? (
              <p className="px-6 py-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            {loading && drugs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-12">
                <div
                  className="h-9 w-9 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">Loading drugs…</p>
              </div>
            ) : null}
            {(!loading || drugs.length > 0) && !error ? (
              <>
                <div className="relative overflow-x-auto">
                  {loading && drugs.length > 0 ? (
                    <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/60 pt-8">
                      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
                        <div
                          className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                          aria-hidden
                        />
                        <p className="text-xs text-muted-foreground">Refreshing…</p>
                      </div>
                    </div>
                  ) : null}
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <SortableHead
                          label="Generic"
                          sortKey="generic_name"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          className="min-w-[8rem]"
                        />
                        <SortableHead
                          label="Brand"
                          sortKey="brand_name"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          className="min-w-[8rem]"
                        />
                        <SortableHead
                          label="Form"
                          sortKey="form"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          className="min-w-[6rem]"
                        />
                        <SortableHead
                          label="Strength"
                          sortKey="strength"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          className="min-w-[6rem]"
                        />
                        <SortableHead
                          label="MRP"
                          sortKey="mrp"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          className="min-w-[5rem]"
                        />
                        <SortableHead
                          label="Min stock"
                          sortKey="min_stock"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          className="min-w-[5rem]"
                        />
                        <SortableHead
                          label="Status"
                          sortKey="status"
                          sortConfig={sortConfig}
                          onSort={handleSort}
                          className="min-w-[5rem]"
                        />
                        <TableHead className="w-[9rem] px-2 py-2 text-right text-sm font-medium">Actions</TableHead>
                      </TableRow>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="min-w-[8rem] p-1 align-top font-normal">
                          <Input
                            className="h-8 text-xs"
                            value={colFilters.generic_name}
                            onChange={(e) => setColFilters((c) => ({ ...c, generic_name: e.target.value }))}
                            placeholder="Filter…"
                            aria-label="Filter generic"
                          />
                        </TableHead>
                        <TableHead className="min-w-[8rem] p-1 align-top font-normal">
                          <Input
                            className="h-8 text-xs"
                            value={colFilters.brand_name}
                            onChange={(e) => setColFilters((c) => ({ ...c, brand_name: e.target.value }))}
                            placeholder="Filter…"
                            aria-label="Filter brand"
                          />
                        </TableHead>
                        <TableHead className="min-w-[6rem] p-1 align-top font-normal">
                          <Input
                            className="h-8 text-xs"
                            value={colFilters.form}
                            onChange={(e) => setColFilters((c) => ({ ...c, form: e.target.value }))}
                            placeholder="Filter…"
                            aria-label="Filter form"
                          />
                        </TableHead>
                        <TableHead className="min-w-[6rem] p-1 align-top font-normal">
                          <Input
                            className="h-8 text-xs"
                            value={colFilters.strength}
                            onChange={(e) => setColFilters((c) => ({ ...c, strength: e.target.value }))}
                            placeholder="Filter…"
                            aria-label="Filter strength"
                          />
                        </TableHead>
                        <TableHead className="min-w-[5rem] p-1 align-top font-normal">
                          <Input
                            className="h-8 text-xs"
                            value={colFilters.mrp}
                            onChange={(e) => setColFilters((c) => ({ ...c, mrp: e.target.value }))}
                            placeholder="Filter…"
                            aria-label="Filter MRP"
                          />
                        </TableHead>
                        <TableHead className="min-w-[5rem] p-1 align-top font-normal">
                          <Input
                            className="h-8 text-xs"
                            value={colFilters.min_stock}
                            onChange={(e) => setColFilters((c) => ({ ...c, min_stock: e.target.value }))}
                            placeholder="Filter…"
                            aria-label="Filter min stock"
                          />
                        </TableHead>
                        <TableHead className="min-w-[5rem] p-1 align-top font-normal">
                          <Select
                            value={colFilters.status}
                            onValueChange={(v) =>
                              setColFilters((c) => ({
                                ...c,
                                status: v as ColumnFiltersState["status"],
                              }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs" aria-label="Filter status">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableHead>
                        <TableHead className="w-[9rem] p-1 align-top text-right font-normal">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            disabled={!hasActiveColumnFilters}
                            onClick={() => setColFilters(EMPTY_COLUMN_FILTERS)}
                          >
                            Clear filters
                          </Button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {drugs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                            No formulary lines. {readOnly ? "" : "Add a drug to get started."}
                          </TableCell>
                        </TableRow>
                      ) : sortedDrugs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                            No drugs match filters. Clear filters or broaden criteria.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedDrugs.map((drug) => (
                          <DrugTableRow key={drug.id} drug={drug} readOnly={readOnly} />
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages} · Showing {pagedDrugs.length} of {sortedDrugs.length} filtered ·{" "}
                    {drugs.length} in formulary
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {modalOpen && !readOnly ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="drug-modal-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 text-card-foreground shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="drug-modal-title" className="text-lg font-semibold text-foreground">
              Add drug
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Creates a formulary line with zero on-hand stock.</p>
            {formError ? (
              <p className="mt-4 text-sm text-red-600" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="mt-6 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="dm-generic">Generic name *</Label>
                <Input id="dm-generic" value={genericName} onChange={(e) => setGenericName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dm-brand">Brand name *</Label>
                <Input id="dm-brand" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dm-form">Form</Label>
                <Input id="dm-form" value={form} onChange={(e) => setForm(e.target.value)} placeholder="e.g. Tablet" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dm-strength">Strength</Label>
                <Input
                  id="dm-strength"
                  value={strength}
                  onChange={(e) => setStrength(e.target.value)}
                  placeholder="e.g. 500 mg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dm-mrp">MRP (INR)</Label>
                <Input
                  id="dm-mrp"
                  type="number"
                  min={0}
                  step={0.01}
                  value={mrp}
                  onChange={(e) => setMrp(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dm-min">Min stock (reorder level) *</Label>
                <Input id="dm-min" type="number" min={0} step={1} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
              </div>
            </div>
            <div className="mt-8 flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitCreate()} disabled={saving}>
                {saving ? "Saving…" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
