"use client";

import {
  endOfMonth,
  endOfWeek,
  format,
  formatDistanceToNow,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppRole } from "@/app/hooks/useAppRole";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PerfSummary = {
  attendance_pct: number;
  days_present: number;
  days_late: number;
  avg_late_minutes: number;
  is_doctor: boolean;
  is_nurse: boolean;
  opd_encounters: number;
  ipd_notes: number;
  prescriptions: number;
  investigations: number;
  vitals_recorded: number;
  medications_given: number;
  nursing_notes: number;
};

type CalendarDay = {
  work_date: string;
  status: string;
  arrived_at: string | null;
  active_hours: number | null;
  tooltip: string | null;
};

type ActivityRow = {
  id: string;
  occurred_at: string;
  action: string;
  resource_type: string;
  description: string | null;
  total_count: number;
};

function toYmd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

type RangePreset = "week" | "month" | "last_month" | "custom";

const ISO_DAYS = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 7, label: "Sun" },
] as const;

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

function timeToInput(v: unknown): string {
  if (v == null) return "09:00";
  const s = String(v).trim();
  if (s.length >= 5) return s.slice(0, 5);
  return "09:00";
}

function mapCalendarData(rows: Record<string, unknown>[]): CalendarDay[] {
  return rows.map((x) => ({
    work_date: String(x.work_date ?? ""),
    status: String(x.status ?? "absent"),
    arrived_at: x.arrived_at != null ? String(x.arrived_at) : null,
    active_hours: x.active_hours != null ? Number(x.active_hours) : null,
    tooltip: x.tooltip != null ? String(x.tooltip) : null,
  }));
}

function StaffShiftScheduleSection({
  practitionerId,
  onShiftSaved,
}: {
  practitionerId: string;
  onShiftSaved: () => void;
}) {
  const { role } = useAppRole();
  const isAdmin = role === "admin";

  const [loading, setLoading] = useState(true);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [dbRow, setDbRow] = useState<Record<string, unknown> | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [shiftName, setShiftName] = useState("General");
  const [startT, setStartT] = useState("09:00");
  const [endT, setEndT] = useState("17:00");
  const [workDays, setWorkDays] = useState<number[]>(() => [...DEFAULT_WORKING_DAYS]);
  const [graceMin, setGraceMin] = useState(15);

  const applyToForm = useCallback((r: Record<string, unknown> | null) => {
    if (!r) {
      setShiftName("General");
      setStartT("09:00");
      setEndT("17:00");
      setWorkDays([...DEFAULT_WORKING_DAYS]);
      setGraceMin(15);
      return;
    }
    setShiftName(String(r.shift_name ?? "General"));
    setStartT(timeToInput(r.shift_start));
    setEndT(timeToInput(r.shift_end));
    const wd = r.working_days;
    let next: number[] = [...DEFAULT_WORKING_DAYS];
    if (Array.isArray(wd)) {
      next = wd.map((x) => Number(x)).filter((n) => n >= 1 && n <= 7);
      next.sort((a, b) => a - b);
    }
    if (next.length === 0) next = [...DEFAULT_WORKING_DAYS];
    setWorkDays(next);
    const g = r.grace_period_minutes;
    setGraceMin(typeof g === "number" && Number.isFinite(g) ? g : 15);
  }, []);

  const loadShift = useCallback(
    async (shiftNameKey: string) => {
      if (!practitionerId) return;
      setLoading(true);
      const { data: pr, error: pe } = await supabase.from("practitioners").select("hospital_id").eq("id", practitionerId).maybeSingle();
      if (pe || !pr || (pr as { hospital_id?: unknown }).hospital_id == null) {
        setHospitalId(null);
        setDbRow(null);
        applyToForm(null);
        setLoading(false);
        return;
      }
      setHospitalId(String((pr as { hospital_id: string }).hospital_id));

      const { data: shift, error: se } = await supabase
        .from("staff_shifts")
        .select("*")
        .eq("practitioner_id", practitionerId)
        .eq("shift_name", shiftNameKey)
        .maybeSingle();

      if (se) {
        console.warn("[staff_shifts]", se.message);
        setDbRow(null);
        applyToForm(null);
      } else if (shift) {
        setDbRow(shift as Record<string, unknown>);
        applyToForm(shift as Record<string, unknown>);
      } else {
        setDbRow(null);
        applyToForm(null);
      }
      setLoading(false);
    },
    [practitionerId, applyToForm],
  );

  useEffect(() => {
    void loadShift("General");
  }, [practitionerId, loadShift]);

  const startEdit = () => {
    applyToForm(dbRow);
    setEditing(true);
  };

  const cancelEdit = () => {
    applyToForm(dbRow);
    setEditing(false);
  };

  const toggleDay = (d: number) => {
    setWorkDays((prev) => {
      const s = new Set(prev);
      if (s.has(d)) s.delete(d);
      else s.add(d);
      return [...s].sort((a, b) => a - b);
    });
  };

  const save = async () => {
    if (!hospitalId) {
      toast.error("Could not resolve hospital for this staff member.");
      return;
    }
    setSaving(true);
    const name = shiftName.trim() || "General";
    const pad = (t: string) => (t.length === 5 ? `${t}:00` : `${(t || "09:00").slice(0, 5)}:00`);
    const payload = {
      practitioner_id: practitionerId,
      hospital_id: hospitalId,
      shift_name: name,
      shift_start: pad(startT),
      shift_end: pad(endT),
      working_days: workDays.length ? workDays : [...DEFAULT_WORKING_DAYS],
      grace_period_minutes: Math.min(240, Math.max(0, Math.round(Number(graceMin) || 15))),
    };
    const { error } = await supabase.from("staff_shifts").upsert(payload, {
      onConflict: "practitioner_id,shift_name",
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Shift updated");
    setEditing(false);
    onShiftSaved();
    await loadShift(name);
  };

  const daySet = new Set(workDays);

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-lg">Shift Schedule</CardTitle>
          <CardDescription>Working hours, days, and grace period for attendance.</CardDescription>
        </div>
        {isAdmin && !editing ? (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={startEdit} disabled={loading}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading shift…</p>
        ) : editing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shift-name">Shift name</Label>
              <Input id="shift-name" value={shiftName} onChange={(e) => setShiftName(e.target.value)} placeholder="General" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="shift-start">Start time</Label>
                <Input id="shift-start" type="time" value={startT} onChange={(e) => setStartT(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shift-end">End time</Label>
                <Input id="shift-end" type="time" value={endT} onChange={(e) => setEndT(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium">Working days</span>
              <div className="flex flex-wrap gap-2">
                {ISO_DAYS.map(({ d, label }) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      daySet.has(d)
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift-grace">Grace period (minutes)</Label>
              <Input
                id="shift-grace"
                type="number"
                min={0}
                max={240}
                value={graceMin}
                onChange={(e) => setGraceMin(Number.parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Shift · </span>
              <span className="font-semibold text-foreground">{shiftName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Hours · </span>
              <span className="tabular-nums text-foreground">
                {startT} – {endT}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Days ·</span>
              {workDays.length ? (
                workDays.map((d) => {
                  const meta = ISO_DAYS.find((x) => x.d === d);
                  return (
                    <span
                      key={d}
                      className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-foreground dark:bg-muted/30"
                    >
                      {meta?.label ?? d}
                    </span>
                  );
                })
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Grace · </span>
              <span className="text-foreground">{graceMin} min grace</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StaffPerformanceTab({ practitionerId }: { practitionerId: string }) {
  const initialRange = useMemo(() => {
    const now = new Date();
    return {
      from: toYmd(startOfWeek(now, { weekStartsOn: 1 })),
      to: toYmd(endOfWeek(now, { weekStartsOn: 1 })),
    };
  }, []);

  const [preset, setPreset] = useState<RangePreset>("week");
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);

  const [summary, setSummary] = useState<PerfSummary | null>(null);
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 30;
  const [totalActivities, setTotalActivities] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyPresetDates = useCallback((p: RangePreset) => {
    if (p === "custom") return;
    const now = new Date();
    if (p === "week") {
      setDateFrom(toYmd(startOfWeek(now, { weekStartsOn: 1 })));
      setDateTo(toYmd(endOfWeek(now, { weekStartsOn: 1 })));
    } else if (p === "month") {
      setDateFrom(toYmd(startOfMonth(now)));
      setDateTo(toYmd(endOfMonth(now)));
    } else if (p === "last_month") {
      const lm = subMonths(now, 1);
      setDateFrom(toYmd(startOfMonth(lm)));
      setDateTo(toYmd(endOfMonth(lm)));
    }
  }, []);

  const onSelectPreset = (p: RangePreset) => {
    setPreset(p);
    if (p !== "custom") applyPresetDates(p);
  };

  useEffect(() => {
    setPage(0);
  }, [dateFrom, dateTo]);

  const refreshCalendar = useCallback(async () => {
    if (!practitionerId || !dateFrom || !dateTo) return;
    const calRes = await supabase.rpc("get_staff_attendance_calendar", {
      p_practitioner_id: practitionerId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (calRes.error) return;
    const rows = (Array.isArray(calRes.data) ? calRes.data : []) as Record<string, unknown>[];
    setCalendar(mapCalendarData(rows));
  }, [practitionerId, dateFrom, dateTo]);

  const loadAll = useCallback(async () => {
    if (!practitionerId || !dateFrom || !dateTo) return;
    setLoading(true);
    setError(null);
    const off = page * pageSize;

    const [sumRes, calRes, logRes] = await Promise.all([
      supabase.rpc("get_staff_performance_summary", {
        p_practitioner_id: practitionerId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      }),
      supabase.rpc("get_staff_attendance_calendar", {
        p_practitioner_id: practitionerId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      }),
      supabase.rpc("get_staff_activity_log", {
        p_practitioner_id: practitionerId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_limit: pageSize,
        p_offset: off,
      }),
    ]);

    setLoading(false);

    const errs: string[] = [];
    if (sumRes.error) errs.push(sumRes.error.message);
    if (calRes.error) errs.push(calRes.error.message);
    if (logRes.error) errs.push(logRes.error.message);
    setError(errs.length ? errs.join(" · ") : null);

    if (!sumRes.error) {
      const row = Array.isArray(sumRes.data) ? sumRes.data[0] : sumRes.data;
      const r = row as Record<string, unknown> | undefined;
      if (!r) {
        setSummary(null);
      } else {
        const num = (k: string) => {
          const v = r[k];
          if (typeof v === "number" && Number.isFinite(v)) return v;
          if (typeof v === "string") return Number.parseFloat(v) || 0;
          return 0;
        };
        const int = (k: string) => Math.round(num(k));
        const bool = (k: string) => Boolean(r[k]);
        setSummary({
          attendance_pct: num("attendance_pct"),
          days_present: int("days_present"),
          days_late: int("days_late"),
          avg_late_minutes: num("avg_late_minutes"),
          is_doctor: bool("is_doctor"),
          is_nurse: bool("is_nurse"),
          opd_encounters: int("opd_encounters"),
          ipd_notes: int("ipd_notes"),
          prescriptions: int("prescriptions"),
          investigations: int("investigations"),
          vitals_recorded: int("vitals_recorded"),
          medications_given: int("medications_given"),
          nursing_notes: int("nursing_notes"),
        });
      }
    } else {
      setSummary(null);
    }

    if (!calRes.error) {
      const rows = (Array.isArray(calRes.data) ? calRes.data : []) as Record<string, unknown>[];
      setCalendar(mapCalendarData(rows));
    } else {
      setCalendar([]);
    }

    if (!logRes.error) {
      const rows = (Array.isArray(logRes.data) ? logRes.data : []) as Record<string, unknown>[];
      const mapped: ActivityRow[] = rows.map((x) => ({
        id: String(x.id ?? ""),
        occurred_at: String(x.occurred_at ?? ""),
        action: String(x.action ?? ""),
        resource_type: String(x.resource_type ?? ""),
        description: x.description != null ? String(x.description) : null,
        total_count: typeof x.total_count === "number" ? x.total_count : Number.parseInt(String(x.total_count ?? "0"), 10) || 0,
      }));
      setActivities(mapped);
      setTotalActivities(mapped[0]?.total_count ?? 0);
    } else {
      setActivities([]);
      setTotalActivities(0);
    }
  }, [practitionerId, dateFrom, dateTo, page]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const monthGrid = useMemo(() => {
    if (calendar.length === 0) return { headers: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], cells: [] as (CalendarDay | null)[] };
    const first = calendar[0]?.work_date;
    if (!first) return { headers: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], cells: [] };
    const start = parseISO(first + "T12:00:00");
    if (!isValid(start)) return { headers: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], cells: [] };
    const dow = start.getDay();
    const monOffset = dow === 0 ? 6 : dow - 1;
    const cells: (CalendarDay | null)[] = [];
    for (let i = 0; i < monOffset; i++) cells.push(null);
    for (const d of calendar) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return { headers: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], cells };
  }, [calendar]);

  const totalPages = Math.max(1, Math.ceil(totalActivities / pageSize));

  return (
    <div className="space-y-6">
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Date range</CardTitle>
          <CardDescription>Applies to summary, attendance heatmap, and activity log.</CardDescription>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(
              [
                ["week", "This week"],
                ["month", "This month"],
                ["last_month", "Last month"],
              ] as const
            ).map(([k, label]) => (
              <Button key={k} type="button" size="sm" variant={preset === k ? "default" : "outline"} onClick={() => onSelectPreset(k)}>
                {label}
              </Button>
            ))}
            <Button type="button" size="sm" variant={preset === "custom" ? "default" : "outline"} onClick={() => onSelectPreset("custom")}>
              Custom
            </Button>
          </div>
          {preset === "custom" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="perf-from">From</Label>
                <Input id="perf-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="perf-to">To</Label>
                <Input id="perf-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          ) : null}
        </CardHeader>
      </Card>

      <StaffShiftScheduleSection practitionerId={practitionerId} onShiftSaved={refreshCalendar} />

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !summary ? (
        <p className="text-sm text-muted-foreground">Loading performance…</p>
      ) : summary ? (
        <>
          <div
            className={cn(
              "grid gap-4",
              summary.is_doctor ? "sm:grid-cols-2 lg:grid-cols-5" : summary.is_nurse ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3",
            )}
          >
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>Attendance</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{summary.attendance_pct.toFixed(1)}%</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {summary.days_present} present · {summary.days_late} late · Avg late {summary.avg_late_minutes.toFixed(0)} min
              </CardContent>
            </Card>
            {summary.is_doctor ? (
              <>
                <Kpi title="OPD encounters" value={summary.opd_encounters} />
                <Kpi title="IPD notes" value={summary.ipd_notes} />
                <Kpi title="Prescriptions" value={summary.prescriptions} />
                <Kpi title="Investigations" value={summary.investigations} />
              </>
            ) : summary.is_nurse ? (
              <>
                <Kpi title="Vitals recorded" value={summary.vitals_recorded} />
                <Kpi title="Medications given" value={summary.medications_given} />
                <Kpi title="Nursing notes" value={summary.nursing_notes} />
              </>
            ) : (
              <>
                <Kpi title="OPD encounters" value={summary.opd_encounters} />
                <Kpi title="IPD notes" value={summary.ipd_notes} />
              </>
            )}
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Attendance calendar</CardTitle>
              <CardDescription>Green = on time · Amber = late · Red = absent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-foreground sm:text-xs">
                {monthGrid.headers.map((h) => (
                  <div key={h} className="py-1">
                    {h}
                  </div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {monthGrid.cells.map((cell, i) => (
                  <div
                    key={i}
                    className={cn(
                      "relative flex aspect-square min-h-[2rem] flex-col items-center justify-center rounded-md border text-[10px] sm:text-xs",
                      cell == null && "border-transparent bg-transparent",
                      cell &&
                        cell.status === "present" &&
                        "border-emerald-300 bg-emerald-500/15 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
                      cell &&
                        cell.status === "late" &&
                        "border-amber-300 bg-amber-500/15 text-amber-900 dark:border-amber-700 dark:bg-amber-500/20 dark:text-amber-100",
                      cell &&
                        cell.status === "absent" &&
                        "border-red-300 bg-red-500/10 text-red-800 dark:border-red-800 dark:bg-red-500/15 dark:text-red-200",
                    )}
                    title={cell?.tooltip ?? undefined}
                  >
                    {cell ? <span className="font-semibold">{format(parseISO(cell.work_date + "T12:00:00"), "d")}</span> : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Activity log</CardTitle>
              <CardDescription>
                {totalActivities} event(s) in range · page {page + 1} of {totalPages}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity in this range.</p>
              ) : (
                <ul className="space-y-2">
                  {activities.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm dark:bg-muted/20"
                    >
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
                        {a.action}
                      </span>
                      <span className="text-xs text-muted-foreground">{a.resource_type}</span>
                      <span className="min-w-0 flex-1 text-foreground">{a.description ?? "—"}</span>
                      <time className="whitespace-nowrap text-xs text-muted-foreground" dateTime={a.occurred_at}>
                        {formatDistanceToNow(parseISO(a.occurred_at), { addSuffix: true })}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" size="sm" variant="outline" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  Previous
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : !loading ? (
        <p className="text-sm text-muted-foreground">No summary data.</p>
      ) : null}
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: number }) {
  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
