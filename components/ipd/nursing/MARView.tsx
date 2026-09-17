"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, Minus, Pause, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { cn } from "../../../lib/utils";
import { isMarSlotOverdue } from "./marOverdue";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export const MAR_SLOT_TIMES = [
  "00:00",
  "06:00",
  "08:00",
  "12:00",
  "14:00",
  "18:00",
  "20:00",
  "22:00",
] as const;

export type MarSlotTime = (typeof MAR_SLOT_TIMES)[number];

export type MarRow = {
  id: string;
  treatment_id?: string | null;
  drug_name?: string | null;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  scheduled_time?: string | null;
  status?: string | null;
  adverse_event?: boolean | null;
  hold_reason?: string | null;
  notes?: string | null;
  actual_dose_given?: string | null;
  actual_route?: string | null;
  iv_site?: string | null;
};

export type MARViewProps = {
  admissionId: string;
  hospitalId: string;
  /** When set (e.g. nursing panel day selector), MAR uses this date; local date control is hidden. */
  viewDateYmd?: string;
  /** Fires after MAR data finishes loading (not while loading) so parents can mirror overdue counts. */
  onOverdueCountChange?: (count: number) => void;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize DB time to HH:MM for slot matching. */
export function normalizeSlotTime(raw: string | null | undefined): MarSlotTime | null {
  if (!raw) return null;
  const t = String(raw).trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, parseInt(m[1], 10));
  const min = Math.min(59, parseInt(m[2], 10));
  const key = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return (MAR_SLOT_TIMES as readonly string[]).includes(key) ? (key as MarSlotTime) : null;
}

function isHighAlertDrug(name: string | null | undefined): boolean {
  const t = (name ?? "").toLowerCase();
  return ["insulin", "heparin", "kcl", "potassium chloride", "morphine", "warfarin"].some((x) => t.includes(x));
}

const HOLD_REASONS = ["NPO", "Patient asleep", "Drug unavailable", "Clinical decision", "Other"] as const;
const REFUSE_REASONS = ["Patient declined", "Nausea / vomiting", "Other"] as const;

const MAR_ROUTE_OPTIONS: { value: string; label: string }[] = [
  { value: "oral", label: "Oral (PO)" },
  { value: "iv", label: "Intravenous (IV)" },
  { value: "im", label: "Intramuscular (IM)" },
  { value: "sc", label: "Subcutaneous (SC)" },
  { value: "sl", label: "Sublingual (SL)" },
  { value: "pr", label: "Per Rectal (PR)" },
  { value: "topical", label: "Topical" },
  { value: "inhalation", label: "Inhalation" },
  { value: "nasal", label: "Nasal" },
  { value: "otic", label: "Otic (Ear)" },
  { value: "ophthalmic", label: "Ophthalmic (Eye)" },
  { value: "ng", label: "Nasogastric (NG)" },
];

/** Sentinel for Radix Select (empty string is not a valid item value). */
const SELECT_UNSET = "__unset__";

const MAR_IV_LATERALITY_OPTIONS: { value: string; label: string }[] = [
  { value: SELECT_UNSET, label: "Select side..." },
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
  { value: "bilateral", label: "Bilateral" },
  { value: "na", label: "N/A" },
];

const MAR_IV_SITE_PART_OPTIONS: { value: string; label: string }[] = [
  { value: SELECT_UNSET, label: "Select site..." },
  { value: "forearm", label: "Forearm" },
  { value: "antecubital", label: "Antecubital Fossa" },
  { value: "hand", label: "Hand" },
  { value: "wrist", label: "Wrist" },
  { value: "deltoid", label: "Deltoid" },
  { value: "gluteal", label: "Gluteal" },
  { value: "thigh", label: "Thigh" },
  { value: "abdomen", label: "Abdomen" },
  { value: "central_line", label: "Central Line" },
  { value: "picc_line", label: "PICC Line" },
  { value: "jugular", label: "Jugular" },
  { value: "subclavian", label: "Subclavian" },
];

function labelForIvSelect(
  options: { value: string; label: string }[],
  value: string,
): string | null {
  if (!value || value === SELECT_UNSET) return null;
  const o = options.find((x) => x.value === value);
  if (!o) return null;
  if (o.label.startsWith("Select")) return null;
  return o.label;
}

function combineIvSite(laterality: string, site: string): string {
  const lat = labelForIvSelect(MAR_IV_LATERALITY_OPTIONS, laterality);
  const sit = labelForIvSelect(MAR_IV_SITE_PART_OPTIONS, site);
  return [lat, sit].filter(Boolean).join(" ");
}

const ROUTES_WITH_SITE = new Set(["iv", "sc", "im"]);

/** Display scheduled_time (HH:MM) as 12h with AM/PM. */
function formatTime(t: string | null | undefined): string {
  const raw = s(t);
  if (!raw) return "—";
  const [h, m] = raw.split(":").map(Number);
  if (!Number.isFinite(h)) return raw;
  const min = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${min.toString().padStart(2, "0")} ${period}`;
}

/** Calendar day + wall time interpreted as Asia/Kolkata (IST) for MAR windows. */
function marSlotInstantIst(scheduledDateYmd: string, scheduledTimeRaw: string | null | undefined): Date | null {
  const d = String(scheduledDateYmd ?? "").trim();
  const raw = String(scheduledTimeRaw ?? "").trim();
  if (!d || !raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hh = String(Math.min(23, parseInt(m[1], 10))).padStart(2, "0");
  const mm = String(Math.min(59, parseInt(m[2], 10))).padStart(2, "0");
  const ss =
    m[3] != null ? String(Math.min(59, parseInt(m[3], 10))).padStart(2, "0") : "00";
  const t = new Date(`${d}T${hh}:${mm}:${ss}+05:30`);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Editable administration is blocked when the slot was scheduled &gt;120 min ago and still pending.
 * (No `administered_at` on row — pending status means no outcome recorded.)
 */
function isMarDoseAdministrationLocked(scheduledDateYmd: string, row: MarRow): boolean {
  if (s(row.status).toLowerCase() !== "pending") return false;
  const slotTime = marSlotInstantIst(scheduledDateYmd, row.scheduled_time);
  if (!slotTime) return false;
  const now = new Date();
  const minutesOverdue = (now.getTime() - slotTime.getTime()) / 60000;
  return minutesOverdue > 120;
}

function groupMarRowsByDrug(sorted: MarRow[]): { drugName: string; rows: MarRow[] }[] {
  const groups: { drugName: string; rows: MarRow[] }[] = [];
  for (const row of sorted) {
    const drugName = s(row.drug_name) || "Medication";
    const prev = groups[groups.length - 1];
    if (prev && prev.drugName === drugName) {
      prev.rows.push(row);
    } else {
      groups.push({ drugName, rows: [row] });
    }
  }
  return groups;
}

function statusPillClass(status: string): string {
  const st = s(status).toLowerCase();
  if (st === "pending") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200/80";
  if (st === "given") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/80";
  if (st === "held") return "bg-orange-100 text-orange-900 ring-1 ring-orange-200/80";
  if (st === "omitted") return "bg-red-100 text-red-900 ring-1 ring-red-200/80";
  if (st === "refused") return "bg-slate-200 text-slate-800 ring-1 ring-slate-300/80";
  return "bg-slate-100 text-slate-600";
}

function statusPillLabel(status: string): string {
  const st = s(status).toLowerCase();
  if (st === "pending") return "PENDING";
  if (st === "given") return "GIVEN";
  if (st === "held") return "HELD";
  if (st === "omitted") return "OMITTED";
  if (st === "refused") return "REFUSED";
  return st.toUpperCase() || "—";
}

/** Map MAR slot / legacy free-text route to a canonical dropdown value. */
function canonicalMarRoute(raw: string | null | undefined): string {
  const t = s(raw).toLowerCase();
  if (!t) return "oral";
  if (MAR_ROUTE_OPTIONS.some((o) => o.value === t)) return t;
  if (/^iv\b|intravenous/.test(t)) return "iv";
  if (/^im\b|intramuscular/.test(t)) return "im";
  if (/^sc\b|subcutaneous/.test(t)) return "sc";
  if (/^sl\b|sublingual/.test(t)) return "sl";
  if (/^pr\b|per rectal|rectal/.test(t)) return "pr";
  if (t.includes("topical")) return "topical";
  if (t.includes("inhal")) return "inhalation";
  if (t.includes("nasal") && !t.includes("nasogastric")) return "nasal";
  if (t.includes("otic") || /\bear\b/.test(t)) return "otic";
  if (t.includes("ophthalmic") || /\beye\b/.test(t)) return "ophthalmic";
  if (t.includes("nasogastric") || /\bng\b/.test(t)) return "ng";
  if (t.includes("po") || t.includes("oral")) return "oral";
  return "oral";
}

function routeLabelStored(raw: string | null | undefined): string {
  const c = canonicalMarRoute(raw);
  const o = MAR_ROUTE_OPTIONS.find((x) => x.value === c);
  return o?.label ?? (s(raw) || "—");
}

/** Short label for list row (e.g. "08:00 · IV"). */
function routeCompact(raw: string | null | undefined): string {
  const c = canonicalMarRoute(raw);
  const short: Record<string, string> = {
    oral: "Oral",
    iv: "IV",
    im: "IM",
    sc: "SC",
    sl: "SL",
    pr: "PR",
    topical: "Topical",
    inhalation: "Inhal",
    nasal: "Nasal",
    otic: "Otic",
    ophthalmic: "Eye",
    ng: "NG",
  };
  return short[c] ?? (s(raw) || "—");
}

function outcomeLabel(st: string): string {
  const t = s(st).toLowerCase();
  if (t === "given") return "Given";
  if (t === "held") return "Held";
  if (t === "refused") return "Refused";
  if (t === "omitted") return "Omitted";
  if (t === "pending") return "Pending";
  return s(st) || "—";
}

function sortMarRows(rows: MarRow[]): MarRow[] {
  return [...rows].sort((a, b) => {
    const da = s(a.drug_name).localeCompare(s(b.drug_name));
    if (da !== 0) return da;
    return s(a.scheduled_time).localeCompare(s(b.scheduled_time));
  });
}

export default function MARView({
  admissionId,
  hospitalId,
  viewDateYmd,
  onOverdueCountChange,
}: MARViewProps) {
  const [internalDateYmd, setInternalDateYmd] = useState(todayYmd);
  const dateYmd = viewDateYmd ?? internalDateYmd;
  const [rows, setRows] = useState<MarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [genBusy, setGenBusy] = useState(false);
  const [modalRow, setModalRow] = useState<MarRow | null>(null);
  const [popupReadOnly, setPopupReadOnly] = useState(false);
  const [modalStatus, setModalStatus] = useState<"given" | "held" | "refused" | "omitted">("given");
  const [actualDose, setActualDose] = useState("");
  const [actualRoute, setActualRoute] = useState("");
  const [ivLaterality, setIvLaterality] = useState("");
  const [ivSitePart, setIvSitePart] = useState("");
  const [holdRefuseReason, setHoldRefuseReason] = useState("");
  const [notes, setNotes] = useState("");
  const [adverse, setAdverse] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const load = useCallback(async () => {
    const aid = s(admissionId);
    if (!aid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("ipd_mar")
      .select(
        "id, treatment_id, drug_name, dose, route, frequency, scheduled_date, scheduled_time, status, adverse_event, hold_reason, notes, actual_dose_given, actual_route, iv_site",
      )
      .eq("admission_id", aid)
      .eq("scheduled_date", dateYmd)
      .order("drug_name", { ascending: true })
      .order("scheduled_time", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setRows(
      list.map((r) => ({
        id: s(r.id),
        treatment_id: r.treatment_id != null ? s(r.treatment_id) : null,
        drug_name: r.drug_name != null ? s(r.drug_name) : null,
        dose: r.dose != null ? s(r.dose) : null,
        route: r.route != null ? s(r.route) : null,
        frequency: r.frequency != null ? s(r.frequency) : null,
        scheduled_time: r.scheduled_time != null ? s(r.scheduled_time) : null,
        status: r.status != null ? s(r.status) : null,
        adverse_event: r.adverse_event === true,
        hold_reason: r.hold_reason != null ? s(r.hold_reason) : null,
        notes: r.notes != null ? s(r.notes) : null,
        actual_dose_given: r.actual_dose_given != null ? s(r.actual_dose_given) : null,
        actual_route: r.actual_route != null ? s(r.actual_route) : null,
        iv_site: r.iv_site != null ? s(r.iv_site) : null,
      })),
    );
  }, [admissionId, dateYmd]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedRows = useMemo(() => sortMarRows(rows), [rows]);
  const groupedRows = useMemo(() => groupMarRowsByDrug(sortedRows), [sortedRows]);

  const overdueCount = useMemo(() => {
    let n = 0;
    for (const row of sortedRows) {
      if (s(row.status).toLowerCase() !== "pending") continue;
      if (isMarSlotOverdue(dateYmd, row.scheduled_time)) n += 1;
    }
    return n;
  }, [sortedRows, dateYmd]);

  const modalAdminLocked = useMemo(() => {
    if (!modalRow || popupReadOnly) return false;
    return isMarDoseAdministrationLocked(dateYmd, modalRow);
  }, [modalRow, popupReadOnly, dateYmd]);

  useEffect(() => {
    if (loading) return;
    onOverdueCountChange?.(overdueCount);
  }, [loading, overdueCount, onOverdueCountChange]);

  const openPopup = (row: MarRow, readOnly: boolean) => {
    setPopupReadOnly(readOnly);
    setModalRow(row);
    if (!readOnly) {
      setModalStatus("given");
      setActualDose(s(row.dose));
      setActualRoute(canonicalMarRoute(row.route));
      setIvLaterality("");
      setIvSitePart("");
      setHoldRefuseReason("");
      setNotes("");
      setAdverse(false);
    }
  };

  const closeModal = () => {
    setModalRow(null);
    setPopupReadOnly(false);
  };

  useEffect(() => {
    if (!modalRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalRow]);

  const submitOmittedWindowExpired = async () => {
    if (!modalRow || popupReadOnly) return;
    const id = s(modalRow.id);
    if (!id) return;
    setSaveBusy(true);
    const { error } = await supabase.rpc("mark_mar_dose", {
      p_mar_id: id,
      p_status: "omitted",
      p_actual_dose: null,
      p_actual_route: null,
      p_hold_reason: null,
      p_iv_site: null,
      p_notes: "Window expired",
      p_adverse_event: null,
    });
    setSaveBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("MAR updated");
    closeModal();
    void load();
  };

  const submitModal = async () => {
    if (!modalRow || popupReadOnly) return;
    if (modalAdminLocked) return;
    const id = s(modalRow.id);
    if (!id) return;
    if (modalStatus === "given" && isHighAlertDrug(modalRow.drug_name) && !actualDose.trim()) {
      toast.error("Confirm dose for high-alert medication.");
      return;
    }
    if ((modalStatus === "held" || modalStatus === "refused") && !holdRefuseReason.trim()) {
      toast.error("Select or enter a reason.");
      return;
    }
    setSaveBusy(true);
    const ivSite =
      modalStatus === "given" && ROUTES_WITH_SITE.has(actualRoute)
        ? combineIvSite(ivLaterality, ivSitePart).trim() || null
        : null;
    const { error } = await supabase.rpc("mark_mar_dose", {
      p_mar_id: id,
      p_status: modalStatus,
      p_actual_dose: modalStatus === "given" ? actualDose.trim() || null : null,
      p_actual_route: modalStatus === "given" ? actualRoute.trim() || null : null,
      p_hold_reason:
        modalStatus === "held" || modalStatus === "refused" ? holdRefuseReason.trim() || null : null,
      p_iv_site: ivSite,
      p_notes: notes.trim() || null,
      p_adverse_event: modalStatus === "given" ? adverse : null,
    });
    setSaveBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("MAR updated");
    closeModal();
    void load();
  };

  const generateTodaySlots = async () => {
    const hid = s(hospitalId);
    const aid = s(admissionId);
    if (!hid || !aid) {
      toast.error("Missing hospital or admission.");
      return;
    }
    setGenBusy(true);
    const { data: txs, error: txErr } = await supabase
      .from("ipd_treatments")
      .select("id")
      .eq("admission_id", aid)
      .in("status", ["active", "ordered", "planned"]);
    if (txErr) {
      setGenBusy(false);
      toast.error(txErr.message);
      return;
    }
    const ids = (Array.isArray(txs) ? txs : []).map((t) => s((t as Record<string, unknown>).id)).filter(Boolean);
    let total = 0;
    for (const tid of ids) {
      const { data, error } = await supabase.rpc("generate_mar_slots", {
        p_treatment_id: tid,
        p_for_date: dateYmd,
      });
      if (error) {
        toast.error(error.message);
        setGenBusy(false);
        return;
      }
      const n = typeof data === "number" ? data : Number(data);
      if (Number.isFinite(n)) total += n;
    }
    setGenBusy(false);
    toast.success(ids.length === 0 ? "No active treatments to schedule." : `Generated ${total} slot(s).`);
    void load();
  };

  const showIvSiteField = modalStatus === "given" && ROUTES_WITH_SITE.has(actualRoute);

  return (
    <div className="space-y-4">
      {overdueCount > 0 ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>⚠️</span>
          <span>
            {overdueCount} dose{overdueCount > 1 ? "s" : ""} overdue — please administer or mark as held/omitted
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        {!viewDateYmd ? (
          <div>
            <Label className="text-[10px] font-semibold uppercase text-slate-500">Date</Label>
            <Input
              type="date"
              className="mt-1 h-9 w-[11rem] text-sm"
              value={internalDateYmd}
              onChange={(e) => setInternalDateYmd(e.target.value)}
            />
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-9"
          disabled={genBusy || !s(admissionId)}
          onClick={() => void generateTodaySlots()}
        >
          {genBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Generate today&apos;s slots
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading MAR…
        </div>
      ) : sortedRows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No MAR rows for this day. Add treatments, then generate slots.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm">
          {groupedRows.map((group, gi) => (
            <li key={`${group.drugName}-${s(group.rows[0]?.id)}-${gi}`} className="px-3 py-3 first:pt-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-slate-900">{group.drugName}</span>
                {isHighAlertDrug(group.drugName) ? (
                  <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-800">
                    HIGH ALERT
                  </span>
                ) : null}
              </div>
              <ul className="mt-2 space-y-1.5 border-l border-slate-100 pl-3">
                {group.rows.map((row) => {
                  const st = s(row.status).toLowerCase();
                  const adverse = row.adverse_event === true;
                  const overdue = st === "pending" && isMarSlotOverdue(dateYmd, row.scheduled_time);
                  const timeRoute = `${formatTime(row.scheduled_time)} · ${routeCompact(row.route)}`;
                  const formattedTime = formatTime(row.scheduled_time);
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => openPopup(row, st !== "pending")}
                        className={cn(
                          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-transparent bg-slate-50/80 px-2.5 py-2 text-left text-sm transition hover:border-slate-200 hover:bg-slate-50",
                          st === "pending" && !overdue && "ring-1 ring-amber-100/90",
                          overdue && "ring-1 ring-red-200/90",
                        )}
                      >
                        <div className="min-w-0 flex-1 tabular-nums text-slate-700">{timeRoute}</div>
                        <div className="shrink-0">
                          <span
                            title={adverse ? "Adverse event recorded" : undefined}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                              overdue
                                ? "border border-red-300 bg-red-100 text-red-700"
                                : statusPillClass(st),
                              adverse && st === "given" && "ring-2 ring-red-400 ring-offset-1",
                            )}
                          >
                            {overdue ? (
                              <>
                                <span
                                  className="mr-1 h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse"
                                  aria-hidden
                                />
                                OVERDUE
                              </>
                            ) : (
                              statusPillLabel(st)
                            )}
                            {st === "pending" ? <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : null}
                            {st === "given" ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : null}
                            {st === "held" ? <Pause className="h-3.5 w-3.5" aria-hidden /> : null}
                            {st === "refused" ? <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : null}
                            {st === "omitted" ? <Minus className="h-3.5 w-3.5" aria-hidden /> : null}
                          </span>
                        </div>
                      </button>
                      {overdue ? (
                        <p className="mt-1 ml-2 text-xs text-red-500">
                          ⚠️ Due at {formattedTime} — not administered
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {modalRow ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[49] cursor-default bg-black/40"
            aria-label="Dismiss"
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[400px] max-w-[min(400px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {popupReadOnly ? (
              <>
                <h3 className="text-sm font-semibold leading-snug text-slate-900">
                  {s(modalRow.drug_name)} · {formatTime(modalRow.scheduled_time)}
                </h3>
                <div className="my-3 border-t border-slate-200" />
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Outcome</dt>
                    <dd className="text-right font-medium text-slate-900">{outcomeLabel(s(modalRow.status))}</dd>
                  </div>
                  {s(modalRow.status).toLowerCase() === "given" ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Dose</dt>
                        <dd className="text-right text-slate-800">
                          {s(modalRow.actual_dose_given) || s(modalRow.dose) || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Route</dt>
                        <dd className="text-right text-slate-800">
                          {routeLabelStored(modalRow.actual_route || modalRow.route)}
                        </dd>
                      </div>
                      {ROUTES_WITH_SITE.has(canonicalMarRoute(modalRow.actual_route || modalRow.route)) ? (
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-500">IV site</dt>
                          <dd className="max-w-[220px] text-right text-slate-800">{s(modalRow.iv_site) || "—"}</dd>
                        </div>
                      ) : null}
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Adverse event</dt>
                        <dd className="text-right text-slate-800">{modalRow.adverse_event ? "Yes" : "No"}</dd>
                      </div>
                    </>
                  ) : null}
                  {(s(modalRow.status).toLowerCase() === "held" || s(modalRow.status).toLowerCase() === "refused") &&
                  s(modalRow.hold_reason) ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Reason</dt>
                      <dd className="max-w-[220px] text-right text-slate-800">{s(modalRow.hold_reason)}</dd>
                    </div>
                  ) : null}
                  {s(modalRow.notes) ? (
                    <div className="pt-1">
                      <dt className="text-slate-500">Notes</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-slate-800">{s(modalRow.notes)}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
                  <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                    Close
                  </Button>
                </div>
              </>
            ) : modalAdminLocked ? (
              <>
                <h3 className="text-sm font-semibold leading-snug text-slate-900">
                  {s(modalRow.drug_name)} · {formatTime(modalRow.scheduled_time)}
                </h3>
                <div className="my-3 border-t border-slate-200" />
                <p className="text-sm leading-relaxed text-slate-700">
                  This dose window has expired. Mark as Omitted or contact the charge nurse.
                </p>
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button type="button" variant="outline" size="sm" onClick={closeModal} disabled={saveBusy}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" disabled={saveBusy} onClick={() => void submitOmittedWindowExpired()}>
                    {saveBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Mark as Omitted
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold leading-snug text-slate-900">
                  {s(modalRow.drug_name)} · {formatTime(modalRow.scheduled_time)}
                </h3>
                <div className="my-3 border-t border-slate-200" />
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Outcome</Label>
                    <Select value={modalStatus} onValueChange={(v) => setModalStatus(v as typeof modalStatus)}>
                      <SelectTrigger className="mt-1 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="given">Given</SelectItem>
                        <SelectItem value="held">Held</SelectItem>
                        <SelectItem value="refused">Refused</SelectItem>
                        <SelectItem value="omitted">Omitted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {modalStatus === "given" ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Dose</Label>
                          <Input
                            className="mt-1 h-9 text-sm"
                            value={actualDose}
                            onChange={(e) => setActualDose(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Route</Label>
                          <Select
                            value={actualRoute}
                            onValueChange={(v) => {
                              setActualRoute(v);
                              if (!ROUTES_WITH_SITE.has(v)) {
                                setIvLaterality("");
                                setIvSitePart("");
                              }
                            }}
                          >
                            <SelectTrigger className="mt-1 h-9 text-sm">
                              <SelectValue placeholder="Route" />
                            </SelectTrigger>
                            <SelectContent>
                              {MAR_ROUTE_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {showIvSiteField ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Side</Label>
                            <Select
                              value={ivLaterality ? ivLaterality : SELECT_UNSET}
                              onValueChange={(v) => setIvLaterality(v === SELECT_UNSET ? "" : v)}
                            >
                              <SelectTrigger className="mt-1 h-9 text-sm">
                                <SelectValue placeholder="Select side..." />
                              </SelectTrigger>
                              <SelectContent>
                                {MAR_IV_LATERALITY_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Site</Label>
                            <Select
                              value={ivSitePart ? ivSitePart : SELECT_UNSET}
                              onValueChange={(v) => setIvSitePart(v === SELECT_UNSET ? "" : v)}
                            >
                              <SelectTrigger className="mt-1 h-9 text-sm">
                                <SelectValue placeholder="Select site..." />
                              </SelectTrigger>
                              <SelectContent>
                                {MAR_IV_SITE_PART_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ) : null}
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={adverse} onChange={(e) => setAdverse(e.target.checked)} />
                        Adverse event
                      </label>
                    </>
                  ) : null}

                  {modalStatus === "held" ? (
                    <div>
                      <Label className="text-xs">Hold reason</Label>
                      <Select value={holdRefuseReason || undefined} onValueChange={setHoldRefuseReason}>
                        <SelectTrigger className="mt-1 h-9">
                          <SelectValue placeholder="Select reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {HOLD_REASONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {modalStatus === "refused" ? (
                    <div>
                      <Label className="text-xs">Refusal reason</Label>
                      <Select value={holdRefuseReason || undefined} onValueChange={setHoldRefuseReason}>
                        <SelectTrigger className="mt-1 h-9">
                          <SelectValue placeholder="Select reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {REFUSE_REASONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Input className="mt-1 h-9 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button type="button" variant="outline" size="sm" onClick={closeModal} disabled={saveBusy}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" disabled={saveBusy} onClick={() => void submitModal()}>
                    {saveBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
