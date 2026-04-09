"use client";

import { CalendarIcon } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { endOfDay, startOfDay } from "date-fns";
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

type DxRow = { snomed_code: string; display_name: string; count: number };
type RxRow = { drug_name: string; times_prescribed: number; avg_duration: number | null };

export default function ClinicalAnalyticsPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => toYmd(startOfDay(new Date(Date.now() - 29 * 86400000))));
  const [endDate, setEndDate] = useState(() => toYmd(startOfDay(new Date())));
  const [specialty, setSpecialty] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);

  const [diagnoses, setDiagnoses] = useState<DxRow[]>([]);
  const [rx, setRx] = useState<RxRow[]>([]);
  const [tat, setTat] = useState<{ avg_tat_hours: number | null; median_tat_hours: number | null; sample_count: number } | null>(
    null,
  );
  const [avgMeds, setAvgMeds] = useState<{ avg_medications_per_encounter: number | null; encounter_with_rx_count: number } | null>(
    null,
  );

  const [dxSort, setDxSort] = useState<SortingState>([{ id: "count", desc: true }]);
  const [rxSort, setRxSort] = useState<SortingState>([{ id: "times_prescribed", desc: true }]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  const loadSpecs = useCallback(async () => {
    if (!hospitalId) return;
    const { data, error: e } = await supabase.rpc("get_clinical_specialties_for_filter", { p_hospital_id: hospitalId });
    if (!e && data) {
      setSpecialties((data as { specialty: string }[]).map((r) => r.specialty).filter(Boolean));
    }
  }, [hospitalId]);

  useEffect(() => {
    void loadSpecs();
  }, [loadSpecs]);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setError(null);
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
        ((d2.data ?? []) as Record<string, unknown>[]).map((r) => ({
          drug_name: String(r.drug_name ?? ""),
          times_prescribed: Math.trunc(n(r.times_prescribed)),
          avg_duration: r.avg_duration != null ? n(r.avg_duration) : null,
        })),
      );
      const t0 = (d3.data ?? [])[0] as Record<string, unknown> | undefined;
      setTat(
        t0
          ? {
              avg_tat_hours: t0.avg_tat_hours != null ? n(t0.avg_tat_hours) : null,
              median_tat_hours: t0.median_tat_hours != null ? n(t0.median_tat_hours) : null,
              sample_count: Math.trunc(n(t0.sample_count)),
            }
          : null,
      );
      const m0 = (d4.data ?? [])[0] as Record<string, unknown> | undefined;
      setAvgMeds(
        m0
          ? {
              avg_medications_per_encounter:
                m0.avg_medications_per_encounter != null ? n(m0.avg_medications_per_encounter) : null,
              encounter_with_rx_count: Math.trunc(n(m0.encounter_with_rx_count)),
            }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clinical analytics.");
    } finally {
      setLoading(false);
    }
  }, [hospitalId, startDate, endDate, specialty]);

  useEffect(() => {
    void load();
  }, [load]);

  const dxColumns = useMemo<ColumnDef<DxRow>[]>(
    () => [
      { accessorKey: "snomed_code", header: "SNOMED CT", cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue())}</span> },
      { accessorKey: "display_name", header: "Display" },
      {
        accessorKey: "count",
        header: () => <span className="text-right">Encounters</span>,
        cell: ({ getValue }) => <div className="text-right tabular-nums font-medium">{Math.trunc(n(getValue()))}</div>,
      },
    ],
    [],
  );

  const rxColumns = useMemo<ColumnDef<RxRow>[]>(
    () => [
      { accessorKey: "drug_name", header: "Drug (MedicationRequest line)" },
      {
        accessorKey: "times_prescribed",
        header: () => <span className="text-right">Times prescribed</span>,
        cell: ({ getValue }) => <div className="text-right tabular-nums">{Math.trunc(n(getValue()))}</div>,
      },
      {
        accessorKey: "avg_duration",
        header: () => <span className="text-right">Avg duration (numeric)</span>,
        cell: ({ getValue }) => {
          const v = getValue() as number | null;
          return <div className="text-right tabular-nums text-slate-600">{v != null ? v : "—"}</div>;
        },
      },
    ],
    [],
  );

  const dxTable = useReactTable({
    data: diagnoses,
    columns: dxColumns,
    state: { sorting: dxSort },
    onSortingChange: setDxSort,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rxTable = useReactTable({
    data: rx,
    columns: rxColumns,
    state: { sorting: rxSort },
    onSortingChange: setRxSort,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Clinical analytics</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            FHIR-aligned views: Condition/DiagnosticReport-style diagnoses, MedicationRequest-style prescribing, lab
            turnaround (ordered → resulted).
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <label className="flex w-full max-w-xs flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
            Specialty filter
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">All specialties</option>
              {specialties.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
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
        </div>
      </header>

      {!hospitalId ? <p className="text-sm text-slate-500">Sign in as hospital staff to load analytics.</p> : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Investigation TAT</CardTitle>
            <p className="text-xs text-slate-500">Mean / median hours (ordered_at → resulted_at).</p>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {loading ? "…" : tat?.avg_tat_hours != null ? `${tat.avg_tat_hours} h` : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Median {tat?.median_tat_hours != null ? `${tat.median_tat_hours} h` : "—"} · n={tat?.sample_count ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Avg medications / encounter</CardTitle>
            <p className="text-xs text-slate-500">Encounters with ≥1 prescription line.</p>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {loading ? "…" : avgMeds?.avg_medications_per_encounter != null ? avgMeds.avg_medications_per_encounter : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">Encounters counted: {avgMeds?.encounter_with_rx_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top diagnoses</CardTitle>
            <p className="text-xs text-slate-500">Top 10 SNOMED-coded conditions in range.</p>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 dark:text-slate-400">
            Sort columns below. Uses completed encounters only.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 10 diagnoses</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              {dxTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-slate-200 text-left dark:border-slate-700">
                  {hg.headers.map((h) => (
                    <th key={h.id} className="pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() ? (
                        <button
                          type="button"
                          className="ml-1 text-xs text-blue-600"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {h.column.getIsSorted() === "desc" ? "↓" : h.column.getIsSorted() === "asc" ? "↑" : "↕"}
                        </button>
                      ) : null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {dxTable.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="py-2 pr-3 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && diagnoses.length === 0 ? <p className="mt-2 text-xs text-slate-500">No diagnosis data in range.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prescription patterns</CardTitle>
          <p className="text-xs text-slate-500">Most prescribed drugs; avg duration parses numeric portion of duration text.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              {rxTable.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-slate-200 text-left dark:border-slate-700">
                  {hg.headers.map((h) => (
                    <th key={h.id} className="pb-2 pr-3 font-semibold text-slate-700 dark:text-slate-300">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() ? (
                        <button
                          type="button"
                          className="ml-1 text-xs text-blue-600"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {h.column.getIsSorted() === "desc" ? "↓" : h.column.getIsSorted() === "asc" ? "↑" : "↕"}
                        </button>
                      ) : null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {rxTable.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="py-2 pr-3 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rx.length === 0 ? <p className="mt-2 text-xs text-slate-500">No prescriptions in range.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
