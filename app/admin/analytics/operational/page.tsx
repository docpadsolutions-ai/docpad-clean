"use client";

import { CalendarIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { endOfDay, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { supabase } from "@/app/supabase";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
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

type ConsultRow = { avg_consultation_minutes: number | null; completed_encounter_count: number };

export default function OperationalAnalyticsPage() {
  const today = startOfDay(new Date());
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => toYmd(startOfDay(new Date(Date.now() - 6 * 86400000))));
  const [endDate, setEndDate] = useState(() => toYmd(today));

  const [consultToday, setConsultToday] = useState<ConsultRow | null>(null);
  const [consultWeek, setConsultWeek] = useState<ConsultRow | null>(null);
  const [consultMonth, setConsultMonth] = useState<ConsultRow | null>(null);
  const [waitRow, setWaitRow] = useState<{ avg_wait_minutes: number | null; sample_count: number } | null>(null);
  const [noshow, setNoshow] = useState<{ no_show_count: number; total_booked: number; no_show_rate_pct: number } | null>(
    null,
  );
  const [utilization, setUtilization] = useState<
    { department_name: string; booked_slots: number; total_available_slots: number; utilization_pct: number | null }[]
  >([]);
  const [daily, setDaily] = useState<
    {
      metric_date: string;
      avg_consultation_minutes: number | null;
      avg_wait_minutes: number | null;
    }[]
  >([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  const ranges = useMemo(() => {
    const now = new Date();
    const d0 = toYmd(startOfDay(now));
    const w0 = toYmd(startOfWeek(now, { weekStartsOn: 1 }));
    const m0 = toYmd(startOfMonth(now));
    return { today: { from: d0, to: d0 }, week: { from: w0, to: d0 }, month: { from: m0, to: d0 } };
  }, []);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setError(null);
    try {
      const [t, w, mo] = await Promise.all([
        supabase.rpc("get_avg_consultation_time", {
          p_hospital_id: hospitalId,
          p_start_date: ranges.today.from,
          p_end_date: ranges.today.to,
        }),
        supabase.rpc("get_avg_consultation_time", {
          p_hospital_id: hospitalId,
          p_start_date: ranges.week.from,
          p_end_date: ranges.week.to,
        }),
        supabase.rpc("get_avg_consultation_time", {
          p_hospital_id: hospitalId,
          p_start_date: ranges.month.from,
          p_end_date: ranges.month.to,
        }),
      ]);
      if (t.error) throw new Error(t.error.message);
      if (w.error) throw new Error(w.error.message);
      if (mo.error) throw new Error(mo.error.message);
      const tr = (t.data ?? [])[0] as Record<string, unknown> | undefined;
      const wr = (w.data ?? [])[0] as Record<string, unknown> | undefined;
      const mor = (mo.data ?? [])[0] as Record<string, unknown> | undefined;
      setConsultToday(
        tr
          ? {
              avg_consultation_minutes: tr.avg_consultation_minutes != null ? n(tr.avg_consultation_minutes) : null,
              completed_encounter_count: Math.trunc(n(tr.completed_encounter_count)),
            }
          : null,
      );
      setConsultWeek(
        wr
          ? {
              avg_consultation_minutes: wr.avg_consultation_minutes != null ? n(wr.avg_consultation_minutes) : null,
              completed_encounter_count: Math.trunc(n(wr.completed_encounter_count)),
            }
          : null,
      );
      setConsultMonth(
        mor
          ? {
              avg_consultation_minutes: mor.avg_consultation_minutes != null ? n(mor.avg_consultation_minutes) : null,
              completed_encounter_count: Math.trunc(n(mor.completed_encounter_count)),
            }
          : null,
      );

      const [wait, ns, util, series] = await Promise.all([
        supabase.rpc("get_avg_wait_time", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
        supabase.rpc("get_noshow_rate", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
        supabase.rpc("get_opd_utilization", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
        supabase.rpc("get_operational_daily_metrics", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
      ]);
      if (wait.error) throw new Error(wait.error.message);
      if (ns.error) throw new Error(ns.error.message);
      if (util.error) throw new Error(util.error.message);
      if (series.error) throw new Error(series.error.message);

      const wr0 = (wait.data ?? [])[0] as Record<string, unknown> | undefined;
      setWaitRow(
        wr0
          ? {
              avg_wait_minutes: wr0.avg_wait_minutes != null ? n(wr0.avg_wait_minutes) : null,
              sample_count: Math.trunc(n(wr0.sample_count)),
            }
          : null,
      );

      const ns0 = (ns.data ?? [])[0] as Record<string, unknown> | undefined;
      setNoshow(
        ns0
          ? {
              no_show_count: Math.trunc(n(ns0.no_show_count)),
              total_booked: Math.trunc(n(ns0.total_booked)),
              no_show_rate_pct: n(ns0.no_show_rate_pct),
            }
          : null,
      );

      setUtilization(
        ((util.data ?? []) as Record<string, unknown>[]).map((r) => ({
          department_name: String(r.department_name ?? "—"),
          booked_slots: Math.trunc(n(r.booked_slots)),
          total_available_slots: Math.trunc(n(r.total_available_slots)),
          utilization_pct: r.utilization_pct != null ? n(r.utilization_pct) : null,
        })),
      );

      setDaily(
        ((series.data ?? []) as Record<string, unknown>[]).map((r) => ({
          metric_date: String(r.metric_date ?? "").slice(0, 10),
          avg_consultation_minutes: r.avg_consultation_minutes != null ? n(r.avg_consultation_minutes) : null,
          avg_wait_minutes: r.avg_wait_minutes != null ? n(r.avg_wait_minutes) : null,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }, [hospitalId, startDate, endDate, ranges]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartDaily = useMemo(
    () =>
      daily.map((r) => ({
        ...r,
        label: formatDay(r.metric_date),
      })),
    [daily],
  );

  const barData = useMemo(
    () =>
      utilization.map((r) => ({
        name: r.department_name.length > 14 ? `${r.department_name.slice(0, 12)}…` : r.department_name,
        fullName: r.department_name,
        pct: r.utilization_pct ?? 0,
        booked: r.booked_slots,
        cap: r.total_available_slots,
      })),
    [utilization],
  );

  const setLastDays = useCallback((days: number) => {
    const to = startOfDay(new Date());
    const from = startOfDay(new Date(Date.now() - (days - 1) * 86400000));
    setStartDate(toYmd(from));
    setEndDate(toYmd(to));
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Operational performance</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            NABH 6th Ed. §3.2 — consultation flow, waiting, attendance, and OPD capacity. Charts use the selected
            reporting window.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="min-w-[8rem] justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                  {formatDay(startDate)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <DayPicker
                  mode="single"
                  selected={parseYmd(startDate)}
                  onSelect={(d) => d && setStartDate(toYmd(startOfDay(d)))}
                  captionLayout="dropdown"
                  fromYear={2020}
                  toYear={2035}
                />
              </PopoverContent>
            </Popover>
            <span className="text-sm text-slate-500">to</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="min-w-[8rem] justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                  {formatDay(endDate)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <DayPicker
                  mode="single"
                  selected={parseYmd(endDate)}
                  onSelect={(d) => d && setEndDate(toYmd(endOfDay(d)))}
                  captionLayout="dropdown"
                  fromYear={2020}
                  toYear={2035}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setLastDays(7)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Last 7 days
            </button>
            <button
              type="button"
              onClick={() => setLastDays(30)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Last 30 days
            </button>
          </div>
        </div>
      </header>

      {!hospitalId ? (
        <p className="text-sm text-slate-500">Sign in as hospital staff to load analytics.</p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">Avg consultation time</CardTitle>
            <p className="text-xs text-slate-500">Completed encounters (create → last update), minutes.</p>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Today</span>
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {loading ? "…" : consultToday?.avg_consultation_minutes != null ? `${consultToday.avg_consultation_minutes} min` : "—"}
                <span className="ml-2 text-xs font-normal text-slate-500">({consultToday?.completed_encounter_count ?? 0} enc.)</span>
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">This week</span>
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {loading ? "…" : consultWeek?.avg_consultation_minutes != null ? `${consultWeek.avg_consultation_minutes} min` : "—"}
                <span className="ml-2 text-xs font-normal text-slate-500">({consultWeek?.completed_encounter_count ?? 0})</span>
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-600 dark:text-slate-400">This month</span>
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {loading ? "…" : consultMonth?.avg_consultation_minutes != null ? `${consultMonth.avg_consultation_minutes} min` : "—"}
                <span className="ml-2 text-xs font-normal text-slate-500">({consultMonth?.completed_encounter_count ?? 0})</span>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">Patient wait time</CardTitle>
            <p className="text-xs text-slate-500">Check-in → encounter start (linked appointments).</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {loading ? "…" : waitRow?.avg_wait_minutes != null ? `${waitRow.avg_wait_minutes}` : "—"}
              <span className="text-lg font-medium text-slate-500"> min</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">Samples: {waitRow?.sample_count ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">No-show rate</CardTitle>
            <p className="text-xs text-slate-500">Booked appointments (non-cancelled) with status no_show.</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {loading ? "…" : `${noshow?.no_show_rate_pct ?? 0}%`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {noshow?.no_show_count ?? 0} no-shows / {noshow?.total_booked ?? 0} booked
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">OPD utilization</CardTitle>
            <p className="text-xs text-slate-500">Booked slots vs modelled capacity by department.</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {loading
                ? "…"
                : utilization.length
                  ? `${(
                      utilization.reduce((s, r) => s + (r.utilization_pct ?? 0), 0) / utilization.length
                    ).toFixed(1)}%`
                  : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Mean across departments with OPD hours configured.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily averages (range)</CardTitle>
            <p className="text-xs text-slate-500">Line: consultation and wait (minutes).</p>
          </CardHeader>
          <CardContent className="h-[320px]">
            {chartDaily.length === 0 && !loading ? (
              <p className="text-sm text-slate-500">No series data for this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={36} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8 }}
                    formatter={(value, name) => [
                      `${value ?? "—"} min`,
                      name === "avg_consultation_minutes" ? "Consult" : "Wait",
                    ]}
                  />
                  <Line type="monotone" dataKey="avg_consultation_minutes" stroke="#2563eb" strokeWidth={2} dot={false} name="Consult" />
                  <Line type="monotone" dataKey="avg_wait_minutes" stroke="#059669" strokeWidth={2} dot={false} name="Wait" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">OPD utilization by department</CardTitle>
            <p className="text-xs text-slate-500">Bar: % of modelled slot capacity used.</p>
          </CardHeader>
          <CardContent className="h-[320px]">
            {barData.length === 0 && !loading ? (
              <p className="text-sm text-slate-500">No department capacity data — set OPD hours on departments.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8 }}
                    formatter={(value, _n, item) => {
                      const row = item?.payload as { fullName?: string; booked?: number; cap?: number };
                      const v = typeof value === "number" ? value : Number(value);
                      const pct = Number.isFinite(v) ? v : 0;
                      return [`${pct}% (${row?.booked ?? 0}/${row?.cap ?? 0} slots)`, row?.fullName ?? "Department"];
                    }}
                  />
                  <Bar dataKey="pct" fill="#7c3aed" radius={[0, 4, 4, 0]} name="Utilization %" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
