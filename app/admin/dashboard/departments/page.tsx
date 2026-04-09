"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type DepartmentRow = {
  id: string;
  name: string;
  specialty: string | null;
  opd_hours_start: string | null;
  opd_hours_end: string | null;
  slot_duration_minutes: number;
  consultation_fee: number;
  is_active: boolean;
  type: string;
};

function parseDepartmentRow(r: Record<string, unknown>): DepartmentRow {
  const fee = r.consultation_fee;
  const feeNum = typeof fee === "number" ? fee : fee != null ? Number(fee) : 0;
  const slot = r.slot_duration_minutes;
  const slotNum = typeof slot === "number" ? slot : slot != null ? Number(slot) : 15;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    specialty: r.specialty != null && String(r.specialty).trim() ? String(r.specialty).trim() : null,
    opd_hours_start: r.opd_hours_start != null ? String(r.opd_hours_start) : null,
    opd_hours_end: r.opd_hours_end != null ? String(r.opd_hours_end) : null,
    slot_duration_minutes: Number.isFinite(slotNum) ? slotNum : 15,
    consultation_fee: Number.isFinite(feeNum) ? feeNum : 0,
    is_active: Boolean(r.is_active),
    type: String(r.type ?? ""),
  };
}

/** Normalize Postgres time to `HH:MM` for `<input type="time" />`. */
function toTimeInputValue(t: string | null): string {
  if (!t) return "";
  const s = t.trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = m[1].padStart(2, "0");
  return `${h}:${m[2]}`;
}

function formatTimeDisplay(t: string | null): string {
  if (!t) return "—";
  return toTimeInputValue(t) || "—";
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function formatFeeInr(n: number): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `₹${n}`;
  }
}

type ModalMode = "create" | "edit";

type FormFields = {
  name: string;
  specialty: string;
  opd_hours_start: string;
  opd_hours_end: string;
  slot_duration_minutes: string;
  consultation_fee: string;
};

const defaultForm = (): FormFields => ({
  name: "",
  specialty: "",
  opd_hours_start: "09:00",
  opd_hours_end: "17:00",
  slot_duration_minutes: "15",
  consultation_fee: "0",
});

function rowToForm(row: DepartmentRow): FormFields {
  return {
    name: row.name,
    specialty: row.specialty ?? "",
    opd_hours_start: toTimeInputValue(row.opd_hours_start) || "09:00",
    opd_hours_end: toTimeInputValue(row.opd_hours_end) || "17:00",
    slot_duration_minutes: String(row.slot_duration_minutes),
    consultation_fee: String(row.consultation_fee),
  };
}

export default function DepartmentsAdminPage() {
  const dialogTitleId = useId();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormFields>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const load = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("get_departments", { p_hospital_id: hid });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setRows([]);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setRows(list.map(parseDepartmentRow));
  }, []);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid, error: e } = await fetchHospitalIdFromPractitionerAuthId();
      const id = hid?.trim() || null;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      if (!id) {
        setError("No hospital on your practitioner record. Contact support.");
        setLoading(false);
        return;
      }
      setHospitalId(id);
      await load(id);
    })();
  }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const openCreate = () => {
    setModalMode("create");
    setEditingId(null);
    setForm(defaultForm());
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (row: DepartmentRow) => {
    setModalMode("edit");
    setEditingId(row.id);
    setForm(rowToForm(row));
    setFormError(null);
    setModalOpen(true);
  };

  const validateForm = (f: FormFields): string | null => {
    if (!f.name.trim()) return "Name is required.";
    if (!f.opd_hours_start || !f.opd_hours_end) return "OPD start and end times are required.";
    const a = timeToMinutes(f.opd_hours_start);
    const b = timeToMinutes(f.opd_hours_end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "Invalid OPD times.";
    if (b <= a) return "OPD end must be after start.";
    const slot = Number(f.slot_duration_minutes);
    if (!Number.isFinite(slot) || slot < 5 || slot > 240) return "Slot duration must be between 5 and 240 minutes.";
    const fee = Number(f.consultation_fee);
    if (!Number.isFinite(fee) || fee < 0) return "Fee must be a non-negative number.";
    return null;
  };

  const submitModal = async () => {
    if (!hospitalId) return;
    const err = validateForm(form);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setSaving(true);
    const slot = Number(form.slot_duration_minutes);
    const fee = Number(form.consultation_fee);
    const specialty = form.specialty.trim() || null;

    if (modalMode === "create") {
      const { error: rpcErr } = await supabase.rpc("create_department", {
        p_hospital_id: hospitalId,
        p_name: form.name.trim(),
        p_specialty: specialty,
        p_opd_hours_start: form.opd_hours_start,
        p_opd_hours_end: form.opd_hours_end,
        p_slot_duration_minutes: slot,
        p_consultation_fee: fee,
      });
      setSaving(false);
      if (rpcErr) {
        setFormError(rpcErr.message);
        return;
      }
    } else if (editingId) {
      const row = rows.find((r) => r.id === editingId);
      const { error: rpcErr } = await supabase.rpc("update_department", {
        p_department_id: editingId,
        p_name: form.name.trim(),
        p_specialty: specialty,
        p_opd_hours_start: form.opd_hours_start,
        p_opd_hours_end: form.opd_hours_end,
        p_slot_duration_minutes: slot,
        p_consultation_fee: fee,
        p_is_active: row?.is_active ?? true,
      });
      setSaving(false);
      if (rpcErr) {
        setFormError(rpcErr.message);
        return;
      }
    }
    setModalOpen(false);
    await load(hospitalId);
  };

  const toggleActive = async (row: DepartmentRow) => {
    if (!hospitalId) return;
    setRowBusyId(row.id);
    const next = !row.is_active;
    const { error: rpcErr } = await supabase.rpc("update_department", {
      p_department_id: row.id,
      p_name: row.name,
      p_specialty: row.specialty,
      p_opd_hours_start: toTimeInputValue(row.opd_hours_start) || "09:00",
      p_opd_hours_end: toTimeInputValue(row.opd_hours_end) || "17:00",
      p_slot_duration_minutes: row.slot_duration_minutes,
      p_consultation_fee: row.consultation_fee,
      p_is_active: next,
    });
    setRowBusyId(null);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    await load(hospitalId);
  };

  const opdLabel = useMemo(
    () => (row: DepartmentRow) =>
      row.opd_hours_start && row.opd_hours_end
        ? `${formatTimeDisplay(row.opd_hours_start)} – ${formatTimeDisplay(row.opd_hours_end)}`
        : "—",
    [],
  );

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Departments</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              OPD hours, slot length, and consultation fee per department.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin">← Admin home</Link>
            </Button>
            <Button type="button" onClick={openCreate}>
              Add department
            </Button>
          </div>
        </div>

        {error && !loading ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <Card className="border-border shadow-sm">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-lg">All departments</CardTitle>
            <CardDescription>Managed with your hospital admin privileges.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-0">
            {loading ? (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <div
                  className="h-9 w-9 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                  aria-hidden
                />
                <p className="text-sm font-medium text-muted-foreground">Loading departments…</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No departments yet. Add one to configure OPD scheduling and fees.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                      <TableHead className="min-w-[140px]">Name</TableHead>
                      <TableHead className="min-w-[120px]">Specialty</TableHead>
                      <TableHead className="min-w-[160px]">OPD hours</TableHead>
                      <TableHead className="min-w-[100px]">Slot duration</TableHead>
                      <TableHead className="min-w-[100px]">Fee</TableHead>
                      <TableHead className="min-w-[90px]">Status</TableHead>
                      <TableHead className="w-[200px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id} className="border-border">
                        <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.specialty ?? "—"}</TableCell>
                        <TableCell className="text-sm tabular-nums">{opdLabel(row)}</TableCell>
                        <TableCell className="text-sm tabular-nums">{row.slot_duration_minutes} min</TableCell>
                        <TableCell className="text-sm tabular-nums">{formatFeeInr(row.consultation_fee)}</TableCell>
                        <TableCell>
                          {row.is_active ? (
                            <span className="inline-flex rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-600 dark:bg-green-500/20 dark:text-green-400">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                              Inactive
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={rowBusyId === row.id}
                              onClick={() => void toggleActive(row)}
                            >
                              {rowBusyId === row.id ? "…" : row.is_active ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 text-card-foreground shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id={dialogTitleId} className="text-lg font-semibold text-foreground">
              {modalMode === "create" ? "Add department" : "Edit department"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Required: name, OPD window, slot length, and consultation fee.
            </p>

            {formError ? (
              <p className="mt-4 text-sm text-red-600" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="mt-6 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="dept-name">
                  Name <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="dept-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dept-specialty">Specialty</Label>
                <Input
                  id="dept-specialty"
                  value={form.specialty}
                  onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
                  placeholder="e.g. Cardiology"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="dept-start">
                    OPD start <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="dept-start"
                    type="time"
                    value={form.opd_hours_start}
                    onChange={(e) => setForm((f) => ({ ...f, opd_hours_start: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dept-end">
                    OPD end <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="dept-end"
                    type="time"
                    value={form.opd_hours_end}
                    onChange={(e) => setForm((f) => ({ ...f, opd_hours_end: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dept-slot">
                  Slot duration (minutes) <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="dept-slot"
                  type="number"
                  min={5}
                  max={240}
                  step={1}
                  value={form.slot_duration_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, slot_duration_minutes: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dept-fee">
                  Consultation fee (INR) <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="dept-fee"
                  type="number"
                  min={0}
                  step={1}
                  value={form.consultation_fee}
                  onChange={(e) => setForm((f) => ({ ...f, consultation_fee: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-8 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitModal()} disabled={saving}>
                {saving ? "Saving…" : modalMode === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
