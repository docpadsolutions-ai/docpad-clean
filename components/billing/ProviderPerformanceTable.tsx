"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/supabase";

export type ProviderRevenue = {
  practitioner_id: string | null;
  practitioner_name: string;
  total_revenue: number;
  patient_count: number;
  invoice_count: number;
};

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

export function ProviderPerformanceTable({
  hospitalId,
  startDate,
  endDate,
}: {
  hospitalId: string | null;
  startDate: string;
  endDate: string;
}) {
  const [data, setData] = useState<ProviderRevenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data: result, error: rpcError } = await supabase.rpc("get_provider_revenue", {
        p_hospital_id: hospitalId,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setData([]);
      } else {
        const rows = (result ?? []) as Record<string, unknown>[];
        setData(
          rows.map((r) => ({
            practitioner_id: r.practitioner_id != null ? String(r.practitioner_id) : null,
            practitioner_name: String(r.practitioner_name ?? "—"),
            total_revenue: n(r.total_revenue),
            patient_count: Math.round(n(r.patient_count)),
            invoice_count: Math.round(n(r.invoice_count)),
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

  if (!hospitalId) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        Sign in as a practitioner to load provider revenue.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading provider performance…</p>
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
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Provider performance</h2>
      <p className="mb-4 text-xs text-slate-500">
        Billed gross by attending doctor (from linked OPD encounter). Invoices without an encounter appear as Unassigned.
      </p>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No invoices in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4 text-right">Revenue</th>
                <th className="py-2 pr-4 text-right">Patients</th>
                <th className="py-2 text-right">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr
                  key={row.practitioner_id ?? `unassigned-${row.practitioner_name}`}
                  className="border-b border-slate-100"
                >
                  <td className="py-2.5 pr-4 font-medium text-slate-900">{row.practitioner_name}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-800">{formatInr(row.total_revenue)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{row.patient_count}</td>
                  <td className="py-2.5 text-right tabular-nums text-slate-600">{row.invoice_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
