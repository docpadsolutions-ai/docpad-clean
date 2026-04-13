"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDistanceToNow, parseISO, isValid } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, MoreVertical, Pill, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../../../lib/supabase";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Textarea } from "../../../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { cn } from "../../../../lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function sanitizeIlike(q: string): string {
  return q.trim().replace(/[%_]/g, "").slice(0, 120);
}

/** Prefer `strength`; else trailing numeric token from brand (ward-round speed). */
function extractDose(brandName: string, strength: string): string {
  if (strength) return strength;
  const match = brandName.match(/[\s\-](\d+\.?\d*)\s*(?:mg|mcg|g|ml|%)?$/i);
  return match ? match[1] : "";
}

/** Infer default route from hospital_inventory.dosage_form_name */
function inferRouteFromDosageForm(dosageFormName: string): string {
  const x = dosageFormName.toLowerCase();
  if (x.includes("tablet") || x.includes("capsule")) return "Oral";
  if (x.includes("injection") || x.includes("injectable")) return "IV";
  if (x.includes("syrup")) return "Oral";
  return "";
}

type HospitalInventoryPickRow = {
  id: string;
  brand_name: string | null;
  generic_name: string | null;
  dosage_form_name: string | null;
  strength: string | null;
  stock_quantity: number | string | null;
  unit_of_measure: string | null;
  is_high_risk: boolean | null;
  is_lasa: boolean | null;
};

const ACTIVE_STATUSES = new Set(["active", "ordered", "planned"]);
const DONE_STATUSES = new Set(["completed", "stopped", "discontinued"]);

const KIND_OPTIONS = [
  { value: "medical", label: "Medical Rx" },
  { value: "diet", label: "Diet" },
  { value: "procedure", label: "Procedure" },
  { value: "surgical", label: "Surgical" },
] as const;

const FREQ_PRESETS = ["OD", "BD", "TID", "QID", "SOS", "Custom"] as const;

/** Kind badges — pastel fills, dark text (light table surface). */
function treatmentKindBadge(kind: string) {
  const k = kind.toLowerCase();
  if (k === "medical")
    return (
      <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-900">
        Rx
      </span>
    );
  if (k === "surgical")
    return (
      <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-900">
        Procedure
      </span>
    );
  if (k === "diet")
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
        Diet
      </span>
    );
  if (k === "procedure")
    return (
      <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-900">
        Order
      </span>
    );
  return (
    <span className="inline-flex rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-800">
      {kind || "—"}
    </span>
  );
}

function statusPill(st: string) {
  const x = st.toLowerCase();
  if (x === "active")
    return (
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
        active
      </span>
    );
  if (x === "ordered")
    return (
      <span className="inline-flex rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">
        ordered
      </span>
    );
  if (x === "planned")
    return (
      <span className="inline-flex rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-800">
        planned
      </span>
    );
  if (x === "completed")
    return (
      <span className="inline-flex rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-800">
        completed
      </span>
    );
  if (x === "stopped" || x === "discontinued")
    return (
      <span className="inline-flex rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
        {x}
      </span>
    );
  return (
    <span className="inline-flex rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-gray-800">
      {st || "—"}
    </span>
  );
}

function formatLastGiven(iso: unknown): { text: string; className: string } {
  if (iso == null || s(iso) === "") {
    return { text: "Not yet given", className: "text-amber-700" };
  }
  const d = typeof iso === "string" ? parseISO(iso) : parseISO(String(iso));
  if (!isValid(d)) return { text: "—", className: "text-gray-500" };
  return {
    text: formatDistanceToNow(d, { addSuffix: true }),
    className: "text-gray-900",
  };
}

function formatDurationLine(row: Record<string, unknown>): string {
  const dur = num(row.duration_days);
  const rem = num(row.days_remaining);
  if (dur == null && rem == null) return "—";
  const parts: string[] = [];
  if (dur != null) parts.push(`${Math.round(dur)} days`);
  if (rem != null) parts.push(`${Math.round(rem)} remaining`);
  return parts.join(" · ");
}

function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function noteDateLocalCalendarYmd(r: Record<string, unknown>): string {
  const raw = s(r.note_date);
  if (!raw) return "";
  const head = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head) && raw.length <= 10) return head;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return head;
  const d = new Date(t);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function pickProgressNoteId(admissionData: Record<string, unknown> | null): string | null {
  const raw = admissionData?.progress_notes;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const todayYmd = todayLocalYmd();
  const notes = [...raw].sort((a, b) => {
    const da = s((a as Record<string, unknown>).note_date).slice(0, 10);
    const db = s((b as Record<string, unknown>).note_date).slice(0, 10);
    return db.localeCompare(da);
  });
  const todayNote = notes.find((n) => noteDateLocalCalendarYmd(n as Record<string, unknown>) === todayYmd);
  const defaultNote = todayNote ?? notes[0];
  const id = s((defaultNote as Record<string, unknown>).id);
  return id || null;
}

export type IpdTreatmentsTabProps = {
  admissionId: string;
  hospitalId: string;
  patientId: string;
  admissionData: Record<string, unknown> | null;
  onRefetchAdmission?: () => Promise<void>;
};

type TreatmentRow = Record<string, unknown>;

export default function IpdTreatmentsTab({
  admissionId,
  hospitalId,
  patientId,
  admissionData,
  onRefetchAdmission,
}: IpdTreatmentsTabProps) {
  const [rows, setRows] = useState<TreatmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<TreatmentRow | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Add-order flow: formulary row from `hospital_inventory`. */
  const [invSearchQuery, setInvSearchQuery] = useState("");
  const debouncedInvQuery = useDebouncedValue(invSearchQuery, 280);
  const [invResults, setInvResults] = useState<HospitalInventoryPickRow[]>([]);
  const [invSearchLoading, setInvSearchLoading] = useState(false);
  const [invDropdownOpen, setInvDropdownOpen] = useState(false);
  const [selectedInventory, setSelectedInventory] = useState<HospitalInventoryPickRow | null>(null);
  const invPickRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    treatmentKind: "medical" as string,
    name: "",
    dose: "",
    route: "",
    frequencyPreset: "BD" as string,
    frequencyCustom: "",
    durationDays: "" as string,
    startDate: new Date().toISOString().split("T")[0],
    notes: "",
  });

  const progressNoteId = useMemo(() => pickProgressNoteId(admissionData), [admissionData]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!invPickRef.current?.contains(e.target as Node)) setInvDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const q = sanitizeIlike(debouncedInvQuery);
    if (q.length < 2) {
      setInvResults([]);
      setInvSearchLoading(false);
      return;
    }
    let cancelled = false;
    setInvSearchLoading(true);
    void (async () => {
      const pat = `%${q}%`;
      const { data, error } = await supabase
        .from("hospital_inventory")
        .select(
          "id, brand_name, generic_name, dosage_form_name, strength, stock_quantity, unit_of_measure, is_high_risk, is_lasa",
        )
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .ilike("brand_name", pat)
        .order("brand_name")
        .limit(20);
      if (cancelled) return;
      setInvSearchLoading(false);
      if (error) {
        toast.error(error.message);
        setInvResults([]);
        return;
      }
      const list = (data ?? []) as Record<string, unknown>[];
      setInvResults(
        list.map((r) => ({
          id: s(r.id),
          brand_name: r.brand_name != null ? String(r.brand_name) : null,
          generic_name: r.generic_name != null ? String(r.generic_name) : null,
          dosage_form_name: r.dosage_form_name != null ? String(r.dosage_form_name) : null,
          strength: r.strength != null ? String(r.strength) : null,
          stock_quantity: r.stock_quantity as number | string | null,
          unit_of_measure: r.unit_of_measure != null ? String(r.unit_of_measure) : null,
          is_high_risk: Boolean(r.is_high_risk),
          is_lasa: Boolean(r.is_lasa),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedInvQuery, hospitalId]);

  const load = useCallback(async () => {
    if (!admissionId) return;
    setLoading(true);
    setLoadErr(null);
    const { data, error } = await supabase
      .from("ipd_treatments_summary")
      .select("*")
      .eq("admission_id", admissionId)
      .order("created_at", { ascending: false });
    if (error) {
      setLoadErr(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as TreatmentRow[]);
    }
    setLoading(false);
  }, [admissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      setCurrentUserId(uid);
      if (!uid) return;
      const { data: prof } = await supabase.from("practitioners").select("id").eq("user_id", uid).maybeSingle();
      if (prof?.id) setPractitionerId(String(prof.id));
    })();
  }, []);

  const { activeList, doneList } = useMemo(() => {
    const active: TreatmentRow[] = [];
    const done: TreatmentRow[] = [];
    for (const r of rows) {
      const st = s(r.status).toLowerCase();
      if (ACTIVE_STATUSES.has(st)) active.push(r);
      else if (DONE_STATUSES.has(st)) done.push(r);
      else active.push(r);
    }
    return { activeList: active, doneList: done };
  }, [rows]);

  const resetForm = () => {
    setInvSearchQuery("");
    setInvResults([]);
    setSelectedInventory(null);
    setInvDropdownOpen(false);
    setForm({
      treatmentKind: "medical",
      name: "",
      dose: "",
      route: "",
      frequencyPreset: "BD",
      frequencyCustom: "",
      durationDays: "",
      startDate: new Date().toISOString().split("T")[0],
      notes: "",
    });
  };

  const applyInventorySelection = useCallback((row: HospitalInventoryPickRow) => {
    setSelectedInventory(row);
    const brand = s(row.brand_name);
    const gen = s(row.generic_name);
    const strength = s(row.strength);
    const df = s(row.dosage_form_name);
    const dosePrefill = extractDose(brand, strength);
    setForm((f) => ({
      ...f,
      name: gen ? `${brand} (${gen})` : brand,
      dose: dosePrefill,
      route: inferRouteFromDosageForm(df) || f.route,
    }));
    setInvDropdownOpen(false);
    setInvSearchQuery(brand);
  }, []);

  const openAdd = () => {
    setEditRow(null);
    resetForm();
    setAddOpen(true);
  };

  const openEdit = (r: TreatmentRow) => {
    setEditRow(r);
    const freq = s(r.frequency);
    const presetNoCustom = ["OD", "BD", "TID", "QID", "SOS"] as const;
    const isPreset = (presetNoCustom as readonly string[]).includes(freq);
    setForm({
      treatmentKind: s(r.treatment_kind) || "medical",
      name: s(r.name),
      dose: s(r.dose),
      route: s(r.route),
      frequencyPreset: isPreset ? freq : "Custom",
      frequencyCustom: isPreset ? "" : freq,
      durationDays: r.duration_days != null ? String(r.duration_days) : "",
      startDate: s(r.start_date).slice(0, 10) || new Date().toISOString().split("T")[0],
      notes: s(r.notes ?? r.description ?? r.clinical_notes),
    });
    setAddOpen(true);
  };

  const resolvedFrequency = () => {
    if (form.frequencyPreset === "Custom") return form.frequencyCustom.trim() || "Custom";
    return form.frequencyPreset;
  };

  /** Shared field validation for add + edit. */
  const buildCommonTreatmentFields = (): Record<string, unknown> | null => {
    const name = form.name.trim();
    if (!name) {
      toast.error("Name is required.");
      return null;
    }
    const start = form.startDate;
    const startD = parseISO(start);
    if (!isValid(startD)) {
      toast.error("Invalid start date.");
      return null;
    }
    const durParsed = form.durationDays.trim() === "" ? null : parseInt(form.durationDays.replace(/\D/g, ""), 10);
    const duration_days = durParsed != null && Number.isFinite(durParsed) ? durParsed : null;
    let end_date: string | null = null;
    if (duration_days != null && duration_days > 0) {
      end_date = addDays(startD, duration_days).toISOString().split("T")[0];
    }
    const n = form.notes.trim();
    return {
      treatment_kind: form.treatmentKind,
      name,
      dose: form.dose.trim() || null,
      route: form.route.trim() || null,
      frequency: resolvedFrequency(),
      duration_days,
      start_date: start,
      end_date,
      notes: n || null,
    };
  };

  /** New order from pharmacy inventory (Add modal). */
  const buildPharmacyInsertPayload = (): Record<string, unknown> | null => {
    if (!selectedInventory?.id) {
      toast.error("Select a medication from the hospital formulary.");
      return null;
    }
    if (!progressNoteId) {
      toast.error("No progress note for today. Open Daily Notes and ensure a note exists.");
      return null;
    }
    const orderBy = practitionerId ?? currentUserId;
    if (!orderBy) {
      toast.error("Sign in as a practitioner to prescribe.");
      return null;
    }
    const start = form.startDate;
    const startD = parseISO(start);
    if (!isValid(startD)) {
      toast.error("Invalid start date.");
      return null;
    }
    const durParsed = form.durationDays.trim() === "" ? null : parseInt(form.durationDays.replace(/\D/g, ""), 10);
    const duration_days = durParsed != null && Number.isFinite(durParsed) ? durParsed : null;
    let end_date: string | null = null;
    if (duration_days != null && duration_days > 0) {
      end_date = addDays(startD, duration_days).toISOString().split("T")[0];
    }
    const brand = s(selectedInventory.brand_name);
    const gen = s(selectedInventory.generic_name);
    const displayName = gen ? `${brand} (${gen})` : brand;
    /** Persist edited dose field (already pre-filled via extractDose on pick). */
    const dose = form.dose.trim() || null;
    const route =
      form.route.trim() || inferRouteFromDosageForm(s(selectedInventory.dosage_form_name)) || null;
    const stockN = num(selectedInventory.stock_quantity);
    const inStock = stockN != null && stockN > 0;
    const ordered = new Date().toISOString().split("T")[0];
    const n = form.notes.trim();
    const payload: Record<string, unknown> = {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      progress_note_id: progressNoteId,
      treatment_kind: "medical",
      name: displayName,
      dose,
      route,
      frequency: resolvedFrequency(),
      duration_days,
      start_date: start,
      end_date,
      status: inStock ? "active" : "ordered",
      ordered_date: ordered,
      ordering_practitioner_id: orderBy,
      description: `inventory_item_id:${s(selectedInventory.id)}`,
    };
    if (n) payload.notes = n;
    return payload;
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (editRow) {
        const id = s(editRow.id);
        if (!id) {
          toast.error("Missing treatment id.");
          return;
        }
        const common = buildCommonTreatmentFields();
        if (!common) return;
        const patch: Record<string, unknown> = {
          ...common,
          updated_at: new Date().toISOString(),
        };
        let up = await supabase.from("ipd_treatments").update(patch).eq("id", id);
        if (up.error && patch.notes !== undefined && /notes/i.test(up.error.message)) {
          const rest = { ...patch };
          delete rest.notes;
          up = await supabase.from("ipd_treatments").update(rest).eq("id", id);
        }
        const error = up.error;
        if (error) toast.error(error.message);
        else {
          toast.success("Treatment updated.");
          setAddOpen(false);
          setEditRow(null);
          resetForm();
          await load();
          await onRefetchAdmission?.();
        }
      } else {
        const payload = buildPharmacyInsertPayload();
        if (!payload) return;
        let ins = await supabase.from("ipd_treatments").insert(payload);
        let err = ins.error;
        if (err && payload.notes != null && /notes/i.test(err.message)) {
          const rest = { ...payload };
          delete rest.notes;
          ins = await supabase.from("ipd_treatments").insert(rest);
          err = ins.error;
        }
        if (err && payload.description != null && /description/i.test(err.message)) {
          const p2 = { ...payload };
          delete p2.description;
          ins = await supabase.from("ipd_treatments").insert(p2);
          err = ins.error;
        }
        if (err) toast.error(err.message);
        else {
          toast.success("Order added.");
          setAddOpen(false);
          resetForm();
          await load();
          await onRefetchAdmission?.();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const markAdministered = async (r: TreatmentRow) => {
    const id = s(r.id);
    if (!id) return;
    const { error } = await supabase
      .from("ipd_treatments")
      .update({
        last_given_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Marked administered.");
      await load();
    }
  };

  const discontinue = async (r: TreatmentRow) => {
    const id = s(r.id);
    if (!id) return;
    const today = new Date().toISOString().split("T")[0];
    const { error } = await supabase
      .from("ipd_treatments")
      .update({
        status: "discontinued",
        end_date: today,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Discontinued.");
      await load();
    }
  };

  const doseRouteLine = (r: TreatmentRow) => {
    const dose = s(r.dose);
    const route = s(r.route);
    if (!dose && !route) return "—";
    if (dose && route) return `${dose} · ${route}`;
    return dose || route;
  };

  const txCell = "p-3 align-middle text-sm !text-gray-900 [&:has([role=checkbox])]:pr-0";
  const txCellMuted = "p-3 align-middle text-sm !text-gray-500 [&:has([role=checkbox])]:pr-0";
  const txHead =
    "h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide !text-gray-600 [&:has([role=checkbox])]:pr-0";

  const renderTable = (list: TreatmentRow[], muted: boolean) => (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <Table className="text-gray-900">
        <TableHeader>
          <TableRow className="border-b border-gray-200 hover:bg-transparent">
            <TableHead className={txHead}>Medication / order</TableHead>
            <TableHead className={txHead}>Dose &amp; route</TableHead>
            <TableHead className={txHead}>Frequency</TableHead>
            <TableHead className={txHead}>Duration</TableHead>
            <TableHead className={txHead}>Last given</TableHead>
            <TableHead className={txHead}>Status</TableHead>
            {muted ? <TableHead className={txHead}>Ended</TableHead> : null}
            <TableHead className={cn(txHead, "w-10")} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((r) => {
            const id = s(r.id);
            const st = s(r.status).toLowerCase();
            const overdue = Boolean(r.is_overdue);
            const last = formatLastGiven(r.last_given_at);
            const cell = muted ? txCellMuted : txCell;
            const nameClass = muted ? "font-medium text-gray-500" : "font-semibold text-gray-900";
            return (
              <TableRow
                key={id || JSON.stringify(r)}
                className={cn(
                  "border-b border-gray-200 text-gray-900 hover:bg-gray-50/80",
                  muted && "text-gray-500 hover:bg-gray-50/50",
                  overdue &&
                    !muted &&
                    "bg-amber-50 text-amber-950 hover:bg-amber-100/80 [&_td]:text-amber-950 [&_.tx-name]:text-amber-950",
                )}
              >
                <TableCell className={cell}>
                  <div className="flex flex-wrap items-center gap-2">
                    {overdue && !muted ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    ) : null}
                    <span className={cn("tx-name", nameClass)}>{s(r.name)}</span>
                    {treatmentKindBadge(s(r.treatment_kind))}
                  </div>
                </TableCell>
                <TableCell className={cell}>{doseRouteLine(r)}</TableCell>
                <TableCell className={cell}>{s(r.frequency) || "—"}</TableCell>
                <TableCell className={cell}>{formatDurationLine(r)}</TableCell>
                <TableCell className={cn(cell, last.className, overdue && !muted && "!text-amber-900")}>{last.text}</TableCell>
                <TableCell className={cell}>{statusPill(st)}</TableCell>
                {muted ? (
                  <TableCell className={txCellMuted}>
                    {r.end_date ? s(r.end_date).slice(0, 10) : "—"}
                    {r.last_given_at ? (
                      <span className="mt-0.5 block text-[10px] text-gray-500">
                        Last: {formatLastGiven(r.last_given_at).text}
                      </span>
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell className={cn(cell, "text-right")}>
                  {!muted ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                          aria-label="Actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    <PopoverContent align="end" className="w-48 p-1">
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => void markAdministered(r)}
                      >
                        Mark administered
                      </button>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => openEdit(r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm text-amber-800 hover:bg-amber-50"
                        onClick={() => void discontinue(r)}
                      >
                        Discontinue
                      </button>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span className="text-[10px] text-gray-500">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );

  return (
    <div className="space-y-6 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      {loadErr ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {loadErr}
        </p>
      ) : null}

      {/* Active */}
      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Pill className="h-5 w-5 text-gray-600" />
            <h2 className="text-base font-bold text-gray-900">Active orders</h2>
          </div>
          <Button type="button" size="sm" onClick={openAdd} className="gap-1.5 self-start">
            <Plus className="h-4 w-4" />
            Add medication / order
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-gray-600">Loading treatments…</p>
        ) : activeList.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
            No active orders. Use &quot;+ Add medication / order&quot; to prescribe.
          </p>
        ) : (
          renderTable(activeList, false)
        )}
      </section>

      {/* Completed */}
      <section className="border-t border-border pt-6">
        <button
          type="button"
          onClick={() => setCompletedOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            {completedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Completed / stopped
            <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-800">
              {doneList.length}
            </span>
          </span>
        </button>
        {completedOpen ? (
          <div className="mt-3 opacity-95">
            {doneList.length === 0 ? (
              <p className="text-sm text-gray-400">No completed or stopped orders.</p>
            ) : (
              renderTable(doneList, true)
            )}
          </div>
        ) : null}
      </section>

      {/* Modal */}
      {addOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ipd-tx-modal-title"
          onClick={() => setAddOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setAddOpen(false)}
        >
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="ipd-tx-modal-title" className="text-lg font-bold text-foreground">
              {editRow ? "Edit order" : "Add medication / order"}
            </h3>
            <div className="mt-4 space-y-3">
              {editRow ? (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wide">Treatment kind</Label>
                    <Select
                      value={form.treatmentKind}
                      onValueChange={(v) => setForm((f) => ({ ...f, treatmentKind: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Kind" />
                      </SelectTrigger>
                      <SelectContent>
                        {KIND_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wide">Name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Medication or order name"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide">Dose</Label>
                      <Input
                        value={form.dose}
                        onChange={(e) => setForm((f) => ({ ...f, dose: e.target.value }))}
                        placeholder="e.g. 500mg"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide">Route</Label>
                      <Input
                        value={form.route}
                        onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))}
                        placeholder="e.g. IV"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div ref={invPickRef} className="relative space-y-1.5">
                    <Label className="text-xs uppercase tracking-wide">Medication (hospital formulary)</Label>
                    <Input
                      value={invSearchQuery}
                      onChange={(e) => {
                        setInvSearchQuery(e.target.value);
                        setInvDropdownOpen(true);
                        if (!e.target.value.trim()) setSelectedInventory(null);
                      }}
                      onFocus={() => setInvDropdownOpen(true)}
                      placeholder="Search by brand name…"
                      autoComplete="off"
                    />
                    {invDropdownOpen && sanitizeIlike(debouncedInvQuery).length >= 2 ? (
                      <div className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-[min(60vh,280px)] overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg">
                        {invSearchLoading ? (
                          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Searching formulary…
                          </div>
                        ) : invResults.length === 0 ? (
                          <p className="px-3 py-4 text-center text-sm text-muted-foreground">No matches.</p>
                        ) : (
                          invResults.map((row) => {
                            const qty = num(row.stock_quantity);
                            const q = qty != null ? Math.max(0, Math.floor(qty)) : 0;
                            const u = s(row.unit_of_measure);
                            const inStock = q > 0;
                            return (
                              <button
                                key={row.id}
                                type="button"
                                className="flex w-full flex-col gap-1 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted/80"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => applyInventorySelection(row)}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-bold text-foreground">{s(row.brand_name)}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {s(row.generic_name) || "—"}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-1">
                                    {row.is_high_risk ? (
                                      <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                        HIGH RISK
                                      </span>
                                    ) : null}
                                    {row.is_lasa ? (
                                      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-950">
                                        LASA
                                      </span>
                                    ) : null}
                                    <span
                                      className={cn(
                                        "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                        inStock
                                          ? "bg-emerald-100 text-emerald-900"
                                          : "bg-red-100 text-red-900",
                                      )}
                                    >
                                      {inStock
                                        ? `In stock (${q}${u ? ` ${u}` : ""})`
                                        : "Out of stock"}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {s(row.dosage_form_name) ? (
                                    <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-foreground">
                                      {s(row.dosage_form_name)}
                                    </span>
                                  ) : null}
                                  {s(row.strength) ? (
                                    <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-foreground">
                                      {s(row.strength)}
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                  {selectedInventory ? (
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                      <p className="font-semibold text-foreground">Selected</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {s(selectedInventory.brand_name)}
                        {s(selectedInventory.generic_name) ? ` · ${s(selectedInventory.generic_name)}` : ""}
                      </p>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide">Dose</Label>
                      <Input
                        value={form.dose}
                        onChange={(e) => setForm((f) => ({ ...f, dose: e.target.value }))}
                        placeholder="e.g. 500mg, 2 tabs, 10ml"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide">Route</Label>
                      <Input
                        value={form.route}
                        onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))}
                        placeholder="e.g. Oral, IV"
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide">Frequency</Label>
                <Select
                  value={form.frequencyPreset}
                  onValueChange={(v) => setForm((f) => ({ ...f, frequencyPreset: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQ_PRESETS.map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.frequencyPreset === "Custom" ? (
                  <Input
                    className="mt-2"
                    value={form.frequencyCustom}
                    onChange={(e) => setForm((f) => ({ ...f, frequencyCustom: e.target.value }))}
                    placeholder="Custom frequency"
                  />
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide">Duration (days)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.durationDays}
                    onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide">Start date</Label>
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide">Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Instructions, indication, or other notes"
                />
              </div>

              {!editRow && selectedInventory ? (
                <div className="space-y-2">
                  {selectedInventory.is_high_risk ? (
                    <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
                      ⚠️ HIGH RISK MEDICATION — Double-check dose and route before ordering
                    </div>
                  ) : null}
                  {selectedInventory.is_lasa ? (
                    <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
                      ⚠️ LASA Drug — Look-Alike Sound-Alike. Verify drug identity carefully
                    </div>
                  ) : null}
                  {num(selectedInventory.stock_quantity) === 0 ? (
                    <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
                      ⚠️ This drug is currently out of stock in pharmacy. Order will be placed as pending.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || (!editRow && !selectedInventory)}
              >
                {saving ? "Saving…" : editRow ? "Save changes" : "Add order"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
