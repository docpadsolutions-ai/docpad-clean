"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { RevenueByChargeRow } from "@/hooks/useBillingAnalytics";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

const SLICE_COLORS = ["#2563eb", "#0d9488", "#7c3aed", "#ea580c", "#0891b2", "#4f46e5", "#64748b", "#db2777"];

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

type PieDatum = {
  name: string;
  value: number;
  total_billed: number;
  total_collected: number;
  collection_rate: number;
};

export function RevenuePieChart({
  rows,
  loading,
  error,
}: {
  rows: RevenueByChargeRow[];
  loading: boolean;
  error: string | null;
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const data = useMemo((): PieDatum[] => {
    return rows.map((r) => ({
      name: r.charge_category || "Other",
      value: n(r.total_billed),
      total_billed: n(r.total_billed),
      total_collected: n(r.total_collected),
      collection_rate: n(r.collection_rate),
    }));
  }, [rows]);

  if (loading) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm text-slate-500">Loading revenue…</p>
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
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Revenue by charge type</h2>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Billed amount in period; collection rate in legend.</p>
      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No line-item revenue in this range.</p>
      ) : (
        <>
          <div className="h-[220px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  onClick={(_, index) => {
                    const name = data[index]?.name;
                    setActiveCategory((prev) => (prev === name ? null : name ?? null));
                  }}
                >
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={SLICE_COLORS[i % SLICE_COLORS.length]}
                      stroke={activeCategory === data[i]?.name ? "#1e40af" : "transparent"}
                      strokeWidth={2}
                      className="cursor-pointer outline-none transition-opacity hover:opacity-90"
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload as PieDatum;
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-800">
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{d.name}</p>
                        <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                          {formatInr(d.total_billed)} billed · {d.collection_rate.toFixed(1)}% collected
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs">
            {data.map((d, i) => (
              <li
                key={d.name}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${
                  activeCategory === d.name ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800/80"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                  <span className="truncate font-medium text-slate-800 dark:text-slate-200">{d.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-400">{d.collection_rate.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
          {activeCategory ? (
            <div className="mt-3 rounded-lg border border-dashed border-blue-200 bg-blue-50/50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
              <span className="font-semibold">{activeCategory}</span>
              <span className="text-blue-800/80 dark:text-blue-300/90"> — line-item drill-down table coming in a later phase.</span>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Click a slice to pin a category (preview).</p>
          )}
        </>
      )}
    </div>
  );
}
