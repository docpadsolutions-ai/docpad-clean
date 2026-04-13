"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPreset, CollectionReportRow } from "@/hooks/useBillingAnalytics";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

const COLORS = {
  cash: "#2563eb",
  upi: "#0d9488",
  card: "#7c3aed",
  other: "#64748b",
} as const;

function formatInrShort(v: number): string {
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

function formatAxis(v: number): string {
  return formatInrShort(v);
}

type ChartRow = {
  label: string;
  cash_total: number;
  upi_total: number;
  card_total: number;
  other_total: number;
};

export function CollectionChart({
  rows,
  loading,
  error,
  chartPreset,
  onChartPresetChange,
}: {
  rows: CollectionReportRow[];
  loading: boolean;
  error: string | null;
  chartPreset: ChartPreset;
  onChartPresetChange: (p: ChartPreset) => void;
}) {
  const data = useMemo((): ChartRow[] => {
    return rows.map((r) => {
      const d = r.report_date;
      const dateObj = d ? new Date(`${d}T12:00:00`) : new Date();
      const label = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" }).format(dateObj);
      return {
        label,
        cash_total: n(r.cash_total),
        upi_total: n(r.upi_total),
        card_total: n(r.card_total),
        other_total: n(r.other_total),
      };
    });
  }, [rows]);

  const toggleBtn = (id: ChartPreset, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onChartPresetChange(id)}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        chartPreset === id
          ? "bg-blue-600 text-white shadow-sm"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );

  if (loading) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        <p className="text-sm text-slate-500">Loading chart…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Collection by method</h2>
        <div className="flex flex-wrap gap-2">
          {toggleBtn("7d", "7d")}
          {toggleBtn("30d", "30d")}
          {toggleBtn("custom", "Custom")}
        </div>
      </div>
      {chartPreset === "custom" ? (
        <p className="mb-2 text-xs text-slate-500">Using the date range selected above.</p>
      ) : null}
      <div className="h-[300px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-slate-500" />
            <YAxis tickFormatter={formatAxis} tick={{ fontSize: 11 }} className="text-slate-500" width={56} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as ChartRow;
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                    <p className="mb-1 font-semibold text-slate-800">{label}</p>
                    <ul className="space-y-0.5 text-slate-600">
                      <li>Cash: {formatInrShort(row.cash_total)}</li>
                      <li>UPI: {formatInrShort(row.upi_total)}</li>
                      <li>Card: {formatInrShort(row.card_total)}</li>
                      <li>Other: {formatInrShort(row.other_total)}</li>
                    </ul>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="cash_total" name="Cash" stackId="m" fill={COLORS.cash} radius={[0, 0, 0, 0]} />
            <Bar dataKey="upi_total" name="UPI" stackId="m" fill={COLORS.upi} />
            <Bar dataKey="card_total" name="Card" stackId="m" fill={COLORS.card} />
            <Bar dataKey="other_total" name="Other" stackId="m" fill={COLORS.other} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
