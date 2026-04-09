"use client";

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useMemo } from "react";
import type { OutstandingInvoiceRow } from "@/hooks/useBillingAnalytics";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

function rowTone(days: number | null): string {
  if (days == null || days <= 0) return "";
  if (days > 30) return "bg-red-50/80 dark:bg-red-950/25";
  if (days > 7) return "bg-amber-50/80 dark:bg-amber-950/20";
  return "";
}

export function OutstandingInvoicesTable({
  rows,
  loading,
  error,
}: {
  rows: OutstandingInvoiceRow[];
  loading: boolean;
  error: string | null;
}) {
  const columns = useMemo<ColumnDef<OutstandingInvoiceRow>[]>(
    () => [
      {
        accessorKey: "invoice_number",
        header: "Invoice",
        cell: ({ getValue }) => <span className="font-medium text-slate-900 dark:text-slate-100">{String(getValue() ?? "—")}</span>,
      },
      {
        accessorKey: "patient_full_name",
        header: "Patient",
        cell: ({ getValue }) => <span className="text-slate-700 dark:text-slate-300">{String(getValue() ?? "—")}</span>,
      },
      {
        accessorKey: "total_gross",
        header: () => <span className="text-right tabular-nums">Gross</span>,
        cell: ({ getValue }) => (
          <div className="text-right tabular-nums text-slate-800 dark:text-slate-200">{formatInr(n(getValue()))}</div>
        ),
      },
      {
        accessorKey: "balance_due",
        header: () => <span className="text-right tabular-nums">Balance</span>,
        cell: ({ getValue }) => (
          <div className="text-right font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {formatInr(n(getValue()))}
          </div>
        ),
      },
      {
        accessorKey: "days_overdue",
        header: () => <span className="text-center">Days overdue</span>,
        cell: ({ getValue }) => {
          const d = getValue() as number | null;
          if (d == null) return <div className="text-center text-slate-400">—</div>;
          return (
            <div className={`text-center tabular-nums ${d > 30 ? "font-semibold text-red-700 dark:text-red-400" : d > 7 ? "font-medium text-amber-800 dark:text-amber-300" : "text-slate-600 dark:text-slate-400"}`}>
              {d <= 0 ? "—" : d}
            </div>
          );
        },
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) => (
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-blue-300 dark:hover:bg-slate-700"
            onClick={() => {
              /* placeholder — wire SMS/email reminder */
              void row.original.invoice_id;
            }}
          >
            Send reminder
          </button>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm text-slate-500">Loading outstanding invoices…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {error}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Outstanding invoices</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Balance due &gt; 0, sorted by due date (up to 500).</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                  No outstanding balances.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const overdue = row.original.days_overdue;
                const tone = rowTone(overdue);
                return (
                  <tr key={row.id} className={`border-b border-slate-100 dark:border-slate-800 ${tone}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2.5 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} · {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
