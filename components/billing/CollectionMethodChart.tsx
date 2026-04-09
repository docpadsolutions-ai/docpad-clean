"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/app/supabase";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

const COLORS: Record<string, string> = {
  cash: "#2563eb",
  upi: "#0d9488",
  card: "#7c3aed",
  other: "#64748b",
};

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

type EfficiencyRow = {
  payment_method: string;
  total_collected: number;
  transaction_count: number;
  share_pct: number;
};

export function CollectionMethodChart({
  hospitalId,
  startDate,
  endDate,
}: {
  hospitalId: string | null;
  startDate: string;
  endDate: string;
}) {
  const [rows, setRows] = useState<EfficiencyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc("get_collection_efficiency", {
        p_hospital_id: hospitalId,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setRows([]);
      } else {
        const raw = (data ?? []) as Record<string, unknown>[];
        setRows(
          raw.map((r) => ({
            payment_method: String(r.payment_method ?? "other"),
            total_collected: n(r.total_collected),
            transaction_count: Math.round(n(r.transaction_count)),
            share_pct: n(r.share_pct),
          })),
        );
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [hospitalId, startDate, endDate]);

  const chartData = useMemo(() => {
    return rows.map((r) => ({
      label: r.payment_method.charAt(0).toUpperCase() + r.payment_method.slice(1),
      method: r.payment_method,
      total_collected: r.total_collected,
      share_pct: r.share_pct,
      transaction_count: r.transaction_count,
      fill: COLORS[r.payment_method] ?? COLORS.other,
    }));
  }, [rows]);

  if (!hospitalId) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Sign in as a practitioner to load collection mix.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm text-slate-500">Loading collection mix…</p>
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
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Collection by method</h2>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Confirmed payments in the report range (cash / UPI / card / other).</p>
      {chartData.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No confirmed payments in this range.</p>
      ) : (
        <div className="h-[260px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => formatInr(Number(v))} className="text-[10px]" tick={{ fill: "currentColor" }} />
              <YAxis type="category" dataKey="label" width={72} className="text-[10px]" tick={{ fill: "currentColor" }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const p = payload[0].payload as (typeof chartData)[0];
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-800">
                      <p className="font-semibold capitalize text-slate-800 dark:text-slate-100">{p.label}</p>
                      <p className="mt-0.5 text-slate-600 dark:text-slate-300">{formatInr(p.total_collected)}</p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {p.share_pct.toFixed(1)}% of total · {p.transaction_count} txns
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="total_collected" radius={[0, 4, 4, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={chartData[i]?.method ?? i} fill={chartData[i]?.fill ?? COLORS.other} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
