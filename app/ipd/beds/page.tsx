"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAuthOrgId } from "@/app/lib/authOrg";
import {
  fetchBedAvailability,
  fetchWardCensus,
  groupBedsByWard,
  type BedAvailabilityRow,
  type WardCensusRow,
} from "@/app/lib/ipdAdmission";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function bedRowId(row: BedAvailabilityRow): string {
  return s(row.bed_id ?? row.id);
}

function isBedMaintenance(row: BedAvailabilityRow): boolean {
  const st = s(row.status).toLowerCase();
  return st === "maintenance" || row.maintenance === true;
}

function isBedOccupied(row: BedAvailabilityRow): boolean {
  if (isBedMaintenance(row)) return false;
  const st = s(row.status).toLowerCase();
  if (st === "occupied") return true;
  if (row.is_available === false || row.available === false) return true;
  if (st === "available" || st === "free" || st === "empty") return false;
  return st === "occupied" || st === "taken";
}

function isBedAvailable(row: BedAvailabilityRow): boolean {
  if (isBedMaintenance(row)) return false;
  return !isBedOccupied(row);
}

type EnrichedBed = {
  row: BedAvailabilityRow;
  occupant: WardCensusRow | null;
};

export default function IpdBedsManagementPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [bedRows, setBedRows] = useState<BedAvailabilityRow[]>([]);
  const [censusRows, setCensusRows] = useState<WardCensusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWardId, setSelectedWardId] = useState<string | "all">("all");
  const [detailBedId, setDetailBedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { orgId, error: orgErr } = await fetchAuthOrgId();
    const hid = orgId?.trim() || null;
    if (!hid || orgErr) {
      setHospitalId(null);
      setError("Could not resolve hospital.");
      setLoading(false);
      return;
    }
    setHospitalId(hid);
    setLoading(true);
    setError(null);
    try {
      const [beds, census] = await Promise.all([
        fetchBedAvailability(supabase, hid),
        fetchWardCensus(supabase, hid),
      ]);
      setBedRows(beds);
      setCensusRows(census);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load beds.");
      setBedRows([]);
      setCensusRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const censusByBedId = useMemo(() => {
    const m = new Map<string, WardCensusRow>();
    for (const c of censusRows) {
      const bid = s(c.bed_id);
      if (bid) m.set(bid, c);
    }
    return m;
  }, [censusRows]);

  const enriched: EnrichedBed[] = useMemo(() => {
    return bedRows.map((row) => {
      const bid = bedRowId(row);
      const occ = bid ? censusByBedId.get(bid) ?? null : null;
      return { row, occupant: occ };
    });
  }, [bedRows, censusByBedId]);

  const isOccupied = useCallback(
    (row: BedAvailabilityRow, occupant: WardCensusRow | null) => {
      if (isBedMaintenance(row)) return false;
      if (occupant && s(occupant.admission_id)) return true;
      return isBedOccupied(row);
    },
    [],
  );

  const summary = useMemo(() => {
    let total = 0;
    let available = 0;
    let occupied = 0;
    let maintenance = 0;
    for (const { row, occupant } of enriched) {
      total += 1;
      if (isBedMaintenance(row)) maintenance += 1;
      else if (isOccupied(row, occupant)) occupied += 1;
      else available += 1;
    }
    return { total, available, occupied, maintenance };
  }, [enriched, isOccupied]);

  const wardMap = groupBedsByWard(bedRows);
  const wardList = useMemo(() => {
    return Array.from(wardMap.values()).map((w) => {
      const beds = w.beds;
      const total = beds.length;
      const avail = beds.filter((b) => {
        const bid = bedRowId(b);
        const occ = isOccupied(b, bid ? censusByBedId.get(bid) ?? null : null);
        return !isBedMaintenance(b) && !occ;
      }).length;
      return { ...w, totalBeds: total, availableBeds: avail };
    });
  }, [wardMap, censusByBedId, isOccupied]);

  const displayBeds = useMemo(() => {
    if (selectedWardId === "all") return enriched;
    return enriched.filter((e) => s(e.row.ward_id) === selectedWardId);
  }, [enriched, selectedWardId]);

  const detail = useMemo(() => {
    if (!detailBedId) return null;
    return enriched.find((e) => bedRowId(e.row) === detailBedId) ?? null;
  }, [detailBedId, enriched]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Loading bed map…
      </div>
    );
  }

  if (error && !bedRows.length) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Bed management</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Ward occupancy and bed status</p>
          </div>
          <Link
            href="/dashboard/ipd"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Back to IPD
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <div className="mb-4 flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <span>
            <span className="text-slate-500 dark:text-slate-400">Total</span>{" "}
            <span className="font-bold text-slate-900 dark:text-white">{summary.total}</span>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>
            <span className="text-emerald-600 dark:text-emerald-400">Available</span>{" "}
            <span className="font-bold">{summary.available}</span>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>
            <span className="text-blue-600 dark:text-blue-400">Occupied</span>{" "}
            <span className="font-bold">{summary.occupied}</span>
          </span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>
            <span className="text-amber-600 dark:text-amber-400">Maintenance</span>{" "}
            <span className="font-bold">{summary.maintenance}</span>
          </span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <aside className="w-full shrink-0 lg:w-[200px]">
            <nav className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => {
                  setSelectedWardId("all");
                  setDetailBedId(null);
                }}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition",
                  selectedWardId === "all"
                    ? "bg-blue-600 text-white"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
                )}
              >
                All wards
              </button>
              {wardList.map((w) => (
                <button
                  key={w.wardId}
                  type="button"
                  onClick={() => {
                    setSelectedWardId(w.wardId);
                    setDetailBedId(null);
                  }}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition",
                    selectedWardId === w.wardId
                      ? "bg-blue-600 font-semibold text-white"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
                  )}
                >
                  <span className="block truncate">{w.wardName}</span>
                  <span className="mt-0.5 block text-xs opacity-80">
                    {w.availableBeds}/{w.totalBeds}
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {displayBeds.map(({ row, occupant }) => {
                const bid = bedRowId(row);
                const maint = isBedMaintenance(row);
                const occ = maint ? false : isOccupied(row, occupant);
                const avail = !maint && !occ;
                const los =
                  occupant &&
                  (typeof occupant.length_of_stay_days === "number"
                    ? occupant.length_of_stay_days
                    : typeof occupant.los_days === "number"
                      ? occupant.los_days
                      : null);
                const showDetail = detailBedId === bid && occ;

                return (
                  <div key={bid || `${s(row.ward_id)}-${s(row.bed_number)}`} className="relative">
                    <button
                      type="button"
                      disabled={!occ}
                      onClick={() => {
                        if (occ && bid) setDetailBedId((prev) => (prev === bid ? null : bid));
                      }}
                      className={cn(
                        "w-full rounded-xl border px-3 py-3 text-left text-sm shadow-sm transition",
                        maint &&
                          "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
                        occ &&
                          "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100",
                        avail &&
                          "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
                        occ && "cursor-pointer hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-700",
                        !occ && "cursor-default",
                      )}
                    >
                      <p className="font-bold">{s(row.bed_number) || "—"}</p>
                      <p className="text-xs opacity-80">{s(row.bed_type) || "Bed"}</p>
                      {maint ? (
                        <p className="mt-1 text-xs font-semibold">Maintenance</p>
                      ) : occ ? (
                        <>
                          <p className="mt-1 truncate text-xs font-medium">
                            {s(occupant?.patient_name) || "Occupied"}
                          </p>
                          {los != null ? (
                            <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900 dark:bg-blue-900/50 dark:text-blue-100">
                              Day {Math.max(1, Math.round(los))}
                            </span>
                          ) : null}
                          <p className="mt-1 truncate text-[11px] opacity-80">
                            {s(occupant?.admitting_doctor_name ?? occupant?.doctor_name) || ""}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-xs font-medium text-emerald-800 dark:text-emerald-200">Available</p>
                      )}
                    </button>

                    {showDetail && occupant ? (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl dark:border-slate-600 dark:bg-slate-900">
                        <p className="font-semibold text-slate-900 dark:text-white">{s(occupant.patient_name)}</p>
                        <p className="mt-1 text-slate-600 dark:text-slate-300">
                          {occupant.age_years != null ? `${Math.round(Number(occupant.age_years))} yrs` : "—"}
                          {occupant.sex || occupant.gender ? ` · ${s(occupant.sex ?? occupant.gender)}` : ""}
                        </p>
                        <p className="mt-1 line-clamp-2 text-slate-700 dark:text-slate-300">
                          {s(occupant.primary_diagnosis_display) || "—"}
                        </p>
                        <p className="mt-1 text-slate-500">
                          Admitted:{" "}
                          {occupant.admitted_at
                            ? new Date(s(occupant.admitted_at)).toLocaleDateString()
                            : "—"}
                        </p>
                        <p className="text-slate-600 dark:text-slate-400">
                          {s(occupant.admitting_doctor_name ?? occupant.doctor_name) || "—"}
                        </p>
                        {s(occupant.admission_id) ? (
                          <Button asChild size="sm" className="mt-2 w-full">
                            <Link href={`/dashboard/ipd/${encodeURIComponent(s(occupant.admission_id))}`}>
                              Open file
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
