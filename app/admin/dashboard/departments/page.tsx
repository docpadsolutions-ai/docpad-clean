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

const CODE_SYSTEM = "http://snomed.info/sct";

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

/** Consultation charge linked via `charge_item_definitions.applicability_rules.department_id`. */
export type DeptConsultCharge = {
  id: string;
  base_price: number;
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

function getDepartmentIdFromRules(rules: unknown): string | null {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return null;
  const rid = (rules as Record<string, unknown>).department_id;
  if (rid == null) return null;
  const s = String(rid).trim();
  return s || null;
}

function buildConsultChargeByDept(
  chargeRows: Record<string, unknown>[],
): Record<string, DeptConsultCharge> {
  const parsed = chargeRows
    .map((r) => {
      const deptId = getDepartmentIdFromRules(r.applicability_rules);
      if (!deptId) return null;
      const bp = r.base_price;
      const basePrice = typeof bp === "number" ? bp : bp != null ? Number(bp) : 0;
      return {
        deptId,
        id: String(r.id ?? ""),
        base_price: Number.isFinite(basePrice) ? basePrice : 0,
        status: String(r.status ?? ""),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null && Boolean(x.id));

  parsed.sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;
    return 0;
  });

  const map: Record<string, DeptConsultCharge> = {};
  for (const p of parsed) {
    if (!map[p.deptId]) map[p.deptId] = { id: p.id, base_price: p.base_price };
  }
  return map;
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

const HIDDEN_DEPARTMENT_NAMES = new Set([
  "Administration",
  "Pharmacy",
  "Diagnostics",
  "Accounts",
  "HR",
  "IT",
  "Housekeeping",
]);

function looksLikeSupportDepartmentName(name: string): boolean {
  const n = name.trim().toLowerCase();
  const patterns = [
    /\badmin(istration)?\b/,
    /\bpharmacy\b/,
    /\bdiagnostic\b/,
    /\baccount(s)?\b/,
    /\bhr\b/,
    /\bit\b/,
    /\bhousekeeping\b/,
    /\bbilling\b/,
    /\bfinance\b/,
    /\breception\b/,
    /\bsecurity\b/,
    /\bmaintenance\b/,
    /\bcanteen\b/,
    /\bstores?\b/,
    /\bpurchase(s)?\b/,
    /\bmarketing\b/,
  ];
  return patterns.some((p) => p.test(n));
}

function isClinicalDepartment(row: DepartmentRow): boolean {
  const name = row.name.trim();
  if (HIDDEN_DEPARTMENT_NAMES.has(name)) return false;
  const hasSpecialty = row.specialty != null && row.specialty.trim() !== "";
  if (hasSpecialty) return true;
  return !looksLikeSupportDepartmentName(name);
}

type ModalMode = "create" | "edit";

type FormFields = {
  name: string;
  specialty: string;
  opd_hours_start: string;
  opd_hours_end: string;
  slot_duration_minutes: string;
};

const defaultForm = (): FormFields => ({
  name: "",
  specialty: "",
  opd_hours_start: "09:00",
  opd_hours_end: "17:00",
  slot_duration_minutes: "15",
});

function rowToForm(row: DepartmentRow): FormFields {
  return {
    name: row.name,
    specialty: row.specialty ?? "",
    opd_hours_start: toTimeInputValue(row.opd_hours_start) || "09:00",
    opd_hours_end: toTimeInputValue(row.opd_hours_end) || "17:00",
    slot_duration_minutes: String(row.slot_duration_minutes),
  };
}

export default function DepartmentsAdminPage() {
  const dialogTitleId = useId();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [chargeByDeptId, setChargeByDeptId] = useState<Record<string, DeptConsultCharge>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormFields>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [feeDraftByDept, setFeeDraftByDept] = useState<Record<string, string>>({});
  const [feeSavingId, setFeeSavingId] = useState<string | null>(null);

  const clinicalRows = useMemo(() => rows.filter(isClinicalDepartment), [rows]);

  const load = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const [{ data, error: rpcErr }, chargeRes] = await Promise.all([
      supabase.rpc("get_departments", { p_hospital_id: hid }),
      supabase
        .from("charge_item_definitions")
        .select("id, base_price, status, applicability_rules")
        .eq("hospital_id", hid)
        .eq("category", "consultation"),
    ]);
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setRows([]);
      setChargeByDeptId({});
      setFeeDraftByDept({});
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    const parsedRows = list.map(parseDepartmentRow);
    setRows(parsedRows);

    if (chargeRes.error) {
      setError(chargeRes.error.message);
      setChargeByDeptId({});
      setFeeDraftByDept({});
      return;
    }
    const chargeRows = (Array.isArray(chargeRes.data) ? chargeRes.data : []) as Record<string, unknown>[];
    const chargeMap = buildConsultChargeByDept(chargeRows);
    setChargeByDeptId(chargeMap);
    const drafts: Record<string, string> = {};
    for (const r of parsedRows.filter(isClinicalDepartment)) {
      const c = chargeMap[r.id];
      drafts[r.id] = c ? String(c.base_price) : "";
    }
    setFeeDraftByDept(drafts);
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
    const specialty = form.specialty.trim() || null;

    if (modalMode === "create") {
      const { error: rpcErr } = await supabase.rpc("create_department", {
        p_hospital_id: hospitalId,
        p_name: form.name.trim(),
        p_specialty: specialty,
        p_opd_hours_start: form.opd_hours_start,
        p_opd_hours_end: form.opd_hours_end,
        p_slot_duration_minutes: slot,
        p_consultation_fee: 0,
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
        p_consultation_fee: row?.consultation_fee ?? 0,
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

  const applyConsultFee = async (row: DepartmentRow) => {
    if (!hospitalId) return;
    const raw = feeDraftByDept[row.id]?.trim() ?? "";
    const num = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(num) || num < 0) {
      setError("Enter a valid consultation fee (₹).");
      return;
    }
    setError(null);
    setFeeSavingId(row.id);
    const existing = chargeByDeptId[row.id];

    if (existing) {
      const { error: upErr } = await supabase
        .from("charge_item_definitions")
        .update({ base_price: num })
        .eq("id", existing.id);
      setFeeSavingId(null);
      if (upErr) {
        setError(upErr.message);
        return;
      }
      await load(hospitalId);
      return;
    }

    const { count, error: countErr } = await supabase
      .from("charge_item_definitions")
      .select("*", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .eq("category", "consultation");
    if (countErr) {
      setFeeSavingId(null);
      setError(countErr.message);
      return;
    }
    const nextNum = (count ?? 0) + 1;
    const code = `CHG-CONS-${String(nextNum).padStart(3, "0")}`;
    const displayName = `OPD Consultation — ${row.name.trim()}`;
    const { error: insErr } = await supabase.from("charge_item_definitions").insert({
      hospital_id: hospitalId,
      code,
      code_system: CODE_SYSTEM,
      display_name: displayName,
      category: "consultation",
      base_price: num,
      currency: "INR",
      tax_type: "gst_exempt",
      tax_rate: 0,
      status: "active",
      effective_from: new Date().toISOString().slice(0, 10),
      applicability_rules: { department_id: row.id },
    });
    setFeeSavingId(null);
    if (insErr) {
      setError(insErr.message);
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

  const pricingConsultationHref = "/admin/pricing?category=consultation";

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Departments</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              OPD hours and slot configuration per clinical department
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Showing clinical departments only. Support departments are managed in Staff Directory.
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
            <CardTitle className="text-lg">Clinical departments</CardTitle>
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
            ) : clinicalRows.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                No clinical departments to show. Add one to configure OPD scheduling, or manage support departments in Staff
                Directory.
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
                      <TableHead className="min-w-[200px]">Consultation fee</TableHead>
                      <TableHead className="min-w-[90px]">Status</TableHead>
                      <TableHead className="w-[200px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clinicalRows.map((row) => {
                      const linked = chargeByDeptId[row.id];
                      return (
                        <TableRow key={row.id} className="border-border">
                          <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.specialty ?? "—"}</TableCell>
                          <TableCell className="text-sm tabular-nums">{opdLabel(row)}</TableCell>
                          <TableCell className="text-sm tabular-nums">{row.slot_duration_minutes} min</TableCell>
                          <TableCell className="align-top">
                            <div className="flex min-w-[12rem] flex-col gap-1.5">
                              {linked ? (
                                <p className="text-sm tabular-nums text-foreground">
                                  {formatFeeInr(linked.base_price)}{" "}
                                  <span className="text-xs font-normal text-muted-foreground">(from Pricing)</span>
                                </p>
                              ) : (
                                <p className="text-sm text-muted-foreground">Not set in Pricing</p>
                              )}
                              <Link
                                href={pricingConsultationHref}
                                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                              >
                                Edit in Pricing →
                              </Link>
                              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="h-8 w-[7.5rem]"
                                  aria-label={`Consultation fee amount for ${row.name}`}
                                  value={feeDraftByDept[row.id] ?? ""}
                                  onChange={(e) =>
                                    setFeeDraftByDept((prev) => ({ ...prev, [row.id]: e.target.value }))
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-8"
                                  disabled={feeSavingId === row.id}
                                  onClick={() => void applyConsultFee(row)}
                                >
                                  {feeSavingId === row.id ? "…" : "Apply"}
                                </Button>
                              </div>
                              <p className="text-[11px] text-muted-foreground">Updates the charge catalog (Pricing).</p>
                            </div>
                          </TableCell>
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
                      );
                    })}
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
              Required: name, OPD window, and slot length. Consultation fees are managed under Administration → Pricing.
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
