"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Heart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchWardCensus, type WardCensusRow } from "@/app/lib/ipdAdmission";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function vitalsValueClass(bad: boolean): string {
  return bad ? "font-semibold text-red-600" : "text-slate-700";
}

function CensusVitalsCell({ row }: { row: WardCensusRow }) {
  const hr = toNum(row.heart_rate);
  const sys = toNum(row.bp_systolic);
  const dia = toNum(row.bp_diastolic);
  const hrBad = hr != null && (hr < 50 || hr > 100);
  const sysBad = sys != null && (sys > 160 || sys < 90);
  const bpText =
    sys == null && dia == null ? "—" : `${sys == null ? "—" : String(Math.round(sys))}/${dia == null ? "—" : String(Math.round(dia))}`;

  return (
    <div className="flex min-w-[100px] flex-col gap-0.5 py-0.5">
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-0.5 inline-flex shrink-0 text-rose-400" aria-hidden>
          <Heart className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className={`min-w-0 text-xs leading-tight ${vitalsValueClass(hrBad)}`}>
          {hr == null ? "—" : `${Math.round(hr)}`} bpm
        </span>
      </div>
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-0.5 inline-flex shrink-0 text-violet-400" aria-hidden>
          <Activity className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className={`min-w-0 text-xs leading-tight ${vitalsValueClass(sysBad)}`}>{bpText} mmHg</span>
      </div>
    </div>
  );
}

function normalizeCensusRow(raw: Record<string, unknown>): WardCensusRow {
  const base: WardCensusRow = { ...raw };
  base.ward_id = raw.ward_id != null ? s(raw.ward_id) : undefined;
  base.ward_name = raw.ward_name != null ? s(raw.ward_name) : undefined;
  base.admission_id = s(raw.admission_id ?? raw.id);
  base.patient_name = s(raw.patient_name ?? raw.full_name);
  base.primary_diagnosis_display = s(raw.primary_diagnosis_display ?? raw.diagnosis_display);
  base.length_of_stay_days = toNum(raw.length_of_stay_days ?? raw.los_days ?? raw.hospital_day) ?? undefined;
  base.los_days = toNum(raw.los_days) ?? undefined;
  base.bp_systolic = toNum(raw.bp_systolic) ?? undefined;
  base.bp_diastolic = toNum(raw.bp_diastolic) ?? undefined;
  base.heart_rate = toNum(raw.heart_rate) ?? undefined;
  base.age_years = toNum(raw.age_years) ?? undefined;
  base.sex = s(raw.sex ?? raw.gender);
  base.admitting_doctor_name = s(raw.admitting_doctor_name ?? raw.doctor_name);
  return base;
}

export default function WardCensusTab({ hospitalId }: { hospitalId: string | null }) {
  const [rows, setRows] = useState<WardCensusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const hid = hospitalId?.trim();
    if (!hid) {
      setRows([]);
      setLoading(false);
      setError("No hospital context.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await fetchWardCensus(supabase, hid);
      setRows(list.map((r) => normalizeCensusRow(r as Record<string, unknown>)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load census.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<string, { wardName: string; items: WardCensusRow[] }>();
    for (const r of rows) {
      const wid = s(r.ward_id) || "_";
      const wname = s(r.ward_name) || "Ward";
      if (!m.has(wid)) m.set(wid, { wardName: wname, items: [] });
      m.get(wid)!.items.push(r);
    }
    return Array.from(m.entries()).map(([wardId, v]) => ({ wardId, ...v }));
  }, [rows]);

  if (!hospitalId?.trim()) {
    return <p className="text-sm text-slate-500">Loading organization…</p>;
  }

  if (loading) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
        No active admissions
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {grouped.map((g) => {
        const occupied = g.items.length;
        const totalHint = g.items[0]
          ? toNum(
              (g.items[0] as { ward_capacity?: unknown; ward_total_beds?: unknown; total_beds?: unknown })
                .ward_capacity ??
                (g.items[0] as { ward_total_beds?: unknown }).ward_total_beds ??
                (g.items[0] as { total_beds?: unknown }).total_beds,
            )
          : null;
        const total = totalHint != null && totalHint > 0 ? Math.round(totalHint) : occupied;

        return (
          <section
            key={g.wardId}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="border-b border-slate-100 bg-slate-50/90 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{g.wardName}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Occupied {occupied} / {total} beds
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] table-fixed border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                    <th className="px-3 py-2.5 pl-4">Bed</th>
                    <th className="px-3 py-2.5">Patient</th>
                    <th className="px-3 py-2.5">Age/Sex</th>
                    <th className="px-3 py-2.5">Diagnosis</th>
                    <th className="px-3 py-2.5">LOS</th>
                    <th className="min-w-[100px] px-3 py-2.5">Vitals</th>
                    <th className="px-3 py-2.5">Doctor</th>
                    <th className="px-3 py-2.5 pr-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {g.items.map((row, idx) => {
                    const admId = s(row.admission_id);
                    const los =
                      toNum(row.length_of_stay_days ?? row.los_days) ??
                      (row.admitted_at
                        ? Math.max(
                            1,
                            Math.ceil(
                              (Date.now() - new Date(s(row.admitted_at)).getTime()) / (86400 * 1000),
                            ),
                          )
                        : null);
                    const age = toNum(row.age_years);
                    const sex = s(row.sex);
                    return (
                      <tr key={`${admId}-${idx}`} className="bg-white dark:bg-slate-900">
                        <td className="px-3 py-3 pl-4 font-medium text-slate-900 dark:text-slate-100">
                          {s(row.bed_number) || "—"}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-3 text-slate-800 dark:text-slate-200">
                          {s(row.patient_name) || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">
                          {age != null ? `${Math.round(age)}` : "—"}
                          {sex ? ` / ${sex}` : ""}
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-3 text-slate-700 dark:text-slate-300">
                          {s(row.primary_diagnosis_display) || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-300">
                          {los != null ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                              Day {Math.max(1, Math.round(los))}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <CensusVitalsCell row={row} />
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-3 text-slate-700 dark:text-slate-300">
                          {s(row.admitting_doctor_name) || "—"}
                        </td>
                        <td className="px-3 py-3 pr-4 text-right">
                          {admId ? (
                            <Button asChild size="sm" variant="outline" className="h-8">
                              <Link href={`/dashboard/ipd/${encodeURIComponent(admId)}`}>Open</Link>
                            </Button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
