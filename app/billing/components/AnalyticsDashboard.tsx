"use client";

import { CalendarIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(ymd: string): Date | undefined {
  if (!ymd) return undefined;
  const [y, m, d] = ymd.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  return new Date(y, m - 1, d);
}

function formatDay(ymd: string): string {
  const dt = parseYmd(ymd);
  if (!dt) return ymd || "—";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

const CATEGORY_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#64748b"];

export type CategoryBreakdownRow = {
  category: string;
  revenue: number;
  percentage: number;
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
  const [data, setData] = useState<CategoryBreakdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setData([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data: result, error: rpcError } = await supabase.rpc("get_revenue_breakdown_by_category", {
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
            category: String(r.category ?? "other"),
            revenue: n(r.revenue),
            percentage: n(r.percentage),
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
      <Card>
        <CardHeader>
          <CardTitle>Revenue by category</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Sign in as a practitioner to load this report.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Revenue by category</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Revenue by category</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue by category</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">No line-item revenue in this range.</p>
        ) : (
          <div className="space-y-3">
            {data.map((item, idx) => (
              <div key={item.category} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-4 w-4 shrink-0 rounded" style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }} />
                  <span className="truncate capitalize text-slate-800">{item.category.replace(/_/g, " ")}</span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums text-slate-900">
                    ₹{item.revenue.toLocaleString("en-IN")}
                  </div>
                  <div className="text-sm text-slate-500">{item.percentage.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type ServiceUtilizationRow = {
  service_id: string | null;
  service_name: string;
  usage_count: number;
  total_revenue: number;
  avg_price: number;
  margin_percent: number | null;
};

export function ServiceUtilizationTable({
  hospitalId,
  startDate,
  endDate,
}: {
  hospitalId: string | null;
  startDate: string;
  endDate: string;
}) {
  const [data, setData] = useState<ServiceUtilizationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setData([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data: result, error: rpcError } = await supabase.rpc("get_service_utilization", {
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
            service_id: r.service_id != null ? String(r.service_id) : null,
            service_name: String(r.service_name ?? "—"),
            usage_count: n(r.usage_count),
            total_revenue: n(r.total_revenue),
            avg_price: n(r.avg_price),
            margin_percent: r.margin_percent == null ? null : n(r.margin_percent),
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
      <Card>
        <CardHeader>
          <CardTitle>Top services by revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Sign in as a practitioner to load this report.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top services by revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top services by revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top services by revenue</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">No service-linked line items in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2 pr-2 font-semibold text-slate-700">Service</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">Usage</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">Revenue</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">Avg price</th>
                  <th className="py-2 text-right font-semibold text-slate-700">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {data.map((s, i) => (
                  <tr key={s.service_id ?? `unlinked-${i}-${s.service_name}`} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-900">{s.service_name}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">{s.usage_count}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">
                      ₹{s.total_revenue.toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">₹{s.avg_price.toFixed(0)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">
                      {s.margin_percent != null ? `${s.margin_percent.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type OutstandingAgingRow = {
  department_id: string | null;
  department_name: string;
  outstanding_0_30: number;
  outstanding_31_60: number;
  outstanding_61_90: number;
  outstanding_90_plus: number;
  total_outstanding: number;
};

export function OutstandingAgingGrid({ hospitalId }: { hospitalId: string | null }) {
  const [data, setData] = useState<OutstandingAgingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setData([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data: result, error: rpcError } = await supabase.rpc("get_outstanding_by_department", {
        p_hospital_id: hospitalId,
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
            outstanding_0_30: n(r.outstanding_0_30),
            outstanding_31_60: n(r.outstanding_31_60),
            outstanding_61_90: n(r.outstanding_61_90),
            outstanding_90_plus: n(r.outstanding_90_plus),
            total_outstanding: n(r.total_outstanding),
          })),
        );
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [hospitalId]);

  if (!hospitalId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Outstanding by department (aging)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Sign in as a practitioner to load this report.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Outstanding by department (aging)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Outstanding by department (aging)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outstanding by department (aging)</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">No open balances.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-2 text-left font-semibold text-slate-700">Department</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">0–30 days</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">31–60 days</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">61–90 days</th>
                  <th className="py-2 pr-2 text-right font-semibold text-red-600">90+ days</th>
                  <th className="py-2 text-right font-bold text-slate-900">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr
                    key={d.department_id ?? `unassigned-${d.department_name}`}
                    className="border-b border-slate-100"
                  >
                    <td className="py-2 pr-2 text-slate-900">{d.department_name}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">
                      ₹{d.outstanding_0_30.toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">
                      ₹{d.outstanding_31_60.toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">
                      ₹{d.outstanding_61_90.toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-red-600">
                      ₹{d.outstanding_90_plus.toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 text-right font-bold tabular-nums text-slate-900">
                      ₹{d.total_outstanding.toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type TopDefaulterRow = {
  patient_id: string;
  patient_name: string;
  total_outstanding: number;
  invoice_count: number;
  oldest_invoice_date: string | null;
};

export function TopDefaulters({ hospitalId }: { hospitalId: string | null }) {
  const [data, setData] = useState<TopDefaulterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setData([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data: result, error: rpcError } = await supabase.rpc("get_top_defaulters", {
        p_hospital_id: hospitalId,
        p_limit: 10,
      });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setData([]);
      } else {
        const rows = (result ?? []) as Record<string, unknown>[];
        setData(
          rows.map((r) => ({
            patient_id: String(r.patient_id ?? ""),
            patient_name: String(r.patient_name ?? "—"),
            total_outstanding: n(r.total_outstanding),
            invoice_count: Math.round(n(r.invoice_count)),
            oldest_invoice_date:
              r.oldest_invoice_date == null
                ? null
                : typeof r.oldest_invoice_date === "string"
                  ? r.oldest_invoice_date.slice(0, 10)
                  : String(r.oldest_invoice_date),
          })),
        );
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [hospitalId]);

  if (!hospitalId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top 10 outstanding patients</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Sign in as a practitioner to load this report.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top 10 outstanding patients</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top 10 outstanding patients</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 outstanding patients</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-slate-500">No open balances.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-2 text-left font-semibold text-slate-700">Patient</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">Amount due</th>
                  <th className="py-2 pr-2 text-right font-semibold text-slate-700">Invoices</th>
                  <th className="py-2 text-right font-semibold text-slate-700">Oldest invoice</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.patient_id} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-900">{p.patient_name}</td>
                    <td className="py-2 pr-2 text-right font-semibold tabular-nums text-red-600">
                      ₹{p.total_outstanding.toLocaleString("en-IN")}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">{p.invoice_count}</td>
                    <td className="py-2 text-right text-slate-600">
                      {p.oldest_invoice_date ? formatDay(p.oldest_invoice_date) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}) {
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const onPickStart = useCallback(
    (d: Date | undefined) => {
      if (d) {
        onStartChange(toYmd(d));
        setStartOpen(false);
      }
    },
    [onStartChange],
  );

  const onPickEnd = useCallback(
    (d: Date | undefined) => {
      if (d) {
        onEndChange(toYmd(d));
        setEndOpen(false);
      }
    },
    [onEndChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={startOpen} onOpenChange={setStartOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="min-w-[140px] justify-start">
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-70" aria-hidden />
            {startDate ? formatDay(startDate) : "Start date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <DayPicker
            mode="single"
            selected={parseYmd(startDate)}
            onSelect={onPickStart}
            className="p-3 [--rdp-accent-color:#2563eb] [--rdp-background-color:#eff6ff]"
          />
        </PopoverContent>
      </Popover>

      <span className="text-sm text-slate-500">to</span>

      <Popover open={endOpen} onOpenChange={setEndOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="min-w-[140px] justify-start">
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-70" aria-hidden />
            {endDate ? formatDay(endDate) : "End date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <DayPicker
            mode="single"
            selected={parseYmd(endDate)}
            onSelect={onPickEnd}
            className="p-3 [--rdp-accent-color:#2563eb] [--rdp-background-color:#eff6ff]"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Optional composed section: Card-based analytics + date controls (same range for dated widgets). */
export function BillingAnalyticsSection({
  hospitalId,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  showDatePicker = false,
}: {
  hospitalId: string | null;
  startDate: string;
  endDate: string;
  onStartDateChange?: (v: string) => void;
  onEndDateChange?: (v: string) => void;
  showDatePicker?: boolean;
}) {
  return (
    <div className="space-y-6">
      {showDatePicker && onStartDateChange && onEndDateChange ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-slate-700">Analytics date range</p>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartChange={onStartDateChange}
            onEndChange={onEndDateChange}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CategoryBreakdownPie hospitalId={hospitalId} startDate={startDate} endDate={endDate} />
        <ServiceUtilizationTable hospitalId={hospitalId} startDate={startDate} endDate={endDate} />
      </div>
      <OutstandingAgingGrid hospitalId={hospitalId} />
      <TopDefaulters hospitalId={hospitalId} />
    </div>
  );
}
