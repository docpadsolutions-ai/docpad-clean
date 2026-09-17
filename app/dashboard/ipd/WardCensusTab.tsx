"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWardCensus, type WardCensusRow } from "@/lib/ipdAdmission";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { PatientAvatar } from "@/components/patient/patient-avatar";
import { patientIdsWithSimilarNamePeer } from "@/lib/patientNameSimilarity";
import { cn } from "../../../lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fullNameLastFirst(
  first: string | undefined,
  last: string | undefined,
  full: string | undefined,
): string {
  const f = s(first);
  const l = s(last);
  const fn = s(full);
  if (l && f) return `${l}, ${f}`;
  if (fn) {
    const parts = fn.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 1]!}, ${parts.slice(0, -1).join(" ")}`;
    return fn;
  }
  if (l) return l;
  if (f) return f;
  return "—";
}

function ageFromDob(iso: string | undefined): number | null {
  if (!iso?.trim()) return null;
  const raw = iso.trim();
  const d = new Date(raw.length <= 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
}

function naturalBedSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Higher MEWS / alert tiers first, then by bed number. */
function mewsTier(row: WardCensusRow): number {
  const sc = toNum(row.mews_score);
  const lv = s(row.mews_alert_level).toLowerCase();
  if (sc != null && sc >= 5) return 0;
  if (lv === "red" || lv === "critical") return 0;
  if (sc != null && sc >= 3 && sc <= 4) return 1;
  if (lv === "yellow" || lv === "escalate") return 1;
  return 2;
}

function sortWardRows(items: WardCensusRow[]): WardCensusRow[] {
  return [...items].sort((a, b) => {
    const ta = mewsTier(a);
    const tb = mewsTier(b);
    if (ta !== tb) return ta - tb;
    const sa = toNum(a.mews_score) ?? -1;
    const sb = toNum(b.mews_score) ?? -1;
    if (sa !== sb) return sb - sa;
    return naturalBedSort(s(a.bed_number), s(b.bed_number));
  });
}

function normalizeCensusRow(raw: Record<string, unknown>): WardCensusRow {
  const base: WardCensusRow = { ...raw };
  base.ward_id = raw.ward_id != null ? s(raw.ward_id) : undefined;
  base.ward_name = raw.ward_name != null ? s(raw.ward_name) : undefined;
  base.admission_id = s(raw.admission_id ?? raw.id);
  base.patient_id = s(raw.patient_id);
  base.full_name = raw.full_name != null ? s(raw.full_name) : undefined;
  base.first_name = raw.first_name != null ? s(raw.first_name) : undefined;
  base.last_name = raw.last_name != null ? s(raw.last_name) : undefined;
  base.patient_name = s(raw.patient_name ?? raw.full_name);
  base.primary_diagnosis_display = s(raw.primary_diagnosis_display ?? raw.diagnosis_display);
  base.length_of_stay_days = toNum(raw.length_of_stay_days ?? raw.los_days ?? raw.hospital_day) ?? undefined;
  base.los_days = toNum(raw.los_days) ?? undefined;
  base.date_of_birth = raw.date_of_birth != null ? s(raw.date_of_birth) : undefined;
  base.bp_systolic = toNum(raw.bp_systolic) ?? undefined;
  base.bp_diastolic = toNum(raw.bp_diastolic) ?? undefined;
  base.heart_rate = toNum(raw.heart_rate) ?? undefined;
  base.pulse = toNum(raw.pulse ?? raw.heart_rate) ?? undefined;
  base.blood_pressure = raw.blood_pressure != null ? s(raw.blood_pressure) : raw.bp != null ? s(raw.bp) : undefined;
  base.spo2 = toNum(raw.spo2) ?? undefined;
  base.temperature = toNum(raw.temperature) ?? undefined;
  base.age_years = toNum(raw.age_years) ?? undefined;
  base.sex = s(raw.sex ?? raw.gender);
  base.latest_vitals_at =
    raw.latest_vitals_at != null && String(raw.latest_vitals_at).trim() !== ""
      ? s(raw.latest_vitals_at)
      : null;
  base.mews_score = toNum(raw.mews_score);
  base.mews_alert_level = raw.mews_alert_level != null ? String(raw.mews_alert_level) : null;
  return base;
}

function rowMatchesAlertsOnly(row: WardCensusRow): boolean {
  const lv = s(row.mews_alert_level).toLowerCase();
  return lv === "red" || lv === "yellow" || lv === "critical" || lv === "escalate";
}

function isRedMewsRow(row: WardCensusRow): boolean {
  const sc = toNum(row.mews_score);
  const lv = s(row.mews_alert_level).toLowerCase();
  return (sc != null && sc >= 5) || lv === "red" || lv === "critical";
}

function CensusVitalsCell({ row }: { row: WardCensusRow }) {
  if (!s(row.latest_vitals_at)) {
    return <span className="text-xs text-slate-400">No vitals</span>;
  }
  const pulse = toNum(row.pulse ?? row.heart_rate);
  const bp = s(row.blood_pressure);
  const spo2 = toNum(row.spo2);
  const temp = toNum(row.temperature);
  return (
    <div className="flex min-w-[128px] flex-col gap-0.5 py-0.5 text-xs leading-snug text-slate-700">
      <span>{pulse != null ? `${Math.round(pulse)} bpm` : "— bpm"}</span>
      <span>{bp || "—"}</span>
      <span>{spo2 != null ? `${Math.round(spo2)}%` : "—"}</span>
      <span>{temp != null ? `${temp.toFixed(1)}°C` : "—"}</span>
    </div>
  );
}

function CensusMewsBadge({ row }: { row: WardCensusRow }) {
  if (!s(row.latest_vitals_at)) {
    return <span className="text-sm font-medium text-slate-400">—</span>;
  }
  const score = toNum(row.mews_score);
  if (score == null) {
    return <span className="text-sm font-medium text-slate-400">—</span>;
  }
  const lv = s(row.mews_alert_level).toLowerCase();
  const isRed = score >= 5 || lv === "red" || lv === "critical";
  const isAmber = (score >= 3 && score <= 4) || lv === "yellow" || lv === "escalate" || lv === "amber";
  if (isRed) {
    return (
      <span className="inline-flex min-w-[4.5rem] items-center justify-center rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold tabular-nums text-white">
        {score} RRT
      </span>
    );
  }
  if (isAmber) {
    return (
      <span className="inline-flex min-w-[5.5rem] items-center justify-center rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold tabular-nums text-amber-950">
        {score} Escalate
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-bold tabular-nums text-emerald-950">
      {score}
    </span>
  );
}

export default function WardCensusTab({ hospitalId }: { hospitalId: string | null }) {
  const router = useRouter();
  const [rows, setRows] = useState<WardCensusRow[]>([]);
  const [alertsOnly, setAlertsOnly] = useState(false);
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

  const processedRows = useMemo(() => {
    if (!alertsOnly) return rows;
    return rows.filter((r) => rowMatchesAlertsOnly(r));
  }, [rows, alertsOnly]);

  const grouped = useMemo(() => {
    const m = new Map<string, { wardName: string; items: WardCensusRow[] }>();
    for (const r of processedRows) {
      const wname = s(r.ward_name) || "Ward";
      if (!m.has(wname)) m.set(wname, { wardName: wname, items: [] });
      m.get(wname)!.items.push(r);
    }
    const out = Array.from(m.values()).map((v) => ({
      ...v,
      items: sortWardRows(v.items),
    }));
    out.sort((a, b) => a.wardName.localeCompare(b.wardName));
    return out;
  }, [processedRows]);

  if (!hospitalId?.trim()) {
    return <p className="text-sm text-slate-500">Loading organization…</p>;
  }

  if (loading) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
        No active admissions
      </div>
    );
  }

  if (alertsOnly && processedRows.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setAlertsOnly(false)}>
            Show all patients
          </Button>
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-12 text-center text-sm text-slate-500">
          No patients with MEWS alert level red or yellow.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant={alertsOnly ? "default" : "outline"}
          className={alertsOnly ? "bg-rose-700 hover:bg-rose-700/90" : ""}
          onClick={() => setAlertsOnly((v) => !v)}
        >
          🔴 Alerts only
        </Button>
      </div>
      {grouped.map((g) => {
        const occupied = g.items.length;

        const similarAdmissionIds = patientIdsWithSimilarNamePeer(
          g.items.map((r) => ({
            id: s(r.admission_id),
            fullName: fullNameLastFirst(r.first_name, r.last_name, r.full_name ?? r.patient_name),
          })),
        );

        return (
          <section key={g.wardName} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-base font-bold text-slate-900">{g.wardName}</h3>
              <p className="text-xs text-slate-600">Occupied {occupied}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-3 py-2.5 pl-4">Bed</th>
                    <th className="px-3 py-2.5">Patient</th>
                    <th className="px-3 py-2.5">Diagnosis</th>
                    <th className="px-3 py-2.5">LOS</th>
                    <th className="min-w-[128px] px-3 py-2.5">Vitals</th>
                    <th className="min-w-[120px] px-3 py-2.5 pr-4">MEWS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {g.items.map((row, idx) => {
                    const admId = s(row.admission_id);
                    const displayName = fullNameLastFirst(row.first_name, row.last_name, row.full_name ?? row.patient_name);
                    const age = ageFromDob(row.date_of_birth) ?? toNum(row.age_years);
                    const sex = s(row.sex);
                    const pidForAvatar = s(row.patient_id) || admId;
                    const los = toNum(row.los_days ?? row.length_of_stay_days);
                    const redRow = isRedMewsRow(row);

                    return (
                      <tr
                        key={`${admId}-${idx}`}
                        role="link"
                        tabIndex={0}
                        className={cn(
                          "cursor-pointer bg-white transition-colors hover:bg-slate-50",
                          redRow && "border-l-4 border-rose-600 bg-rose-50/40",
                          !redRow &&
                            similarAdmissionIds.has(admId) &&
                            "border-l-4 border-amber-400 bg-amber-50/80",
                        )}
                        onClick={() => {
                          if (admId) router.push(`/ipd/admissions/${encodeURIComponent(admId)}`);
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && admId) {
                            e.preventDefault();
                            router.push(`/ipd/admissions/${encodeURIComponent(admId)}`);
                          }
                        }}
                      >
                        <td className="px-3 py-3 pl-4 font-medium text-slate-900">{s(row.bed_number) || "—"}</td>
                        <td className="max-w-[260px] px-3 py-3 text-slate-800">
                          <div className="flex min-w-0 items-start gap-2">
                            <span className="shrink-0 pt-0.5">
                              <PatientAvatar patientId={pidForAvatar} patientName={displayName} size="sm" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium" title={displayName}>
                                {displayName}
                                {similarAdmissionIds.has(admId) ? (
                                  <span
                                    className="ml-1 inline-block text-amber-700"
                                    title="Similar name to another patient in this ward list"
                                    aria-label="Similar name warning"
                                  >
                                    ⚠️
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {sex ? `${sex}` : "—"}
                                {age != null ? ` · ${age}y` : ""}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="max-w-[240px] truncate px-3 py-3 text-slate-700">
                          {s(row.primary_diagnosis_display) || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                          {los != null ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                              Day {Math.max(1, Math.round(los))}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <CensusVitalsCell row={row} />
                        </td>
                        <td className="px-3 py-2 pr-4 align-top">
                          <CensusMewsBadge row={row} />
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
