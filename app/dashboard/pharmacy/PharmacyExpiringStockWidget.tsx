"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../supabase";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type ExpiringStockRow = {
  hospital_id: string;
  inventory_item_id: string;
  /** hospital_inventory_restock.id — required for mark_expired_stock */
  restock_line_id: string;
  brand_name: string | null;
  generic_name: string | null;
  batch_number: string | null;
  expiry_date: string;
  days_left: number;
  quantity: number;
};

function formatExpiryDate(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return isoOrDate;
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()];
  const y = d.getFullYear();
  return `${day} ${mon} ${y}`;
}

function daysLeftClass(days: number): string {
  if (days <= 7) return "font-bold text-red-700";
  if (days <= 30) return "font-semibold text-amber-800";
  return "text-slate-700";
}

type Props = {
  hospitalId: string | null;
  criticalCount: number;
  warningCount: number;
  countsLoading: boolean;
  countsError: string | null;
  onMarkedExpired: () => void;
};

export function PharmacyExpiringStockWidget({
  hospitalId,
  criticalCount,
  warningCount,
  countsLoading,
  countsError,
  onMarkedExpired,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<ExpiringStockRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadList = useCallback(async (hid: string) => {
    setListLoading(true);
    setListError(null);
    const { data, error } = await supabase
      .from("pharmacy_expiring_stock")
      .select("*")
      .eq("hospital_id", hid)
      .order("expiry_date", { ascending: true });

    setListLoading(false);
    if (error) {
      setListError(error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as ExpiringStockRow[]);
  }, []);

  useEffect(() => {
    if (!expanded || !hospitalId?.trim()) return;
    void loadList(hospitalId.trim());
  }, [expanded, hospitalId, loadList]);

  const handleMarkExpired = useCallback(
    async (restockLineId: string) => {
      setBusyId(restockLineId);
      const { error } = await supabase.rpc("mark_expired_stock", { p_restock_line_id: restockLineId });
      setBusyId(null);
      if (error) {
        window.alert(error.message);
        return;
      }
      if (hospitalId?.trim()) void loadList(hospitalId.trim());
      onMarkedExpired();
    },
    [hospitalId, loadList, onMarkedExpired],
  );

  const total = criticalCount + warningCount;

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:bg-slate-50"
        aria-expanded={expanded}
      >
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Expiring stock</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Batches expiring within 30 days · tap to {expanded ? "collapse" : "expand"}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {countsLoading ? (
            <span className="text-xs text-slate-400">…</span>
          ) : countsError ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">!</span>
          ) : (
            <>
              <span
                className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold tabular-nums text-white shadow-sm"
                title="Critical: expires in 7 days or less"
              >
                {criticalCount}
              </span>
              <span
                className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold tabular-nums text-amber-950 shadow-sm ring-1 ring-amber-500/30"
                title="Warning: expires in 8–30 days"
              >
                {warningCount}
              </span>
            </>
          )}
          <span className="text-slate-400" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
        </div>
      </button>

      {countsError ? (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          {countsError}
          <p className="mt-1 text-[11px] text-amber-800">
            Deploy <code className="rounded bg-amber-100 px-1">get_expiring_stock_counts</code> and view{" "}
            <code className="rounded bg-amber-100 px-1">pharmacy_expiring_stock</code>.
          </p>
        </div>
      ) : null}

      {!expanded ? (
        <p className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
          {total === 0 && !countsLoading
            ? "No batches expiring in the next 30 days."
            : `${total} batch line${total === 1 ? "" : "s"} need attention.`}
        </p>
      ) : null}

      {expanded ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {listLoading ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Loading pharmacy_expiring_stock…</p>
          ) : listError ? (
            <p className="px-3 py-4 text-sm text-red-600" role="alert">
              {listError}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-emerald-800">
              No expiring batches in range — restock with expiry dates to see rows here.
            </p>
          ) : (
            <div className="max-h-[min(48vh,420px)] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-3 py-2">Brand</th>
                    <th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2">Expiry</th>
                    <th className="px-3 py-2 text-right tabular-nums">Days left</th>
                    <th className="px-3 py-2 text-right tabular-nums">Qty</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.restock_line_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{(row.brand_name ?? "—").trim() || "—"}</p>
                        {(row.generic_name ?? "").trim() ? (
                          <p className="truncate text-xs text-slate-500">{(row.generic_name ?? "").trim()}</p>
                        ) : null}
                      </td>
                      <td className="max-w-[100px] truncate px-3 py-2 text-slate-600" title={row.batch_number ?? ""}>
                        {(row.batch_number ?? "—").trim() || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">
                        {formatExpiryDate(row.expiry_date)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${daysLeftClass(row.days_left)}`}>
                        {row.days_left}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{row.quantity}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={busyId === row.restock_line_id}
                          onClick={() => void handleMarkExpired(row.restock_line_id)}
                          className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {busyId === row.restock_line_id ? "…" : "Mark expired"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
