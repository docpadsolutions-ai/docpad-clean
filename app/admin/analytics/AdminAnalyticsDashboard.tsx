"use client";

import { CalendarIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { supabase } from "@/app/supabase";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

type DeptRow = { id: string; name: string | null };

function SectionLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
      Loading {label}…
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}

export function AdminAnalyticsDashboard() {
  const defaultEnd = startOfDay(new Date());
  const defaultStart = startOfDay(subDays(defaultEnd, 29));
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => toYmd(defaultStart));
  const [endDate, setEndDate] = useState(() => toYmd(defaultEnd));
  const [departmentId, setDepartmentId] = useState<string>("");
  const [specialty, setSpecialty] = useState("");

  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);

  const [loadOp, setLoadOp] = useState(true);
  const [loadClin, setLoadClin] = useState(true);
  const [loadFin, setLoadFin] = useState(true);
  const [claimsLoading, setClaimsLoading] = useState(true);

  const [errOp, setErrOp] = useState<string | null>(null);
  const [errClin, setErrClin] = useState<string | null>(null);
  const [errFin, setErrFin] = useState<string | null>(null);
  const [errClaims, setErrClaims] = useState<string | null>(null);

  const [consult, setConsult] = useState<{ avg: number | null; n: number } | null>(null);
  const [wait, setWait] = useState<{ avg: number | null; n: number } | null>(null);
  const [noshow, setNoshow] = useState<{ rate: number; noShow: number; booked: number } | null>(null);
  const [utilization, setUtilization] = useState<
    { department_id: string; department_name: string; booked_slots: number; total_available_slots: number; utilization_pct: number | null }[]
  >([]);
  const [daily, setDaily] = useState<
    { metric_date: string; avg_consultation_minutes: number | null; avg_wait_minutes: number | null }[]
  >([]);

  const [diagnoses, setDiagnoses] = useState<{ snomed_code: string; display_name: string; count: number }[]>([]);
  const [rx, setRx] = useState<{ drug_name: string; times_prescribed: number; avg_duration: number | null }[]>([]);
  const [tat, setTat] = useState<{ avg: number | null; median: number | null; n: number } | null>(null);
  const [avgMeds, setAvgMeds] = useState<{ avg: number | null; encounters: number } | null>(null);

  const [revDept, setRevDept] = useState<
    { department_id: string | null; department_name: string; total_revenue: number; patient_count: number; avg_revenue_per_patient: number }[]
  >([]);
  const [revCat, setRevCat] = useState<
    { charge_category: string; total_billed: number; total_collected: number; collection_rate: number }[]
  >([]);
  const [collEff, setCollEff] = useState<{ payment_method: string; total_collected: number; transaction_count: number; share_pct: number }[]>(
    [],
  );
  const [claims, setClaims] = useState<
    {
      id: string;
      claim_number: string | null;
      patient_full_name: string;
      billed_amount: number | null;
      approved_amount: number | null;
      settled_amount: number | null;
      status: string | null;
      settlement_due_date: string | null;
    }[]
  >([]);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  const loadDepartmentsAndSpecs = useCallback(async (hid: string) => {
    const [{ data: deps }, { data: specData, error: specErr }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("hospital_id", hid).eq("is_active", true).order("name"),
      supabase.rpc("get_clinical_specialties_for_filter", { p_hospital_id: hid }),
    ]);
    setDepartments((deps ?? []) as DeptRow[]);
    if (!specErr && specData) {
      setSpecialties((specData as { specialty: string }[]).map((r) => r.specialty).filter(Boolean));
    }
  }, []);

  const loadOperational = useCallback(async () => {
    if (!hospitalId) return;
    setLoadOp(true);
    setErrOp(null);
    try {
      const [c, w, ns, u, d] = await Promise.all([
        supabase.rpc("get_avg_consultation_time", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
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
      if (c.error) throw new Error(c.error.message);
      if (w.error) throw new Error(w.error.message);
      if (ns.error) throw new Error(ns.error.message);
      if (u.error) throw new Error(u.error.message);
      if (d.error) throw new Error(d.error.message);

      const crow = (c.data ?? [])[0] as Record<string, unknown> | undefined;
      setConsult(
        crow
          ? { avg: crow.avg_consultation_minutes != null ? n(crow.avg_consultation_minutes) : null, n: Math.trunc(n(crow.completed_encounter_count)) }
          : null,
      );
      const wrow = (w.data ?? [])[0] as Record<string, unknown> | undefined;
      setWait(
        wrow
          ? { avg: wrow.avg_wait_minutes != null ? n(wrow.avg_wait_minutes) : null, n: Math.trunc(n(wrow.sample_count)) }
          : null,
      );
      const nsrow = (ns.data ?? [])[0] as Record<string, unknown> | undefined;
      setNoshow(
        nsrow
          ? {
              rate: n(nsrow.no_show_rate_pct),
              noShow: Math.trunc(n(nsrow.no_show_count)),
              booked: Math.trunc(n(nsrow.total_booked)),
            }
          : null,
      );
      const urows = (u.data ?? []) as Record<string, unknown>[];
      setUtilization(
        urows.map((r) => ({
          department_id: String(r.department_id ?? ""),
          department_name: String(r.department_name ?? "—"),
          booked_slots: Math.trunc(n(r.booked_slots)),
          total_available_slots: Math.trunc(n(r.total_available_slots)),
          utilization_pct: r.utilization_pct != null ? n(r.utilization_pct) : null,
        })),
      );
      setDaily(
        ((d.data ?? []) as Record<string, unknown>[]).map((r) => ({
          metric_date: String(r.metric_date ?? "").slice(0, 10),
          avg_consultation_minutes: r.avg_consultation_minutes != null ? n(r.avg_consultation_minutes) : null,
          avg_wait_minutes: r.avg_wait_minutes != null ? n(r.avg_wait_minutes) : null,
        })),
      );
    } catch (e) {
      setErrOp(e instanceof Error ? e.message : "Operational metrics failed.");
    } finally {
      setLoadOp(false);
    }
  }, [hospitalId, startDate, endDate]);

  const loadClinical = useCallback(async () => {
    if (!hospitalId) return;
    setLoadClin(true);
    setErrClin(null);
    const specArg = specialty.trim() || null;
    try {
      const [d1, d2, d3, d4] = await Promise.all([
        supabase.rpc("get_top_diagnoses", {
          p_hospital_id: hospitalId,
          p_limit: 10,
          p_start_date: startDate,
          p_end_date: endDate,
          p_specialty: specArg,
        }),
        supabase.rpc("get_prescription_patterns", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_specialty: specArg,
        }),
        supabase.rpc("get_investigation_tat", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
        supabase.rpc("get_avg_meds_per_encounter", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
      ]);
      if (d1.error) throw new Error(d1.error.message);
      if (d2.error) throw new Error(d2.error.message);
      if (d3.error) throw new Error(d3.error.message);
      if (d4.error) throw new Error(d4.error.message);

      setDiagnoses(
        ((d1.data ?? []) as Record<string, unknown>[]).map((r) => ({
          snomed_code: String(r.snomed_code ?? ""),
          display_name: String(r.display_name ?? ""),
          count: Math.trunc(n(r.count)),
        })),
      );
      setRx(
        ((d2.data ?? []) as Record<string, unknown>[])
          .map((r) => ({
            drug_name: String(r.drug_name ?? "").trim(),
            times_prescribed: Math.trunc(n(r.times_prescribed)),
            avg_duration: r.avg_duration != null ? n(r.avg_duration) : null,
          }))
          .filter((r) => r.drug_name.length > 0),
      );
      const t0 = (d3.data ?? [])[0] as Record<string, unknown> | undefined;
      setTat(
        t0
          ? {
              avg: t0.avg_tat_hours != null ? n(t0.avg_tat_hours) : null,
              median: t0.median_tat_hours != null ? n(t0.median_tat_hours) : null,
              n: Math.trunc(n(t0.sample_count)),
            }
          : null,
      );
      const m0 = (d4.data ?? [])[0] as Record<string, unknown> | undefined;
      setAvgMeds(
        m0
          ? {
              avg: m0.avg_medications_per_encounter != null ? n(m0.avg_medications_per_encounter) : null,
              encounters: Math.trunc(n(m0.encounter_with_rx_count)),
            }
          : null,
      );
    } catch (e) {
      setErrClin(e instanceof Error ? e.message : "Clinical metrics failed.");
    } finally {
      setLoadClin(false);
    }
  }, [hospitalId, startDate, endDate, specialty]);

  const loadFinancial = useCallback(async () => {
    if (!hospitalId) return;
    setLoadFin(true);
    setErrFin(null);
    try {
      const [a, b, ce] = await Promise.all([
        supabase.rpc("get_revenue_by_department", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
        supabase.rpc("get_revenue_by_category", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
        supabase.rpc("get_collection_efficiency", {
          p_hospital_id: hospitalId,
          p_start_date: startDate,
          p_end_date: endDate,
        }),
      ]);
      if (a.error) throw new Error(a.error.message);
      if (b.error) throw new Error(b.error.message);
      if (ce.error) throw new Error(ce.error.message);

      setRevDept(
        ((a.data ?? []) as Record<string, unknown>[]).map((r) => ({
          department_id: r.department_id != null ? String(r.department_id) : null,
          department_name: String(r.department_name ?? "—"),
          total_revenue: n(r.total_revenue),
          patient_count: Math.trunc(n(r.patient_count)),
          avg_revenue_per_patient: n(r.avg_revenue_per_patient),
        })),
      );
      setRevCat(
        ((b.data ?? []) as Record<string, unknown>[]).map((r) => ({
          charge_category: String(r.charge_category ?? "other"),
          total_billed: n(r.total_billed),
          total_collected: n(r.total_collected),
          collection_rate: n(r.collection_rate),
        })),
      );
      setCollEff(
        ((ce.data ?? []) as Record<string, unknown>[]).map((r) => ({
          payment_method: String(r.payment_method ?? ""),
          total_collected: n(r.total_collected),
          transaction_count: Math.trunc(n(r.transaction_count)),
          share_pct: n(r.share_pct),
        })),
      );
    } catch (e) {
      setErrFin(e instanceof Error ? e.message : "Financial metrics failed.");
    } finally {
      setLoadFin(false);
    }
  }, [hospitalId, startDate, endDate]);

  const fetchClaimsSummary = useCallback(async () => {
    setClaimsLoading(true);
    setErrClaims(null);
    try {
      const { data, error } = await supabase.rpc("get_claims_summary");
      if (error) throw new Error(error.message);
      setClaims(
        ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: String(r.id ?? ""),
          claim_number: r.claim_number != null ? String(r.claim_number) : null,
          patient_full_name: String(r.patient_full_name ?? ""),
          billed_amount: r.billed_amount != null ? n(r.billed_amount) : null,
          approved_amount: r.approved_amount != null ? n(r.approved_amount) : null,
          settled_amount: r.settled_amount != null ? n(r.settled_amount) : null,
          status: r.status != null ? String(r.status) : null,
          settlement_due_date: r.settlement_due_date != null ? String(r.settlement_due_date).slice(0, 10) : null,
        })),
      );
    } catch (e) {
      setErrClaims(e instanceof Error ? e.message : "Claims summary failed.");
      setClaims([]);
    } finally {
      setClaimsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hospitalId) return;
    void loadDepartmentsAndSpecs(hospitalId);
  }, [hospitalId, loadDepartmentsAndSpecs]);

  useEffect(() => {
    void loadOperational();
  }, [loadOperational]);

  useEffect(() => {
    void loadClinical();
  }, [loadClinical]);

  useEffect(() => {
    void loadFinancial();
  }, [loadFinancial]);

  useEffect(() => {
    if (!hospitalId) return;
    void fetchClaimsSummary();
  }, [hospitalId, fetchClaimsSummary]);

  const utilFiltered = useMemo(() => {
    if (!departmentId) return utilization;
    return utilization.filter((r) => r.department_id === departmentId);
  }, [utilization, departmentId]);

  const revDeptFiltered = useMemo(() => {
    if (!departmentId) return revDept;
    return revDept.filter((r) => r.department_id === departmentId);
  }, [revDept, departmentId]);

  const dailyChart = useMemo(
    () =>
      daily.map((r) => ({
        ...r,
        label: formatDay(r.metric_date),
      })),
    [daily],
  );

  const setLast30 = useCallback(() => {
    const to = startOfDay(new Date());
    const from = startOfDay(subDays(to, 29));
    setStartDate(toYmd(from));
    setEndDate(toYmd(to));
  }, []);

  if (!hospitalId) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-muted-foreground md:px-6">
        Sign in as hospital staff to view analytics.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-6 md:px-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Analytics dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational, clinical, and financial KPIs for the selected period. Department filter applies to department-scoped
            tables; specialty filters clinical insights.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="min-w-[8rem] justify-start font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                  {formatDay(startDate)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
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
            <span className="text-sm text-muted-foreground">to</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="min-w-[8rem] justify-start font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                  {formatDay(endDate)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
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
            <Button type="button" variant="secondary" size="sm" onClick={setLast30}>
              Last 30 days
            </Button>
          </div>

          <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-muted-foreground">
            Department
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name ?? d.id}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-muted-foreground">
            Specialty (clinical)
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">All specialties</option>
              {specialties.map((s, i) => (
                <option key={`${s}-${i}`} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* OPERATIONAL */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Operational metrics</h3>
          <p className="text-sm text-muted-foreground">Consultation length, waits, attendance, OPD capacity, daily trends.</p>
        </div>
        {errOp ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errOp}</div>
        ) : null}
        {loadOp ? (
          <SectionLoading label="operational metrics" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Avg consultation time</CardTitle>
                  <CardDescription>Completed encounters in range</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums">{consult?.avg != null ? `${consult.avg} min` : "—"}</p>
                  <p className="text-xs text-muted-foreground">{consult?.n ?? 0} encounters</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Avg wait time</CardTitle>
                  <CardDescription>Check-in → encounter start</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums">{wait?.avg != null ? `${wait.avg} min` : "—"}</p>
                  <p className="text-xs text-muted-foreground">{wait?.n ?? 0} samples</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">No-show rate</CardTitle>
                  <CardDescription>Non-cancelled appointments</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums">{noshow != null ? `${noshow.rate}%` : "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {noshow?.noShow ?? 0} / {noshow?.booked ?? 0} booked
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">OPD utilization</CardTitle>
                  <CardDescription>{departmentId ? "Selected department" : "Mean across departments"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums">
                    {utilFiltered.length
                      ? `${(
                          utilFiltered.reduce((s, r) => s + (r.utilization_pct ?? 0), 0) / utilFiltered.length
                        ).toFixed(1)}%`
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Modelled slots vs booked</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Daily trend</CardTitle>
                  <CardDescription>Average consultation and wait (minutes) by day</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  {dailyChart.length === 0 ? (
                    <EmptyHint>No daily series for this range.</EmptyHint>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} width={36} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="avg_consultation_minutes" name="Consult (min)" stroke="#2563eb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="avg_wait_minutes" name="Wait (min)" stroke="#059669" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">OPD utilization by department</CardTitle>
                  <CardDescription>% of modelled slot capacity</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  {utilFiltered.length === 0 ? (
                    <EmptyHint>No utilization data — configure OPD hours on departments or widen the date range.</EmptyHint>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={utilFiltered.map((r) => ({
                          name: r.department_name.length > 16 ? `${r.department_name.slice(0, 14)}…` : r.department_name,
                          full: r.department_name,
                          pct: r.utilization_pct ?? 0,
                        }))}
                        layout="vertical"
                        margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(value, _name, item) => {
                            const v = typeof value === "number" ? value : Number(value);
                            const pct = Number.isFinite(v) ? v : 0;
                            const full = (item?.payload as { full?: string } | undefined)?.full ?? "";
                            return [`${pct}%`, full];
                          }}
                        />
                        <Bar dataKey="pct" fill="#7c3aed" radius={[0, 4, 4, 0]} name="Utilization %" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </section>

      {/* CLINICAL */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Clinical insights</h3>
          <p className="text-sm text-muted-foreground">Diagnoses, prescribing, labs, and medication intensity.</p>
        </div>
        {errClin ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errClin}</div>
        ) : null}
        {loadClin ? (
          <SectionLoading label="clinical insights" />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top 10 diagnoses</CardTitle>
                <CardDescription>SNOMED / display (completed encounters)</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {diagnoses.length === 0 ? (
                  <EmptyHint>No diagnosis data in range.</EmptyHint>
                ) : (
                  <table className="w-full min-w-[400px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 font-semibold">Code</th>
                        <th className="pb-2 font-semibold">Display</th>
                        <th className="pb-2 text-right font-semibold">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnoses.map((row, index) => (
                        <tr key={`${row.snomed_code}-${row.display_name}-${index}`} className="border-b border-border/60">
                          <td className="py-2 font-mono text-xs">{row.snomed_code}</td>
                          <td className="py-2">{row.display_name}</td>
                          <td className="py-2 text-right tabular-nums">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Prescription patterns</CardTitle>
                <CardDescription>Top drugs by volume</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {rx.length === 0 ? (
                  <EmptyHint>No prescriptions in range.</EmptyHint>
                ) : (
                  <table className="w-full min-w-[400px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 font-semibold">Drug</th>
                        <th className="pb-2 text-right font-semibold">Times</th>
                        <th className="pb-2 text-right font-semibold">Avg duration #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rx.slice(0, 15).map((row, index) => (
                        <tr key={row.drug_name || `empty-${index}`} className="border-b border-border/60">
                          <td className="py-2">{row.drug_name}</td>
                          <td className="py-2 text-right tabular-nums">{row.times_prescribed}</td>
                          <td className="py-2 text-right tabular-nums">{row.avg_duration != null ? row.avg_duration : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Investigation TAT</CardTitle>
                <CardDescription>Ordered → resulted (hours)</CardDescription>
              </CardHeader>
              <CardContent>
                {tat?.n === 0 ? (
                  <EmptyHint>No completed investigations in range.</EmptyHint>
                ) : (
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">Mean:</span>{" "}
                      <span className="font-semibold tabular-nums">{tat?.avg != null ? `${tat.avg} h` : "—"}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Median:</span>{" "}
                      <span className="font-semibold tabular-nums">{tat?.median != null ? `${tat.median} h` : "—"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">n = {tat?.n ?? 0}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Avg medications per encounter</CardTitle>
                <CardDescription>Among encounters with ≥1 Rx line</CardDescription>
              </CardHeader>
              <CardContent>
                {avgMeds?.encounters === 0 ? (
                  <EmptyHint>No encounters with prescriptions in range.</EmptyHint>
                ) : (
                  <div>
                    <p className="text-2xl font-bold tabular-nums">{avgMeds?.avg != null ? avgMeds.avg : "—"}</p>
                    <p className="text-xs text-muted-foreground">{avgMeds?.encounters ?? 0} encounters with Rx</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      {/* FINANCIAL */}
      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Financial</h3>
          <p className="text-sm text-muted-foreground">Revenue, collection mix, and insurance claims snapshot.</p>
        </div>
        {errFin ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errFin}</div>
        ) : null}
        {loadFin ? (
          <SectionLoading label="financial metrics" />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Revenue by department</CardTitle>
                  <CardDescription>Billed gross (INR)</CardDescription>
                </CardHeader>
                <CardContent className="h-[280px]">
                  {revDeptFiltered.length === 0 ? (
                    <EmptyHint>No invoice revenue in range{departmentId ? " for this department" : ""}.</EmptyHint>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={revDeptFiltered.map((r) => ({
                          name: r.department_name.length > 14 ? `${r.department_name.slice(0, 12)}…` : r.department_name,
                          full: r.department_name,
                          revenue: r.total_revenue,
                        }))}
                        margin={{ top: 8, right: 8, left: 8, bottom: 40 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatInr(Number(v))} width={56} />
                        <Tooltip
                          formatter={(value) => formatInr(typeof value === "number" ? value : Number(value))}
                          labelFormatter={(_, p) => (Array.isArray(p) && p[0]?.payload ? (p[0].payload as { full?: string }).full : "")}
                        />
                        <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Revenue by category</CardTitle>
                  <CardDescription>Billed vs collected by charge category</CardDescription>
                </CardHeader>
                <CardContent className="h-[280px]">
                  {revCat.length === 0 ? (
                    <EmptyHint>No category breakdown in range.</EmptyHint>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={revCat} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="charge_category" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatInr(Number(v))} width={48} />
                        <Tooltip formatter={(value) => formatInr(typeof value === "number" ? value : Number(value))} />
                        <Legend />
                        <Bar dataKey="total_billed" name="Billed" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="total_collected" name="Collected" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Collection efficiency</CardTitle>
                <CardDescription>Confirmed payments by method — share of total collections</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {collEff.length === 0 ? (
                  <EmptyHint>No confirmed payments in range.</EmptyHint>
                ) : (
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="pb-2 font-semibold">Method</th>
                        <th className="pb-2 text-right font-semibold">Collected</th>
                        <th className="pb-2 text-right font-semibold">Txns</th>
                        <th className="pb-2 text-right font-semibold">Share %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collEff.map((row, index) => (
                        <tr key={row.payment_method ? `${row.payment_method}-${index}` : `coll-${index}`} className="border-b border-border/60">
                          <td className="py-2 capitalize">{row.payment_method}</td>
                          <td className="py-2 text-right tabular-nums">{formatInr(row.total_collected)}</td>
                          <td className="py-2 text-right tabular-nums">{row.transaction_count}</td>
                          <td className="py-2 text-right tabular-nums">{row.share_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {errClaims ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errClaims}</div>
        ) : null}
        {claimsLoading ? (
          <SectionLoading label="claims" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Claims summary</CardTitle>
              <CardDescription>Non-draft insurance claims (hospital scope)</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {claims.length === 0 ? (
                <EmptyHint>No claims to show.</EmptyHint>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 font-semibold">Claim #</th>
                      <th className="pb-2 font-semibold">Patient</th>
                      <th className="pb-2 text-right font-semibold">Billed</th>
                      <th className="pb-2 text-right font-semibold">Approved</th>
                      <th className="pb-2 text-right font-semibold">Settled</th>
                      <th className="pb-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.slice(0, 25).map((c, index) => (
                      <tr key={c.id ? c.id : `claim-${index}`} className="border-b border-border/60">
                        <td className="py-2 font-mono text-xs">{c.claim_number ?? "—"}</td>
                        <td className="py-2">{c.patient_full_name}</td>
                        <td className="py-2 text-right tabular-nums">{c.billed_amount != null ? formatInr(c.billed_amount) : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{c.approved_amount != null ? formatInr(c.approved_amount) : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{c.settled_amount != null ? formatInr(c.settled_amount) : "—"}</td>
                        <td className="py-2 capitalize">{c.status ?? "—"}</td>
                        <td className="py-2">{c.settlement_due_date ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
