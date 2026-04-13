"use client";

import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { supabase } from "@/app/supabase";

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

const SLICE_COLORS = ["#2563eb", "#0d9488", "#7c3aed", "#ea580c", "#0891b2", "#4f46e5", "#64748b", "#db2777"];

type CategoryRow = {
  charge_category: string;
  total_billed: number;
  total_collected: number;
  collection_rate: number;
};

type PieDatum = {
  name: string;
  value: number;
  total_billed: number;
  total_collected: number;
  collection_rate: number;
};

export function CategoryBreakdownPie({
  hospitalId,
  startDate,
  endDate,
}: {
  hospitalId: string | null;
  startDate: string;
  endDate: string;
}) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

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
      const { data, error: rpcError } = await supabase.rpc("get_revenue_by_category", {
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
            charge_category: String(r.charge_category ?? "other"),
            total_billed: n(r.total_billed),
            total_collected: n(r.total_collected),
            collection_rate: n(r.collection_rate),
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

  const data = useMemo((): PieDatum[] => {
    return rows.map((r) => ({
      name: r.charge_category || "Other",
      value: r.total_billed,
      total_billed: r.total_billed,
      total_collected: r.total_collected,
      collection_rate: r.collection_rate,
    }));
  }, [rows]);

  if (!hospitalId) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
        Sign in as a practitioner to load category revenue.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        <p className="text-sm text-slate-500">Loading categories…</p>
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
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Revenue by category</h2>
      <p className="mb-3 text-xs text-slate-500">Line-item categories in range; collection rate in legend.</p>
      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No line-item revenue in this range.</p>
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
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                        <p className="font-semibold text-slate-800">{d.name}</p>
                        <p className="mt-0.5 text-slate-600">
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
                  activeCategory === d.name ? "bg-blue-50" : "hover:bg-slate-50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                  <span className="truncate font-medium text-slate-800">{d.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">{d.collection_rate.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
