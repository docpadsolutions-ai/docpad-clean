"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BedDouble, Building2, Pencil, Plus } from "lucide-react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import ClinicalConfigurationNav from "@/components/admin/ClinicalConfigurationNav";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type WardRow = {
  id: string;
  hospital_id: string;
  name: string;
  ward_type: string | null;
  specialty: string | null;
  floor: number | null;
  is_active: boolean;
  /** Minutes bed stays in maintenance after discharge (default 60). */
  post_discharge_maintenance_mins: number;
};

type BedRow = {
  id: string;
  hospital_id: string;
  ward_id: string;
  bed_number: string;
  bed_type: string | null;
  status: string;
  is_active: boolean;
  maintenance_until?: string | null;
};

type OtRoomRow = {
  id: string;
  hospital_id: string;
  name: string;
  ot_number: string;
  specialty: string | null;
  floor: number | null;
  is_active: boolean;
};

const WARD_TYPES = ["general", "private", "icu", "hdu", "daycare"] as const;
const BED_TYPES = ["standard", "private", "icu", "hdu"] as const;

function parseWard(r: Record<string, unknown>): WardRow {
  const pm = r.post_discharge_maintenance_mins;
  const pmNum =
    typeof pm === "number" && Number.isFinite(pm)
      ? Math.max(0, Math.trunc(pm))
      : pm != null
        ? Number(pm)
        : NaN;
  return {
    id: s(r.id),
    hospital_id: s(r.hospital_id),
    name: s(r.name) || "Ward",
    ward_type: r.ward_type != null && s(r.ward_type) ? s(r.ward_type) : null,
    specialty: r.specialty != null && s(r.specialty) ? s(r.specialty) : null,
    floor: typeof r.floor === "number" && Number.isFinite(r.floor) ? r.floor : r.floor != null ? Number(r.floor) : null,
    is_active: Boolean(r.is_active ?? true),
    post_discharge_maintenance_mins: Number.isFinite(pmNum) ? Math.max(0, Math.trunc(pmNum)) : 60,
  };
}

function parseBed(r: Record<string, unknown>): BedRow {
  const mu = r.maintenance_until;
  return {
    id: s(r.id),
    hospital_id: s(r.hospital_id),
    ward_id: s(r.ward_id),
    bed_number: s(r.bed_number) || "—",
    bed_type: r.bed_type != null && s(r.bed_type) ? s(r.bed_type) : null,
    status: s(r.status).toLowerCase() || "available",
    is_active: Boolean(r.is_active ?? true),
    maintenance_until: mu != null && String(mu).trim() ? String(mu) : null,
  };
}

function parseOtRoom(r: Record<string, unknown>): OtRoomRow {
  const fl = r.floor;
  return {
    id: s(r.id),
    hospital_id: s(r.hospital_id),
    name: s(r.name) || "—",
    ot_number: s(r.ot_number) || "—",
    specialty: r.specialty != null && s(r.specialty) ? s(r.specialty) : null,
    floor: typeof fl === "number" && Number.isFinite(fl) ? fl : fl != null ? Number(fl) : null,
    is_active: Boolean(r.is_active ?? true),
  };
}

function titleCaseType(t: string): string {
  const x = t.trim().toLowerCase();
  if (!x) return "";
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function WardListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="mt-2 h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function BedGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

export default function AdminWardsPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [wards, setWards] = useState<WardRow[]>([]);
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [otRooms, setOtRooms] = useState<OtRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWardId, setSelectedWardId] = useState<string | null>(null);

  const [showAddWard, setShowAddWard] = useState(false);
  const [newWardName, setNewWardName] = useState("");
  const [newWardType, setNewWardType] = useState<string>("general");
  const [newWardSpecialty, setNewWardSpecialty] = useState("");
  const [newWardFloor, setNewWardFloor] = useState("");
  const [wardSaving, setWardSaving] = useState(false);

  const [editingWardId, setEditingWardId] = useState<string | null>(null);
  const [editWardName, setEditWardName] = useState("");
  const [editWardType, setEditWardType] = useState("");
  const [editWardSpecialty, setEditWardSpecialty] = useState("");
  const [editWardFloor, setEditWardFloor] = useState("");
  const [editWardPostDischargeMins, setEditWardPostDischargeMins] = useState("60");

  const [addBedsOpen, setAddBedsOpen] = useState(false);
  const [addBedsCount, setAddBedsCount] = useState(1);
  const [addBedsType, setAddBedsType] = useState<string>("standard");
  const [addBedsSaving, setAddBedsSaving] = useState(false);

  const [bedPopoverId, setBedPopoverId] = useState<string | null>(null);
  const [bedEditNumber, setBedEditNumber] = useState("");
  const [bedEditType, setBedEditType] = useState("standard");
  const [bedEditMaintenance, setBedEditMaintenance] = useState(false);
  const [bedEditActive, setBedEditActive] = useState(true);
  const [bedSaving, setBedSaving] = useState(false);
  const [bedError, setBedError] = useState<string | null>(null);

  const [showAddOt, setShowAddOt] = useState(false);
  const [newOtName, setNewOtName] = useState("");
  const [newOtNumber, setNewOtNumber] = useState("");
  const [newOtSpecialty, setNewOtSpecialty] = useState("");
  const [newOtFloor, setNewOtFloor] = useState("");
  const [otSaving, setOtSaving] = useState(false);

  const [editingOtId, setEditingOtId] = useState<string | null>(null);
  const [editOtName, setEditOtName] = useState("");
  const [editOtNumber, setEditOtNumber] = useState("");
  const [editOtSpecialty, setEditOtSpecialty] = useState("");
  const [editOtFloor, setEditOtFloor] = useState("");

  const load = useCallback(async () => {
    setOrgError(null);
    setError(null);
    const { hospitalId: hid, error: oErr } = await fetchHospitalIdFromPractitionerAuthId();
    if (oErr) setOrgError(oErr.message);
    const id = hid?.trim() || null;
    setHospitalId(id);
    if (!id) {
      setLoading(false);
      setError("Your account is not linked to a hospital.");
      return;
    }
    setLoading(true);
    const [wRes, bRes, otRes] = await Promise.all([
      supabase.from("ipd_wards").select("*").eq("hospital_id", id).order("name"),
      supabase.from("ipd_beds").select("*").eq("hospital_id", id),
      supabase.from("ot_rooms").select("*").eq("hospital_id", id).order("ot_number"),
    ]);
    if (wRes.error) {
      setError(wRes.error.message);
      setWards([]);
      setBeds([]);
    } else {
      const wl = ((wRes.data ?? []) as Record<string, unknown>[]).map(parseWard);
      setWards(wl);
      setSelectedWardId((cur) => {
        if (cur && wl.some((w) => w.id === cur)) return cur;
        return wl[0]?.id ?? null;
      });
    }
    if (bRes.error && !wRes.error) setError(bRes.error.message);
    if (!bRes.error) {
      setBeds(((bRes.data ?? []) as Record<string, unknown>[]).map(parseBed));
    } else if (!wRes.error) {
      setBeds([]);
    }
    if (otRes.error && !wRes.error) {
      setError(otRes.error.message);
    }
    if (!otRes.error) {
      setOtRooms(((otRes.data ?? []) as Record<string, unknown>[]).map(parseOtRoom));
    } else {
      setOtRooms([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bedsForSelected = useMemo(() => {
    if (!selectedWardId) return [];
    return beds.filter((b) => b.ward_id === selectedWardId);
  }, [beds, selectedWardId]);

  const selectedWard = useMemo(
    () => wards.find((w) => w.id === selectedWardId) ?? null,
    [wards, selectedWardId],
  );

  const wardStats = useMemo(() => {
    const activeList = bedsForSelected.filter((b) => b.is_active);
    const totalActive = activeList.length;
    const avail = activeList.filter((b) => s(b.status).toLowerCase() === "available").length;
    return { totalActive, avail };
  }, [bedsForSelected]);

  async function toggleWardActive(w: WardRow) {
    if (!hospitalId) return;
    setWardSaving(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("upsert_ward", {
      p_hospital_id: hospitalId,
      p_name: w.name,
      p_ward_type: w.ward_type ?? "",
      p_specialty: w.specialty ?? "",
      p_floor: w.floor,
      p_ward_id: w.id,
      p_is_active: !w.is_active,
    });
    setWardSaving(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    void load();
  }

  async function saveNewWard() {
    if (!hospitalId) return;
    const name = newWardName.trim();
    if (!name) {
      setError("Ward name is required.");
      return;
    }
    setWardSaving(true);
    setError(null);
    const floorNum = newWardFloor.trim() === "" ? null : Number(newWardFloor);
    const { data, error: rpcErr } = await supabase.rpc("upsert_ward", {
      p_hospital_id: hospitalId,
      p_name: name,
      p_ward_type: newWardType,
      p_specialty: newWardSpecialty.trim() || null,
      p_floor: floorNum != null && Number.isFinite(floorNum) ? Math.trunc(floorNum) : null,
      p_ward_id: null,
      p_is_active: true,
    });
    setWardSaving(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    const newId = s(Array.isArray(data) ? data[0] : data);
    setShowAddWard(false);
    setNewWardName("");
    setNewWardSpecialty("");
    setNewWardFloor("");
    setNewWardType("general");
    if (newId) setSelectedWardId(newId);
    await load();
    if (newId) {
      setAddBedsOpen(true);
    }
  }

  function startEditWard(w: WardRow) {
    setEditingWardId(w.id);
    setEditWardName(w.name);
    setEditWardType(w.ward_type ?? "general");
    setEditWardSpecialty(w.specialty ?? "");
    setEditWardFloor(w.floor != null ? String(w.floor) : "");
    setEditWardPostDischargeMins(String(w.post_discharge_maintenance_mins ?? 60));
  }

  async function saveEditWard() {
    if (!hospitalId || !editingWardId) return;
    const name = editWardName.trim();
    if (!name) {
      setError("Ward name is required.");
      return;
    }
    const wardRow = wards.find((x) => x.id === editingWardId);
    setWardSaving(true);
    setError(null);
    const floorNum = editWardFloor.trim() === "" ? null : Number(editWardFloor);
    const { error: rpcErr } = await supabase.rpc("upsert_ward", {
      p_hospital_id: hospitalId,
      p_name: name,
      p_ward_type: editWardType,
      p_specialty: editWardSpecialty.trim() || null,
      p_floor: floorNum != null && Number.isFinite(floorNum) ? Math.trunc(floorNum) : null,
      p_ward_id: editingWardId,
      p_is_active: wardRow?.is_active ?? true,
    });
    setWardSaving(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    const minsRaw = Number(editWardPostDischargeMins);
    const mins = Number.isFinite(minsRaw) ? Math.max(0, Math.trunc(minsRaw)) : 60;
    const { error: wardColErr } = await supabase
      .from("ipd_wards")
      .update({ post_discharge_maintenance_mins: mins })
      .eq("id", editingWardId);
    if (wardColErr) {
      setError(wardColErr.message);
      return;
    }
    setEditingWardId(null);
    void load();
  }

  function openBedPopover(b: BedRow) {
    const st = s(b.status).toLowerCase();
    if (st === "occupied") return;
    setBedPopoverId(b.id);
    setBedEditNumber(b.bed_number);
    setBedEditType(b.bed_type ?? "standard");
    setBedEditMaintenance(st === "maintenance");
    setBedEditActive(b.is_active);
    setBedError(null);
  }

  async function saveBedEdit(b: BedRow) {
    if (!hospitalId) return;
    setBedSaving(true);
    setBedError(null);
    const status =
      bedEditMaintenance ? "maintenance" : s(b.status).toLowerCase() === "occupied" ? "occupied" : "available";
    const { error: rpcErr } = await supabase.rpc("update_bed", {
      p_bed_id: b.id,
      p_hospital_id: hospitalId,
      p_bed_type: bedEditType,
      p_status: status,
      p_is_active: bedEditActive,
      p_bed_number: bedEditNumber.trim(),
    });
    setBedSaving(false);
    if (rpcErr) {
      setBedError(rpcErr.message);
      return;
    }
    setBedPopoverId(null);
    void load();
  }

  async function submitAddBeds() {
    if (!hospitalId || !selectedWardId) return;
    const n = Math.min(20, Math.max(1, Math.floor(Number(addBedsCount)) || 1));
    setAddBedsSaving(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("add_beds_to_ward", {
      p_hospital_id: hospitalId,
      p_ward_id: selectedWardId,
      p_count: n,
      p_bed_type: addBedsType,
    });
    setAddBedsSaving(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setAddBedsOpen(false);
    setAddBedsCount(1);
    setAddBedsType("standard");
    void load();
  }

  const activeBedsCount = useCallback(
    (wardId: string) => beds.filter((b) => b.ward_id === wardId && b.is_active).length,
    [beds],
  );

  async function saveNewOt() {
    if (!hospitalId) return;
    const name = newOtName.trim();
    const num = newOtNumber.trim();
    if (!name || !num) {
      setError("OT name and OT number are required.");
      return;
    }
    setOtSaving(true);
    setError(null);
    const floorNum = newOtFloor.trim() === "" ? null : Number(newOtFloor);
    const { error: insErr } = await supabase.from("ot_rooms").insert({
      hospital_id: hospitalId,
      name,
      ot_number: num,
      specialty: newOtSpecialty.trim() || null,
      floor: floorNum != null && Number.isFinite(floorNum) ? Math.trunc(floorNum) : null,
      is_active: true,
    });
    setOtSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setShowAddOt(false);
    setNewOtName("");
    setNewOtNumber("");
    setNewOtSpecialty("");
    setNewOtFloor("");
    void load();
  }

  async function toggleOtActive(r: OtRoomRow) {
    if (!hospitalId) return;
    setOtSaving(true);
    setError(null);
    const { error: upErr } = await supabase
      .from("ot_rooms")
      .update({ is_active: !r.is_active, updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("hospital_id", hospitalId);
    setOtSaving(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    void load();
  }

  function startEditOt(r: OtRoomRow) {
    setEditingOtId(r.id);
    setEditOtName(r.name);
    setEditOtNumber(r.ot_number);
    setEditOtSpecialty(r.specialty ?? "");
    setEditOtFloor(r.floor != null ? String(r.floor) : "");
  }

  async function saveEditOt() {
    if (!hospitalId || !editingOtId) return;
    const name = editOtName.trim();
    const num = editOtNumber.trim();
    if (!name || !num) {
      setError("OT name and OT number are required.");
      return;
    }
    setOtSaving(true);
    setError(null);
    const floorNum = editOtFloor.trim() === "" ? null : Number(editOtFloor);
    const { error: upErr } = await supabase
      .from("ot_rooms")
      .update({
        name,
        ot_number: num,
        specialty: editOtSpecialty.trim() || null,
        floor: floorNum != null && Number.isFinite(floorNum) ? Math.trunc(floorNum) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingOtId)
      .eq("hospital_id", hospitalId);
    setOtSaving(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setEditingOtId(null);
    void load();
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clinical configuration</p>
              <ClinicalConfigurationNav />
            </div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <BedDouble className="h-7 w-7 text-blue-600" aria-hidden />
              Wards &amp; beds
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure wards and beds — changes apply to reception bed management, admissions, and IPD census.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/admin">← Admin home</Link>
          </Button>
        </div>

        {orgError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{orgError}</div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
          {/* Left — wards */}
          <Card className="border-border shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-lg">Wards</CardTitle>
              <CardDescription>Name, type, and floor — toggle inactive to hide from assignment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {loading ? (
                <WardListSkeleton />
              ) : (
                <>
                  {wards.map((w) => (
                    <div
                      key={w.id}
                      className={cn(
                        "rounded-xl border p-3 transition",
                        selectedWardId === w.id ? "border-blue-300 bg-blue-50/60" : "border-border bg-card",
                        !w.is_active && "opacity-70",
                      )}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setSelectedWardId(w.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-foreground">{w.name}</span>
                          {w.ward_type ? (
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                              {titleCaseType(w.ward_type)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Maintenance: {w.post_discharge_maintenance_mins ?? 60} min after discharge
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Floor {w.floor != null ? w.floor : "—"} · {activeBedsCount(w.id)} beds active
                        </p>
                      </button>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground">Active</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={w.is_active}
                          disabled={wardSaving}
                          onClick={() => void toggleWardActive(w)}
                          className={cn(
                            "relative h-7 w-11 rounded-full transition",
                            w.is_active ? "bg-blue-600" : "bg-slate-300",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition",
                              w.is_active ? "left-5" : "left-0.5",
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/50"
                          onClick={() => (editingWardId === w.id ? setEditingWardId(null) : startEditWard(w))}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      </div>
                      {editingWardId === w.id ? (
                        <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border p-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Ward name</Label>
                            <Input value={editWardName} onChange={(e) => setEditWardName(e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Ward type</Label>
                            <div className="flex flex-wrap gap-1">
                              {WARD_TYPES.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => setEditWardType(t)}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                    editWardType === t ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {titleCaseType(t)}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Specialty</Label>
                            <Input value={editWardSpecialty} onChange={(e) => setEditWardSpecialty(e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Floor</Label>
                            <Input
                              type="number"
                              inputMode="numeric"
                              value={editWardFloor}
                              onChange={(e) => setEditWardFloor(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Post-discharge maintenance duration</Label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                className="w-24"
                                value={editWardPostDischargeMins}
                                onChange={(e) => setEditWardPostDischargeMins(e.target.value)}
                              />
                              <span className="text-xs text-muted-foreground">minutes</span>
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditingWardId(null)}>
                              Cancel
                            </Button>
                            <Button type="button" size="sm" disabled={wardSaving} onClick={() => void saveEditWard()}>
                              Save ward
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}

                  {showAddWard ? (
                    <div className="space-y-2 rounded-xl border border-dashed border-blue-200 bg-blue-50/40 p-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Ward name</Label>
                        <Input value={newWardName} onChange={(e) => setNewWardName(e.target.value)} placeholder="e.g. Ward 3A" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Ward type</Label>
                        <div className="flex flex-wrap gap-1">
                          {WARD_TYPES.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setNewWardType(t)}
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                newWardType === t ? "bg-blue-600 text-white" : "bg-white text-muted-foreground shadow-sm",
                              )}
                            >
                              {titleCaseType(t)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Specialty</Label>
                        <Input
                          value={newWardSpecialty}
                          onChange={(e) => setNewWardSpecialty(e.target.value)}
                          placeholder="e.g. Orthopedics"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Floor</Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={newWardFloor}
                          onChange={(e) => setNewWardFloor(e.target.value)}
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => setShowAddWard(false)}>
                          Cancel
                        </Button>
                        <Button type="button" size="sm" disabled={wardSaving} onClick={() => void saveNewWard()}>
                          Save ward
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => {
                      setShowAddWard(true);
                      setEditingWardId(null);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add ward
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Right — beds */}
          <Card className="min-h-[420px] border-border shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-lg">
                {selectedWard ? selectedWard.name : "Beds"}
              </CardTitle>
              <CardDescription>
                {selectedWard ? (
                  <>
                    {wardStats.avail} available / {wardStats.totalActive} total active
                  </>
                ) : (
                  "Select a ward"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {loading ? (
                <BedGridSkeleton />
              ) : !selectedWard ? (
                <p className="text-sm text-muted-foreground">No ward selected.</p>
              ) : (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {bedsForSelected.map((b) => {
                      const st = s(b.status).toLowerCase();
                      const occ = st === "occupied";
                      const maint = st === "maintenance";
                      const inactive = !b.is_active;
                      const avail = b.is_active && !occ && !maint && st === "available";
                      const open = bedPopoverId === b.id;
                      return (
                        <Popover
                          key={b.id}
                          open={open}
                          onOpenChange={(o) => {
                            if (occ) return;
                            if (o) openBedPopover(b);
                            else setBedPopoverId(null);
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              disabled={occ}
                              className={cn(
                                "rounded-xl border px-2.5 py-2 text-left text-sm shadow-sm transition",
                                occ && "cursor-default border-blue-200 bg-blue-50 text-blue-950",
                                inactive &&
                                  !occ &&
                                  "cursor-pointer border-slate-200 bg-slate-100 text-slate-700 hover:ring-2 hover:ring-slate-300",
                                maint &&
                                  b.is_active &&
                                  "border-amber-200 bg-amber-50 text-amber-950 hover:ring-2 hover:ring-amber-300",
                                avail && "border-emerald-200 bg-emerald-50 text-emerald-950 hover:ring-2 hover:ring-emerald-300",
                              )}
                            >
                              <p className="text-base font-bold leading-tight">{b.bed_number}</p>
                              <p className="text-[11px] text-muted-foreground">{titleCaseType(b.bed_type ?? "standard")}</p>
                              <p className="mt-1 text-[11px] font-semibold">
                                {occ ? "Occupied" : inactive ? "Inactive" : maint ? "Maintenance" : "Available"}
                              </p>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-80 space-y-3 border border-gray-200 bg-white p-4 text-gray-900 shadow-lg dark:border-gray-200 dark:bg-white dark:text-gray-900"
                            align="start"
                          >
                            <p className="text-sm font-semibold text-gray-900">Edit bed</p>
                            <div className="space-y-1">
                              <Label className="text-xs text-gray-700">Bed number</Label>
                              <Input
                                value={bedEditNumber}
                                onChange={(e) => setBedEditNumber(e.target.value)}
                                className="border-gray-200 bg-white text-gray-900"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-gray-700">Bed type</Label>
                              <div className="flex flex-wrap gap-1">
                                {BED_TYPES.map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => setBedEditType(t)}
                                    className={cn(
                                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                                      bedEditType === t
                                        ? "border-blue-600 bg-blue-600 text-white"
                                        : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
                                    )}
                                  >
                                    {titleCaseType(t)}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-gray-700">Maintenance</span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={bedEditMaintenance}
                                onClick={() => setBedEditMaintenance((m) => !m)}
                                className={cn(
                                  "relative h-7 w-11 rounded-full transition",
                                  bedEditMaintenance ? "bg-amber-500" : "bg-slate-300",
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition",
                                    bedEditMaintenance ? "left-5" : "left-0.5",
                                  )}
                                />
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-gray-700">Bed active</span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={bedEditActive}
                                disabled={occ}
                                onClick={() => setBedEditActive((a) => !a)}
                                className={cn(
                                  "relative h-7 w-11 rounded-full transition",
                                  bedEditActive ? "bg-blue-600" : "bg-slate-300",
                                  occ && "cursor-not-allowed opacity-50",
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition",
                                    bedEditActive ? "left-5" : "left-0.5",
                                  )}
                                />
                              </button>
                            </div>
                            {bedError ? <p className="text-xs text-red-600">{bedError}</p> : null}
                            <Button
                              type="button"
                              size="sm"
                              className="w-full bg-blue-600 text-white hover:bg-blue-700"
                              disabled={bedSaving}
                              onClick={() => void saveBedEdit(b)}
                            >
                              {bedSaving ? "Saving…" : "Save"}
                            </Button>
                          </PopoverContent>
                        </Popover>
                      );
                    })}
                  </div>
                  <Button type="button" variant="outline" className="w-full border-dashed sm:w-auto" onClick={() => setAddBedsOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add beds
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-6 w-6 text-blue-600" aria-hidden />
              Operation theatres
            </CardTitle>
            <CardDescription>
              OT list for surgery scheduling. Inactive rooms are hidden from the Schedule Surgery picker.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs font-semibold uppercase text-muted-foreground">Name</TableHead>
                        <TableHead className="text-xs font-semibold uppercase text-muted-foreground">OT number</TableHead>
                        <TableHead className="text-xs font-semibold uppercase text-muted-foreground">Specialty</TableHead>
                        <TableHead className="text-xs font-semibold uppercase text-muted-foreground">Floor</TableHead>
                        <TableHead className="text-xs font-semibold uppercase text-muted-foreground">Status</TableHead>
                        <TableHead className="text-right text-xs font-semibold uppercase text-muted-foreground">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {otRooms.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                            No operation theatres yet. Add one below.
                          </TableCell>
                        </TableRow>
                      ) : (
                        otRooms.map((r) => {
                          const editing = editingOtId === r.id;
                          return (
                            <TableRow key={r.id} className={!r.is_active ? "opacity-70" : undefined}>
                              <TableCell className="font-medium text-foreground">
                                {editing ? (
                                  <Input
                                    value={editOtName}
                                    onChange={(e) => setEditOtName(e.target.value)}
                                    className="h-8 text-sm"
                                  />
                                ) : (
                                  r.name
                                )}
                              </TableCell>
                              <TableCell>
                                {editing ? (
                                  <Input
                                    value={editOtNumber}
                                    onChange={(e) => setEditOtNumber(e.target.value)}
                                    className="h-8 text-sm"
                                    placeholder="e.g. OT-1"
                                  />
                                ) : (
                                  r.ot_number
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {editing ? (
                                  <Input
                                    value={editOtSpecialty}
                                    onChange={(e) => setEditOtSpecialty(e.target.value)}
                                    className="h-8 text-sm"
                                    placeholder="Optional"
                                  />
                                ) : (
                                  r.specialty ?? "—"
                                )}
                              </TableCell>
                              <TableCell>
                                {editing ? (
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    value={editOtFloor}
                                    onChange={(e) => setEditOtFloor(e.target.value)}
                                    className="h-8 w-20 text-sm"
                                  />
                                ) : (
                                  r.floor != null ? r.floor : "—"
                                )}
                              </TableCell>
                              <TableCell>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={r.is_active}
                                  disabled={otSaving || editing}
                                  onClick={() => void toggleOtActive(r)}
                                  className={cn(
                                    "relative h-7 w-11 rounded-full transition",
                                    r.is_active ? "bg-blue-600" : "bg-slate-300",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition",
                                      r.is_active ? "left-5" : "left-0.5",
                                    )}
                                  />
                                </button>
                              </TableCell>
                              <TableCell className="text-right">
                                {editing ? (
                                  <div className="flex justify-end gap-2">
                                    <Button type="button" size="sm" variant="outline" onClick={() => setEditingOtId(null)}>
                                      Cancel
                                    </Button>
                                    <Button type="button" size="sm" disabled={otSaving} onClick={() => void saveEditOt()}>
                                      Save
                                    </Button>
                                  </div>
                                ) : (
                                  <Button type="button" size="sm" variant="outline" onClick={() => startEditOt(r)}>
                                    <Pencil className="mr-1 h-3.5 w-3.5" />
                                    Edit
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                {showAddOt ? (
                  <div className="space-y-2 rounded-xl border border-dashed border-blue-200 bg-blue-50/40 p-4">
                    <p className="text-sm font-semibold text-foreground">Add operation theatre</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Name</Label>
                        <Input value={newOtName} onChange={(e) => setNewOtName(e.target.value)} placeholder="e.g. Main OT" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">OT number</Label>
                        <Input value={newOtNumber} onChange={(e) => setNewOtNumber(e.target.value)} placeholder="e.g. OT-3" />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">Specialty (optional)</Label>
                        <Input
                          value={newOtSpecialty}
                          onChange={(e) => setNewOtSpecialty(e.target.value)}
                          placeholder="Leave blank for shared OT"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Floor</Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={newOtFloor}
                          onChange={(e) => setNewOtFloor(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowAddOt(false)}>
                        Cancel
                      </Button>
                      <Button type="button" size="sm" disabled={otSaving} onClick={() => void saveNewOt()}>
                        Save OT
                      </Button>
                    </div>
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  className="border-dashed"
                  onClick={() => {
                    setShowAddOt(true);
                    setEditingOtId(null);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add OT
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {addBedsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => setAddBedsOpen(false)}
          />
          <div
            role="dialog"
            aria-modal
            className="relative z-10 m-4 w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-foreground">Add beds</h2>
            <p className="mt-1 text-xs text-muted-foreground">Add 1–20 beds to {selectedWard?.name ?? "this ward"}.</p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">How many beds?</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  inputMode="numeric"
                  value={addBedsCount}
                  onChange={(e) => setAddBedsCount(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bed type</Label>
                <div className="flex flex-wrap gap-1">
                  {BED_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setAddBedsType(t)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                        addBedsType === t ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {titleCaseType(t)}
                    </button>
                  ))}
                </div>
              </div>
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setAddBedsOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" className="flex-1" disabled={addBedsSaving || !selectedWardId} onClick={() => void submitAddBeds()}>
                  {addBedsSaving ? "Adding…" : "Confirm"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
