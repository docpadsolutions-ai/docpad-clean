"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchHospitalIdFromPractitionerUser } from "../../../lib/authOrg";
import { supabase } from "../../../supabase";

export const TRANSACTION_TYPES = ["restock", "dispense", "return", "adjustment", "expired"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

const PAGE_SIZE = 20;
const EXPORT_BATCH = 1000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

type InventoryEmbed = {
  brand_name: string | null;
  generic_name: string | null;
};

type PractitionerEmbed = {
  full_name: string | null;
};

export type StockAuditRow = {
  id: string;
  created_at: string;
  transaction_type: string;
  quantity: number;
  batch_number: string | null;
  supplier_name: string | null;
  notes: string | null;
  hospital_inventory: InventoryEmbed | InventoryEmbed[] | null;
  practitioners: PractitionerEmbed | PractitionerEmbed[] | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toYmd(d);
}

function defaultEndDate(): string {
  return toYmd(new Date());
}

function dayStartIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function dayEndIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/** e.g. 03 Apr 2026 14:30 (local) */
function formatAuditDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()];
  const y = d.getFullYear();
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${y} ${h}:${min}`;
}

function sanitizeMedSearch(s: string): string {
  return s.replace(/%/g, "").replace(/,/g, "").trim().slice(0, 80);
}

function auditSelectColumns(useInnerInventory: boolean): string {
  const inv = useInnerInventory ? "hospital_inventory!inner" : "hospital_inventory";
  return `
    id,
    created_at,
    transaction_type,
    quantity,
    batch_number,
    supplier_name,
    notes,
    ${inv} ( brand_name, generic_name ),
    practitioners ( full_name )
  `;
}

function displayQuantity(type: string, q: number | null | undefined): string {
  if (q == null || Number.isNaN(q)) return "—";
  if (type === "restock" || type === "return") {
    return q > 0 ? `+${q}` : String(q);
  }
  if (type === "dispense" || type === "expired") {
    if (q < 0) return String(q);
    return `-${Math.abs(q)}`;
  }
  return String(q);
}

function transactionBadgeClass(type: string): string {
  switch (type) {
    case "restock":
      return "bg-emerald-100 text-emerald-900 ring-emerald-600/20";
    case "dispense":
      return "bg-red-100 text-red-900 ring-red-600/20";
    case "return":
      return "bg-sky-100 text-sky-900 ring-sky-600/20";
    case "adjustment":
      return "bg-amber-100 text-amber-950 ring-amber-600/25";
    case "expired":
      return "bg-slate-200 text-slate-800 ring-slate-600/20";
    default:
      return "bg-slate-100 text-slate-800 ring-slate-500/20";
  }
}

function escapeCsvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function triggerCsvDownload(csvBody: string, filename: string) {
  const blob = new Blob(["\uFEFF" + csvBody], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: StockAuditRow[]): string {
  const headers = [
    "ID",
    "Date/time",
    "Transaction type",
    "Brand name",
    "Generic name",
    "Quantity",
    "Batch number",
    "Supplier",
    "Performed by",
    "Notes",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const inv = pickOne(row.hospital_inventory);
    const pr = pickOne(row.practitioners);
    const isRestock = row.transaction_type === "restock";
    const supplier = isRestock ? (row.supplier_name ?? "").trim() : "";
    const dt = formatAuditDate(row.created_at);
    lines.push(
      [
        escapeCsvCell(row.id ?? ""),
        escapeCsvCell(dt === "—" ? "" : dt),
        escapeCsvCell(row.transaction_type ?? ""),
        escapeCsvCell((inv?.brand_name ?? "").trim()),
        escapeCsvCell((inv?.generic_name ?? "").trim()),
        escapeCsvCell(displayQuantity(row.transaction_type, row.quantity)),
        escapeCsvCell((row.batch_number ?? "").trim()),
        escapeCsvCell(supplier),
        escapeCsvCell((pr?.full_name ?? "").trim()),
        escapeCsvCell((row.notes ?? "").trim()),
      ].join(","),
    );
  }
  return lines.join("\n");
}

type AuditFilterArgs = {
  hid: string;
  rangeStart: string;
  rangeEnd: string;
  txType: string;
  medSearch: string;
};

function applyAuditFilters(args: AuditFilterArgs, options: { count: "exact" } | { count?: undefined }) {
  const { hid, rangeStart, rangeEnd, txType, medSearch } = args;
  const startIso = dayStartIso(rangeStart);
  const endIso = dayEndIso(rangeEnd);
  const med = sanitizeMedSearch(medSearch);
  const useInner = med.length > 0;

  let q = supabase
    .from("stock_transactions")
    .select(auditSelectColumns(useInner), options.count ? { count: options.count } : undefined)
    .eq("hospital_id", hid)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: false });

  if (txType !== "all") {
    q = q.eq("transaction_type", txType);
  }
  if (useInner) {
    const pat = `%${med}%`;
    q = q.or(`brand_name.ilike.${pat},generic_name.ilike.${pat}`, { foreignTable: "hospital_inventory" });
  }
  return q;
}

export default function PharmacyAuditPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchMed, setSearchMed] = useState("");

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [rows, setRows] = useState<StockAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const filterArgs = useCallback(
    (): AuditFilterArgs | null =>
      hospitalId
        ? { hid: hospitalId, rangeStart: startDate, rangeEnd: endDate, txType: typeFilter, medSearch: searchMed }
        : null,
    [hospitalId, startDate, endDate, typeFilter, searchMed],
  );

  const runQuery = useCallback(async (args: AuditFilterArgs, pageNum: number) => {
    setLoading(true);
    setLoadError(null);
    const from = (pageNum - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const q = applyAuditFilters(args, { count: "exact" }).range(from, to);
    const { data, error, count } = await q;

    setLoading(false);
    if (error) {
      setLoadError(error.message);
      setRows([]);
      setTotalCount(0);
      return;
    }
    setRows((data ?? []) as unknown as StockAuditRow[]);
    setTotalCount(count ?? 0);
    setPage(pageNum);
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
      await runQuery(
        { hid, rangeStart: defaultStartDate(), rangeEnd: defaultEndDate(), txType: "all", medSearch: "" },
        1,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [runQuery]);

  const handleApplyFilters = useCallback(() => {
    const a = filterArgs();
    if (a) void runQuery(a, 1);
  }, [filterArgs, runQuery]);

  const goToPage = useCallback(
    (p: number) => {
      const a = filterArgs();
      if (!a || p < 1) return;
      const maxPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      const next = Math.min(p, maxPage);
      void runQuery(a, next);
    },
    [filterArgs, runQuery, totalCount],
  );

  const handleExportCsv = useCallback(async () => {
    const a = filterArgs();
    if (!a || totalCount === 0) return;
    setExporting(true);
    setLoadError(null);
    try {
      const all: StockAuditRow[] = [];
      for (let offset = 0; ; offset += EXPORT_BATCH) {
        const { data, error } = await applyAuditFilters(a, {}).range(offset, offset + EXPORT_BATCH - 1);
        if (error) {
          setLoadError(error.message);
          return;
        }
        const batch = (data ?? []) as unknown as StockAuditRow[];
        all.push(...batch);
        if (batch.length < EXPORT_BATCH) break;
      }
      const stamp = toYmd(new Date()).replace(/-/g, "");
      triggerCsvDownload(rowsToCsv(all), `pharmacy-stock-audit-${stamp}.csv`);
    } finally {
      setExporting(false);
    }
  }, [filterArgs, totalCount]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const showingFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, totalCount);

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Pharmacy</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Stock audit</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Transaction history for NABH and reconciliation — restock, dispense, returns, adjustments, expired stock.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/pharmacy"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Dashboard
            </Link>
            <Link
              href="/dashboard/pharmacy/inventory"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Inventory
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        {orgError ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            {orgError}
          </p>
        ) : null}

        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="audit-start">
                  From
                </label>
                <input
                  id="audit-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="audit-end">
                  To
                </label>
                <input
                  id="audit-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="audit-type">
                  Transaction type
                </label>
                <select
                  id="audit-type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full min-w-[160px] rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 sm:w-auto"
                >
                  <option value="all">All</option>
                  {TRANSACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="audit-search">
                  Search medication
                </label>
                <input
                  id="audit-search"
                  type="search"
                  value={searchMed}
                  onChange={(e) => setSearchMed(e.target.value)}
                  placeholder="Brand or generic name…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!hospitalId}
                  onClick={() => handleApplyFilters()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Apply filters
                </button>
                <button
                  type="button"
                  disabled={totalCount === 0 || exporting}
                  onClick={() => void handleExportCsv()}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {exporting ? "Exporting…" : "Export CSV"}
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Default range: last 30 days. {PAGE_SIZE} rows per page. Export CSV downloads all rows matching the current
            filters (date, type, medication search).
          </p>
        </div>

        {loadError ? (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {loadError}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-3">ID</th>
                  <th className="px-3 py-3">Date / time</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Medication</th>
                  <th className="px-3 py-3 text-right tabular-nums">Qty</th>
                  <th className="px-3 py-3">Batch</th>
                  <th className="px-3 py-3">Supplier</th>
                  <th className="px-3 py-3">Performed by</th>
                  <th className="px-3 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      No transactions in this range. Restocks are logged automatically; other types can be added as
                      dispensing and adjustments are wired.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const inv = pickOne(row.hospital_inventory);
                    const pr = pickOne(row.practitioners);
                    const brand = (inv?.brand_name ?? "—").trim() || "—";
                    const generic = (inv?.generic_name ?? "").trim();
                    const medLabel = generic ? `${brand} (${generic})` : brand;
                    const isRestock = row.transaction_type === "restock";
                    return (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                        <td className="max-w-[100px] truncate px-3 py-2.5 font-mono text-[11px] text-slate-600" title={row.id}>
                          {row.id}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                          {formatAuditDate(row.created_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${transactionBadgeClass(row.transaction_type)}`}
                          >
                            {row.transaction_type}
                          </span>
                        </td>
                        <td className="max-w-[220px] px-3 py-2.5 text-slate-900" title={medLabel}>
                          <span className="font-medium">{brand}</span>
                          {generic ? <span className="block truncate text-xs text-slate-500">{generic}</span> : null}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-900">
                          {displayQuantity(row.transaction_type, row.quantity)}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-2.5 text-slate-600" title={row.batch_number ?? ""}>
                          {(row.batch_number ?? "—").trim() || "—"}
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-2.5 text-slate-600" title={row.supplier_name ?? ""}>
                          {isRestock ? (row.supplier_name ?? "—").trim() || "—" : "—"}
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-2.5 text-slate-700" title={pr?.full_name ?? ""}>
                          {(pr?.full_name ?? "—").trim() || "—"}
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-2.5 text-xs text-slate-600" title={row.notes ?? ""}>
                          {(row.notes ?? "—").trim() || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {!loading && totalCount > 0 ? (
            <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-600">
                Showing <span className="font-semibold tabular-nums text-slate-900">{showingFrom}</span>–
                <span className="font-semibold tabular-nums text-slate-900">{showingTo}</span> of{" "}
                <span className="font-semibold tabular-nums text-slate-900">{totalCount}</span>
                <span className="text-slate-500"> · Page </span>
                <span className="font-semibold tabular-nums text-slate-900">{page}</span>
                <span className="text-slate-500"> of </span>
                <span className="font-semibold tabular-nums text-slate-900">{totalPages}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Source: <code className="rounded bg-slate-100 px-1">stock_transactions</code> (includes{" "}
          <code className="rounded bg-slate-100 px-1">id</code>) with{" "}
          <code className="rounded bg-slate-100 px-1">hospital_inventory</code> and{" "}
          <code className="rounded bg-slate-100 px-1">practitioners</code>. Apply filters to refresh.
        </p>
      </main>
    </div>
  );
}
