"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/supabase";
import { fetchHospitalIdFromPractitionerAuthId } from "../../../lib/authOrg";
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

function isBedHeld(row: BedAvailabilityRow): boolean {
  return s(row.status).toLowerCase() === "held";
}

function isBedOccupied(row: BedAvailabilityRow): boolean {
  if (isBedMaintenance(row) || isBedHeld(row)) return false;
  const st = s(row.status).toLowerCase();
  if (st === "occupied") return true;
  if (row.is_available === false || row.available === false) return true;
  if (st === "available" || st === "free" || st === "empty") return false;
  return st === "occupied" || st === "taken";
}

function parseMaintenanceUntil(row: BedAvailabilityRow): number | null {
  const v = (row as { maintenance_until?: unknown }).maintenance_until;
  if (v == null || v === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Countdown label e.g. "Ready in 23 mins" */
function readyInMinutesLabel(untilMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.ceil((untilMs - nowMs) / 60000));
  return `Ready in ${mins} min${mins === 1 ? "" : "s"}`;
}

type EnrichedBed = {
  row: BedAvailabilityRow;
  occupant: WardCensusRow | null;
};

const btnPrimary =
  "inline-flex items-center justify-center rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40";

const btnSecondary =
  "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:opacity-40";

function StatsCardsSkeleton() {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-gray-100 bg-white p-4">
          <div className="h-3 w-24 rounded bg-gray-200" />
          <div className="mt-3 h-9 w-16 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

function BedGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 15 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div className="h-5 w-12 rounded bg-gray-200" />
          <div className="mt-2 h-3 w-20 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

export default function ReceptionBedsPage() {
  const router = useRouter();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [bedRows, setBedRows] = useState<BedAvailabilityRow[]>([]);
  const [censusRows, setCensusRows] = useState<WardCensusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedWardId, setSelectedWardId] = useState<string | "all">("all");
  const [popoverAvailBid, setPopoverAvailBid] = useState<string | null>(null);
  const [popoverOccBid, setPopoverOccBid] = useState<string | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAdmissionId, setTransferAdmissionId] = useState<string | null>(null);
  const [transferFromBedId, setTransferFromBedId] = useState<string | null>(null);
  const [transferToWardId, setTransferToWardId] = useState("");
  const [transferToBedId, setTransferToBedId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [bedClock, setBedClock] = useState(() => Date.now());
  const [releasingBedId, setReleasingBedId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setBedClock(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const { hospitalId: hid, error } = await fetchHospitalIdFromPractitionerAuthId();
    if (error) setOrgError(error.message);
    const id = hid?.trim() || null;
    setHospitalId(id);
    if (!id) {
      if (!silent) setLoading(false);
      setFetchError("Your account is not linked to a hospital.");
      return;
    }
    if (!silent) {
      setLoading(true);
      setFetchError(null);
    } else {
      setRefreshing(true);
    }
    try {
      const [beds, census] = await Promise.all([
        fetchBedAvailability(supabase, id),
        fetchWardCensus(supabase, id),
      ]);
      setBedRows(beds);
      setCensusRows(census);
      setFetchError(null);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : "Could not load beds.");
      setBedRows([]);
      setCensusRows([]);
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("bed-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ipd_beds" },
        () => {
          void load({ silent: true });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hospitalId, load]);

  /** Census rows from `get_ward_census` are joined to `get_bed_availability` beds by `bed_id` (ward is implicit on each bed). */
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

  const isOccupied = useCallback((row: BedAvailabilityRow, occupant: WardCensusRow | null) => {
    if (isBedMaintenance(row) || isBedHeld(row)) return false;
    if (occupant && s(occupant.admission_id)) return true;
    return isBedOccupied(row);
  }, []);

  const summary = useMemo(() => {
    let total = 0;
    let available = 0;
    let held = 0;
    let occupied = 0;
    for (const { row, occupant } of enriched) {
      total += 1;
      if (isBedMaintenance(row)) continue;
      if (isBedHeld(row)) held += 1;
      else if (isOccupied(row, occupant)) occupied += 1;
      else available += 1;
    }
    return { total, available, held, occupied };
  }, [enriched, isOccupied]);

  const wardMap = groupBedsByWard(bedRows);
  const wardList = useMemo(() => {
    return Array.from(wardMap.values()).map((w) => {
      const beds = w.beds;
      const total = beds.length;
      const avail = beds.filter((b) => {
        const bid = bedRowId(b);
        const occ = isOccupied(b, bid ? censusByBedId.get(bid) ?? null : null);
        return !isBedMaintenance(b) && !isBedHeld(b) && !occ;
      }).length;
      return { ...w, totalBeds: total, availableBeds: avail };
    });
  }, [wardMap, censusByBedId, isOccupied]);

  const displayBeds = useMemo(() => {
    if (selectedWardId === "all") return enriched;
    return enriched.filter((e) => s(e.row.ward_id) === selectedWardId);
  }, [enriched, selectedWardId]);

  const losDays = useCallback((occ: WardCensusRow | null) => {
    if (!occ) return null;
    const n =
      typeof occ.length_of_stay_days === "number"
        ? occ.length_of_stay_days
        : typeof occ.los_days === "number"
          ? occ.los_days
          : null;
    if (n != null && Number.isFinite(n)) return Math.max(1, Math.round(n));
    const adm = s(occ.admitted_at);
    if (!adm) return null;
    const d = new Date(adm);
    if (Number.isNaN(d.getTime())) return null;
    const days = Math.ceil((Date.now() - d.getTime()) / 86400000);
    return Math.max(1, days);
  }, []);

  const admissionNumber = useCallback((occ: WardCensusRow) => {
    return (
      s(occ.admission_number) ||
      s((occ as { ipd_admission_number?: unknown }).ipd_admission_number) ||
      s((occ as { admission_ref?: unknown }).admission_ref) ||
      "—"
    );
  }, []);

  const freeBedsInWard = useCallback(
    (wardId: string, excludeBedId: string | null) => {
      return enriched.filter((e) => {
        if (s(e.row.ward_id) !== wardId) return false;
        const bid = bedRowId(e.row);
        if (excludeBedId && bid === excludeBedId) return false;
        if (isBedMaintenance(e.row) || isBedHeld(e.row)) return false;
        return !isOccupied(e.row, e.occupant);
      });
    },
    [enriched, isOccupied],
  );

  function heldPatientLabel(row: BedAvailabilityRow, occ: WardCensusRow | null): string {
    const fromRow = s((row as { patient_name?: unknown }).patient_name);
    if (fromRow) return fromRow;
    return s(occ?.patient_name) || "—";
  }

  function heldAdmissionLabel(row: BedAvailabilityRow, occ: WardCensusRow | null): string {
    const fromRow = s(
      (row as { admission_number?: unknown }).admission_number ??
        (row as { admission_no?: unknown }).admission_no,
    );
    if (fromRow) return fromRow;
    return (
      s((occ as { admission_number?: unknown })?.admission_number) ||
      s((occ as { ipd_admission_number?: unknown })?.ipd_admission_number) ||
      "—"
    );
  }

  async function submitTransfer() {
    setTransferError(null);
    const adm = transferAdmissionId?.trim();
    const toW = transferToWardId.trim();
    const toB = transferToBedId.trim();
    const reason = transferReason.trim();
    if (!adm || !toW || !toB) {
      setTransferError("Select destination ward and bed.");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setTransferError("Not signed in.");
      return;
    }
    setTransferSubmitting(true);
    const { error } = await supabase.rpc("transfer_bed", {
      p_admission_id: adm,
      p_to_ward_id: toW,
      p_to_bed_id: toB,
      p_reason: reason || null,
      p_transferred_by: uid,
    });
    setTransferSubmitting(false);
    if (error) {
      setTransferError(error.message);
      return;
    }
    setTransferOpen(false);
    setTransferAdmissionId(null);
    setTransferFromBedId(null);
    setTransferToWardId("");
    setTransferToBedId("");
    setTransferReason("");
    setPopoverOccBid(null);
    void load({ silent: true });
  }

  const releaseFromMaintenance = useCallback(
    async (bedId: string) => {
      if (!hospitalId) return;
      setReleasingBedId(bedId);
      setFetchError(null);
      const { error } = await supabase.rpc("release_bed_from_maintenance", {
        p_bed_id: bedId,
        p_hospital_id: hospitalId,
      });
      setReleasingBedId(null);
      if (error) {
        setFetchError(error.message);
        return;
      }
      void load({ silent: true });
    },
    [hospitalId, load],
  );

  function openTransferFromPopover(occ: WardCensusRow, fromBedId: string) {
    const adm = s(occ.admission_id);
    if (!adm) return;
    setTransferAdmissionId(adm);
    setTransferFromBedId(fromBedId);
    setTransferError(null);
    setTransferReason("");
    const withFree = wardList.find((w) => freeBedsInWard(w.wardId, fromBedId).length > 0);
    const wId = withFree?.wardId ?? wardList[0]?.wardId ?? "";
    setTransferToWardId(wId);
    const firstFree = freeBedsInWard(wId, fromBedId)[0];
    setTransferToBedId(firstFree ? bedRowId(firstFree.row) : "");
    setTransferOpen(true);
    setPopoverOccBid(null);
  }

  useEffect(() => {
    if (!transferOpen || !transferToWardId) return;
    const options = freeBedsInWard(transferToWardId, transferFromBedId);
    if (options.length === 0) {
      setTransferToBedId("");
      return;
    }
    const stillValid = options.some((e) => bedRowId(e.row) === transferToBedId);
    if (!stillValid) {
      setTransferToBedId(bedRowId(options[0].row));
    }
  }, [transferOpen, transferToWardId, transferFromBedId, transferToBedId, freeBedsInWard]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Bed management</h1>
            <p className="mt-1 text-sm text-gray-600">Live ward map and transfers — reception portal</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnSecondary}
              disabled={refreshing || loading}
              onClick={() => void load({ silent: true })}
              aria-label="Refresh bed data"
            >
              <RefreshCw className={cn("mr-2 inline h-4 w-4", refreshing && "animate-spin")} />
              Refresh
            </button>
            <Link href="/reception" className={btnSecondary}>
              ← Reception queue
            </Link>
          </div>
        </header>

        {orgError ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {orgError}
          </div>
        ) : null}

        {loading && bedRows.length === 0 ? (
          <StatsCardsSkeleton />
        ) : (
          <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ["Total", summary.total, "text-gray-900"],
                ["Available", summary.available, "text-emerald-700"],
                ["Held", summary.held, "text-amber-700"],
                ["Occupied", summary.occupied, "text-blue-700"],
              ] as const
            ).map(([label, n, color]) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
                <p className={cn("mt-1 text-3xl font-bold tabular-nums", color)}>{n}</p>
              </div>
            ))}
          </section>
        )}

        {fetchError ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{fetchError}</div>
        ) : null}

        <div className="flex flex-col gap-4 lg:flex-row">
          <aside className="w-full shrink-0 lg:w-[220px]">
            <nav className="space-y-1 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
              <button
                type="button"
                onClick={() => {
                  setSelectedWardId("all");
                  setPopoverAvailBid(null);
                  setPopoverOccBid(null);
                }}
                className={cn(
                  "w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition",
                  selectedWardId === "all"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-700 hover:bg-gray-50",
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
                    setPopoverAvailBid(null);
                    setPopoverOccBid(null);
                  }}
                  className={cn(
                    "w-full rounded-xl px-3 py-2.5 text-left text-sm transition",
                    selectedWardId === w.wardId
                      ? "bg-blue-600 font-semibold text-white shadow-sm"
                      : "text-gray-700 hover:bg-gray-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{w.wardName}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {w.wardType ? (
                      <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                        {w.wardType}
                      </span>
                    ) : null}
                    <span className="text-xs text-gray-500">
                      {w.availableBeds}/{w.totalBeds}
                    </span>
                  </div>
                </button>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 flex-1">
            {loading && bedRows.length === 0 ? (
              <BedGridSkeleton />
            ) : (
              <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {displayBeds.map(({ row, occupant }) => {
                  const bid = bedRowId(row);
                  const maint = isBedMaintenance(row);
                  const held = isBedHeld(row);
                  const isOcc = !maint && !held && isOccupied(row, occupant);
                  const avail = !maint && !held && !isOcc;
                  const los = isOcc ? losDays(occupant) : null;
                  const showAvailPop = popoverAvailBid === bid;
                  const showOccPop = popoverOccBid === bid;

                  return (
                    <div key={bid || `${s(row.ward_id)}-${s(row.bed_number)}`} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (maint || held) return;
                          if (isOcc) {
                            setPopoverAvailBid(null);
                            setPopoverOccBid((p) => (p === bid ? null : bid));
                          } else if (avail) {
                            setPopoverOccBid(null);
                            setPopoverAvailBid((p) => (p === bid ? null : bid));
                          }
                        }}
                        className={cn(
                          "relative w-full rounded-xl border px-2.5 py-2 text-left text-sm shadow-sm transition",
                          maint &&
                            "cursor-default border-amber-200 bg-amber-50 text-amber-950 ring-amber-100",
                          held &&
                            "cursor-default border-amber-300 bg-amber-100 text-amber-950 ring-amber-200",
                          isOcc &&
                            "border-blue-200 bg-blue-50 text-blue-950 ring-blue-100 hover:ring-2 hover:ring-blue-300",
                          avail &&
                            "border-emerald-200 bg-emerald-50 text-emerald-950 ring-emerald-100 hover:ring-2 hover:ring-emerald-300",
                        )}
                      >
                        <p className="text-base font-bold leading-tight">{s(row.bed_number) || "—"}</p>
                        <p className="text-[11px] leading-tight text-gray-600">{s(row.bed_type) || "Bed"}</p>
                        {maint ? (
                          <>
                            <p className="mt-1 text-[11px] font-semibold text-amber-900">Maintenance</p>
                            {(() => {
                              const until = parseMaintenanceUntil(row);
                              const ready = until == null || until <= bedClock;
                              if (!ready && until != null) {
                                return (
                                  <p className="mt-1 text-[11px] text-amber-900/95">
                                    {readyInMinutesLabel(until, bedClock)}
                                  </p>
                                );
                              }
                              return (
                                <div className="mt-1 space-y-1.5">
                                  <p className="text-[11px] font-medium text-gray-800">Ready to clean</p>
                                  {bid ? (
                                    <button
                                      type="button"
                                      disabled={releasingBedId === bid}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void releaseFromMaintenance(bid);
                                      }}
                                      className="w-full rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      {releasingBedId === bid ? "Updating…" : "Mark Available"}
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </>
                        ) : held ? (
                          <>
                            <p className="mt-1 text-[11px] font-semibold text-amber-900">Reserved</p>
                            <p className="mt-0.5 truncate text-xs font-medium text-amber-950">
                              {heldPatientLabel(row, occupant)}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-amber-900/90">
                              {heldAdmissionLabel(row, occupant)}
                            </p>
                          </>
                        ) : isOcc ? (
                          <>
                            <p className="mt-1 truncate text-xs font-medium text-blue-950">
                              {s(occupant?.patient_name) || "Occupied"}
                            </p>
                            {los != null ? (
                              <span className="mt-1 inline-block rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-900">
                                Day {los}
                              </span>
                            ) : null}
                            <p className="mt-0.5 truncate text-[10px] text-blue-900/80">
                              {s(occupant?.admitting_doctor_name ?? occupant?.doctor_name) || ""}
                            </p>
                          </>
                        ) : (
                          <p className="mt-1 text-[11px] font-medium text-emerald-800">Available</p>
                        )}
                      </button>

                      {showAvailPop && avail && bid ? (
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
                          <p className="text-xs font-medium text-gray-700">This bed is free</p>
                          <Button
                            type="button"
                            size="sm"
                            className="mt-2 w-full"
                            onClick={() => {
                              router.push(
                                `/reception?wardId=${encodeURIComponent(s(row.ward_id))}&bedId=${encodeURIComponent(bid)}`,
                              );
                              setPopoverAvailBid(null);
                            }}
                          >
                            Admit new patient
                          </Button>
                        </div>
                      ) : null}

                      {showOccPop && isOcc && occupant && bid ? (
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[min(70vh,420px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-xl">
                          <p className="text-sm font-semibold text-gray-900">{s(occupant.patient_name)}</p>
                          <p className="mt-1 text-gray-600">
                            {occupant.age_years != null ? `${Math.round(Number(occupant.age_years))} yrs` : "—"}
                            {occupant.sex || occupant.gender ? ` · ${s(occupant.sex ?? occupant.gender)}` : ""}
                          </p>
                          <p className="mt-2 line-clamp-3 text-gray-800">
                            {s(occupant.primary_diagnosis_display) || "—"}
                          </p>
                          <p className="mt-2 text-gray-600">
                            Admitted:{" "}
                            {occupant.admitted_at
                              ? new Date(s(occupant.admitted_at)).toLocaleString()
                              : "—"}
                          </p>
                          <p className="text-gray-600">LOS: {los != null ? `Day ${los}` : "—"}</p>
                          <p className="mt-1 text-gray-600">
                            Doctor: {s(occupant.admitting_doctor_name ?? occupant.doctor_name) || "—"}
                          </p>
                          <p className="mt-1 font-medium text-gray-800">
                            Admission: {admissionNumber(occupant)}
                          </p>
                          <div className="mt-3 flex flex-col gap-2">
                            {s(occupant.admission_id) ? (
                              <Button asChild size="sm" className="w-full">
                                <Link href={`/dashboard/ipd/${encodeURIComponent(s(occupant.admission_id))}`}>
                                  Open IPD file
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => openTransferFromPopover(occupant, bid)}
                            >
                              Transfer bed
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {transferOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => {
              setTransferOpen(false);
              setTransferError(null);
            }}
          />
          <div
            role="dialog"
            aria-modal
            className="relative z-10 m-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-gray-900">Transfer bed</h2>
              <button
                type="button"
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
                onClick={() => {
                  setTransferOpen(false);
                  setTransferError(null);
                }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">Choose a free bed in any ward. Reason is optional.</p>

            <div className="mt-4 space-y-3">
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-700">Destination ward</span>
                <select
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={transferToWardId}
                  onChange={(e) => setTransferToWardId(e.target.value)}
                >
                  {wardList.map((w) => (
                    <option key={w.wardId} value={w.wardId}>
                      {w.wardName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-700">Destination bed</span>
                <select
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={transferToBedId}
                  onChange={(e) => setTransferToBedId(e.target.value)}
                  disabled={freeBedsInWard(transferToWardId, transferFromBedId).length === 0}
                >
                  {freeBedsInWard(transferToWardId, transferFromBedId).map((e) => {
                    const id = bedRowId(e.row);
                    return (
                      <option key={id} value={id}>
                        {s(e.row.bed_number)} — {s(e.row.bed_type)}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-700">Reason (optional)</span>
                <textarea
                  className="min-h-[72px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Clinical or operational reason…"
                  rows={3}
                />
              </div>
              {transferError ? (
                <p className="text-sm text-red-600">{transferError}</p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className={`${btnSecondary} flex-1`}
                  onClick={() => {
                    setTransferOpen(false);
                    setTransferError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${btnPrimary} flex-1`}
                  disabled={transferSubmitting || !transferToBedId}
                  onClick={() => void submitTransfer()}
                >
                  {transferSubmitting ? "Saving…" : "Confirm transfer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
