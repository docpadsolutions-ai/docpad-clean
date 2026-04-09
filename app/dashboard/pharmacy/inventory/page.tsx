"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchHospitalIdFromPractitionerUser } from "../../../lib/authOrg";
import { supabase } from "../../../supabase";
import { InventoryItemModal, type InventoryTableRow } from "./InventoryItemModal";

function matchesSearch(row: InventoryTableRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const parts = [
    row.brand_name,
    row.generic_name,
    row.dosage_form_name,
    row.strength,
    row.manufacturer,
    row.stock_quantity != null ? String(row.stock_quantity) : "",
    row.reorder_level != null ? String(row.reorder_level) : "",
  ].map((s) => (s ?? "").toLowerCase());
  return parts.some((p) => p.includes(t));
}

type InventorySortKey =
  | "brand_name"
  | "generic_name"
  | "dosage_form_name"
  | "strength"
  | "stock_quantity"
  | "reorder_level"
  | "manufacturer";

type SortConfig = { key: InventorySortKey; direction: "asc" | "desc" } | null;

type ColumnFilters = {
  brand_name: string;
  generic_name: string;
  dosage_form_name: string;
  strength: string;
  stock: string;
  reorder_level: string;
  manufacturer: string;
};

const EMPTY_COL_FILTERS: ColumnFilters = {
  brand_name: "",
  generic_name: "",
  dosage_form_name: "",
  strength: "",
  stock: "",
  reorder_level: "",
  manufacturer: "",
};

function getSortComparable(row: InventoryTableRow, key: InventorySortKey): string | number | null {
  if (key === "stock_quantity") {
    const n = row.stock_quantity;
    return n == null || !Number.isFinite(n) ? null : n;
  }
  if (key === "reorder_level") {
    const n = row.reorder_level;
    return n == null || !Number.isFinite(n) ? null : n;
  }
  const v = row[key];
  if (v == null || String(v).trim() === "") return null;
  return String(v).trim();
}

function SortableTh({
  label,
  sortKey,
  sortConfig,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: InventorySortKey;
  sortConfig: SortConfig;
  onSort: (k: InventorySortKey) => void;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600",
        align === "right" && "text-right",
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1",
          align === "right" && "ml-auto flex-row-reverse text-right",
        )}
      >
        <span>{label}</span>
        {sortConfig?.key === sortKey ? (
          <span className="font-normal tabular-nums text-slate-500" aria-hidden>
            {sortConfig.direction === "asc" ? "↑" : "↓"}
          </span>
        ) : null}
      </button>
    </th>
  );
}

export default function PharmacyInventoryPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [rows, setRows] = useState<InventoryTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [colFilters, setColFilters] = useState<ColumnFilters>(EMPTY_COL_FILTERS);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingRow, setEditingRow] = useState<InventoryTableRow | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadRows = useCallback(async (hid: string) => {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from("hospital_inventory")
      .select("*")
      .eq("hospital_id", hid)
      .eq("is_active", true)
      .order("brand_name");

    setLoading(false);
    if (error) {
      setLoadError(error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as InventoryTableRow[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { hospitalId: hid, error } = await fetchHospitalIdFromPractitionerUser();
      if (cancelled) return;
      if (error) {
        setOrgError(error.message);
        setHospitalId(null);
        setLoading(false);
        return;
      }
      if (!hid) {
        setOrgError(
          "No hospital found for your account — ensure a practitioners row exists with user_id matching your login and hospital_id set.",
        );
        setHospitalId(null);
        setLoading(false);
        setRows([]);
        return;
      }
      setOrgError(null);
      setHospitalId(hid);
      await loadRows(hid);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRows]);

  const handleSort = useCallback((key: InventorySortKey) => {
    setSortConfig((prev) => ({
      key,
      direction: prev?.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const searchFiltered = useMemo(() => rows.filter((r) => matchesSearch(r, search)), [rows, search]);

  const columnFiltered = useMemo(() => {
    const b = colFilters.brand_name.trim().toLowerCase();
    const g = colFilters.generic_name.trim().toLowerCase();
    const d = colFilters.dosage_form_name.trim().toLowerCase();
    const st = colFilters.strength.trim().toLowerCase();
    const stQ = colFilters.stock.trim().toLowerCase();
    const ro = colFilters.reorder_level.trim().toLowerCase();
    const m = colFilters.manufacturer.trim().toLowerCase();

    return searchFiltered.filter((r) => {
      if (b && !(r.brand_name ?? "").toLowerCase().includes(b)) return false;
      if (g && !(r.generic_name ?? "").toLowerCase().includes(g)) return false;
      if (d && !(r.dosage_form_name ?? "").toLowerCase().includes(d)) return false;
      if (st && !(r.strength ?? "").toLowerCase().includes(st)) return false;
      if (stQ) {
        const sq = r.stock_quantity == null ? "" : String(r.stock_quantity);
        if (!sq.toLowerCase().includes(stQ)) return false;
      }
      if (ro) {
        const rq = r.reorder_level == null ? "" : String(r.reorder_level);
        if (!rq.toLowerCase().includes(ro)) return false;
      }
      if (m && !(r.manufacturer ?? "").toLowerCase().includes(m)) return false;
      return true;
    });
  }, [searchFiltered, colFilters]);

  const displayRows = useMemo(() => {
    if (!sortConfig) return columnFiltered;
    return [...columnFiltered].sort((a, b) => {
      const aVal = getSortComparable(a, sortConfig.key);
      const bVal = getSortComparable(b, sortConfig.key);
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortConfig.direction === "asc"
        ? String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" })
        : String(bVal).localeCompare(String(aVal), undefined, { sensitivity: "base" });
    });
  }, [columnFiltered, sortConfig]);

  const hasColFilters = useMemo(() => {
    return Object.values(colFilters).some((v) => v.trim() !== "");
  }, [colFilters]);

  const openAdd = useCallback(() => {
    setEditingRow(null);
    setModalMode("add");
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((row: InventoryTableRow) => {
    setEditingRow(row);
    setModalMode("edit");
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingRow(null);
  }, []);

  const deactivate = useCallback(
    async (row: InventoryTableRow) => {
      const label = (row.brand_name ?? row.generic_name ?? "this item").trim();
      if (!window.confirm(`Deactivate "${label}"? It will be hidden from the active inventory list.`)) {
        return;
      }
      setDeletingId(row.id);
      const { error } = await supabase.rpc("deactivate_inventory_item", { p_item_id: row.id });
      setDeletingId(null);
      if (error) {
        window.alert(error.message);
        return;
      }
      if (hospitalId) void loadRows(hospitalId);
    },
    [hospitalId, loadRows],
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Pharmacy</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Inventory</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Active formulary items for your hospital. Search across columns, filter per column, and click headers to
              sort. Add, edit, or deactivate rows.
            </p>
          </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/pharmacy"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard/pharmacy/audit"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Audit
              </Link>
            </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        {orgError ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            {orgError}
          </p>
        ) : null}

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="search"
            placeholder="Search brand or generic name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:flex-1"
            aria-label="Filter by brand or generic name"
          />
          <button
            type="button"
            onClick={openAdd}
            disabled={!hospitalId}
            className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Add item
          </button>
        </div>

        {loadError ? (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {loadError}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr>
                  <SortableTh label="Brand name" sortKey="brand_name" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableTh label="Generic name" sortKey="generic_name" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableTh
                    label="Dosage form"
                    sortKey="dosage_form_name"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                  <SortableTh label="Strength" sortKey="strength" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableTh
                    label="Stock"
                    sortKey="stock_quantity"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableTh
                    label="Reorder level"
                    sortKey="reorder_level"
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableTh label="Manufacturer" sortKey="manufacturer" sortConfig={sortConfig} onSort={handleSort} />
                  <th
                    scope="col"
                    className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Actions
                  </th>
                </tr>
                <tr className="border-b border-slate-200 bg-slate-50/90">
                  <th className="p-1.5 align-top font-normal">
                    <input
                      type="text"
                      value={colFilters.brand_name}
                      onChange={(e) => setColFilters((c) => ({ ...c, brand_name: e.target.value }))}
                      placeholder="Filter…"
                      aria-label="Filter brand name"
                      className="h-8 w-full min-w-[6rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-100"
                    />
                  </th>
                  <th className="p-1.5 align-top font-normal">
                    <input
                      type="text"
                      value={colFilters.generic_name}
                      onChange={(e) => setColFilters((c) => ({ ...c, generic_name: e.target.value }))}
                      placeholder="Filter…"
                      aria-label="Filter generic name"
                      className="h-8 w-full min-w-[6rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-100"
                    />
                  </th>
                  <th className="p-1.5 align-top font-normal">
                    <input
                      type="text"
                      value={colFilters.dosage_form_name}
                      onChange={(e) => setColFilters((c) => ({ ...c, dosage_form_name: e.target.value }))}
                      placeholder="Filter…"
                      aria-label="Filter dosage form"
                      className="h-8 w-full min-w-[5rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-100"
                    />
                  </th>
                  <th className="p-1.5 align-top font-normal">
                    <input
                      type="text"
                      value={colFilters.strength}
                      onChange={(e) => setColFilters((c) => ({ ...c, strength: e.target.value }))}
                      placeholder="Filter…"
                      aria-label="Filter strength"
                      className="h-8 w-full min-w-[4rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-100"
                    />
                  </th>
                  <th className="p-1.5 align-top font-normal">
                    <input
                      type="text"
                      value={colFilters.stock}
                      onChange={(e) => setColFilters((c) => ({ ...c, stock: e.target.value }))}
                      placeholder="Filter…"
                      aria-label="Filter stock"
                      className="h-8 w-full min-w-[3.5rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-100"
                    />
                  </th>
                  <th className="p-1.5 align-top font-normal">
                    <input
                      type="text"
                      value={colFilters.reorder_level}
                      onChange={(e) => setColFilters((c) => ({ ...c, reorder_level: e.target.value }))}
                      placeholder="Filter…"
                      aria-label="Filter reorder level"
                      className="h-8 w-full min-w-[3.5rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-100"
                    />
                  </th>
                  <th className="p-1.5 align-top font-normal">
                    <input
                      type="text"
                      value={colFilters.manufacturer}
                      onChange={(e) => setColFilters((c) => ({ ...c, manufacturer: e.target.value }))}
                      placeholder="Filter…"
                      aria-label="Filter manufacturer"
                      className="h-8 w-full min-w-[5rem] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-100"
                    />
                  </th>
                  <th className="p-1.5 text-right align-top font-normal">
                    <button
                      type="button"
                      disabled={!hasColFilters}
                      onClick={() => setColFilters(EMPTY_COL_FILTERS)}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      Loading inventory…
                    </td>
                  </tr>
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      {rows.length === 0
                        ? "No active items. Add one to get started."
                        : search.trim() === "" && !hasColFilters
                          ? "No rows to show."
                          : "No rows match your search or column filters."}
                    </td>
                  </tr>
                ) : (
                  displayRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                      <td className="px-3 py-2.5 font-medium text-slate-900">{(row.brand_name ?? "—").trim() || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-700">{(row.generic_name ?? "—").trim() || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {(row.dosage_form_name ?? "—").trim() || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 tabular-nums">{(row.strength ?? "—").trim() || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                        {row.stock_quantity ?? 0}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {row.reorder_level ?? "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2.5 text-slate-600" title={row.manufacturer ?? ""}>
                        {(row.manufacturer ?? "—").trim() || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === row.id}
                            onClick={() => void deactivate(row)}
                            className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingId === row.id ? "…" : "Deactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Data: <code className="rounded bg-slate-100 px-1">hospital_inventory</code> where{" "}
          <code className="rounded bg-slate-100 px-1">is_active = true</code> (loaded ordered by brand; table sort/filter
          is client-side). Add uses{" "}
          <code className="rounded bg-slate-100 px-1">add_inventory_item</code>; edit uses{" "}
          <code className="rounded bg-slate-100 px-1">update_inventory_item</code>; deactivate uses{" "}
          <code className="rounded bg-slate-100 px-1">deactivate_inventory_item</code>.
        </p>
      </main>

      <InventoryItemModal
        open={modalOpen}
        mode={modalMode}
        hospitalId={hospitalId}
        row={editingRow}
        onClose={closeModal}
        onSaved={() => {
          if (hospitalId) void loadRows(hospitalId);
        }}
      />
    </div>
  );
}
