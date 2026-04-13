"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/supabase";

export type DepartmentRevenue = {
  department_id: string | null;
  department_name: string;
  total_revenue: number;
  patient_count: number;
  avg_revenue_per_patient: number;
};

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function DepartmentPerformanceGrid({
  hospitalId,
  startDate,
  endDate,
}: {
  hospitalId: string | null;
  startDate: string;
  endDate: string;
}) {
  const [data, setData] = useState<DepartmentRevenue[]>([]);
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
      const { data: result, error: rpcError } = await supabase.rpc("get_revenue_by_department", {
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
            department_id: r.department_id != null ? String(r.department_id) : null,
            department_name: String(r.department_name ?? "—"),
            total_revenue: n(r.total_revenue),
            patient_count: Math.round(n(r.patient_count)),
            avg_revenue_per_patient: n(r.avg_revenue_per_patient),
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
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500 shadow-sm">
        Sign in as a practitioner to load department revenue.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Loading department performance…</p>
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

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
        No invoice revenue in this range by department.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Department performance</h2>
      <p className="mb-4 text-xs text-gray-500">Billed gross by invoice department in the report range.</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.map((dept) => (
          <div
            key={dept.department_id ?? `unassigned-${dept.department_name}`}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <h3 className="font-semibold text-gray-900">{dept.department_name}</h3>
            <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">
              ₹{dept.total_revenue.toLocaleString("en-IN")}
            </p>
            <p className="mt-1 text-sm text-gray-500">{dept.patient_count} patients</p>
            <p className="text-sm text-gray-500">
              Avg: ₹{dept.avg_revenue_per_patient.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
