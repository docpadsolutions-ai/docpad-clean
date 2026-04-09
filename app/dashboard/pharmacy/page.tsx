"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PharmacyInventory } from "@/app/components/pharmacy/PharmacyInventory";
import { fetchAuthOrgId } from "../../lib/authOrg";
import { supabase } from "../../supabase";
import { filterLedgerRows, PharmacyLedger, type PharmacyLedgerRow } from "./PharmacyLedger";
import { PharmacyExpiringStockWidget } from "./PharmacyExpiringStockWidget";
import { PharmacyRestockForm } from "./PharmacyRestockForm";
import {
  parseRpcReceiptData,
  PrescriptionReceiptModal,
  withMedicationDispensedQuantity,
  type PrescriptionReceiptPayload,
} from "./PrescriptionReceiptModal";
import {
  countQueueGroups,
  filterPrescriptionQueueRows,
  type OrderedPrescriptionRow,
  PrescriptionQueue,
} from "./PrescriptionQueue";

type MainTab = "queue" | "ledger" | "formulary";

type PendingQueueDispense = {
  prescriptionId: string;
  dispensedQuantity: number;
  notes: string | null;
  pharmacistId: string;
};

function patchReceiptPayloadDispensedQty(
  payload: PrescriptionReceiptPayload,
  dispensedQuantity: number,
): PrescriptionReceiptPayload {
  return {
    ...payload,
    medication: withMedicationDispensedQuantity(payload.medication, dispensedQuantity),
  };
}

/**
 * Pharmacy dashboard — ordered queue: `SELECT * FROM pharmacy_ordered_prescription_queue WHERE hospital_id = :org`
 * (patient_name and Rx columns come from the view). Low stock: pharmacy_low_stock_items only.
 */

type LowStockRow = {
  id: string;
  brand_name: string | null;
  generic_name: string | null;
  stock_quantity: number | null;
  reorder_level: number | null;
};

function parseQty(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function lowStockSeverity(stock: number, reorder: number): "red" | "amber" {
  if (reorder <= 0) return stock <= 0 ? "red" : "amber";
  if (stock <= 0) return "red";
  const critical = Math.max(1, Math.floor(reorder * 0.25));
  if (stock < critical) return "red";
  return "amber";
}

/** Normalize PostgREST embedded one-to-one (object or single-element array). */
function normalizeEmbed<T>(v: unknown): T | null {
  if (v == null) return null;
  return (Array.isArray(v) ? v[0] ?? null : v) as T | null;
}

function normalizePrescriptionQueueRow(row: unknown): OrderedPrescriptionRow {
  const r = row as Record<string, unknown>;
  const fromEmbed = normalizeEmbed<OrderedPrescriptionRow["patients"]>(r.patients);
  const patients: OrderedPrescriptionRow["patients"] =
    fromEmbed ??
    (r.queue_patient_id != null || r.patient_name != null || r.patient_docpad_id != null
      ? {
          id: String(r.queue_patient_id ?? r.patient_id ?? ""),
          full_name: (r.patient_name as string | null) ?? null,
          docpad_id: (r.patient_docpad_id as string | null) ?? null,
        }
      : null);
  return {
    ...(r as unknown as OrderedPrescriptionRow),
    patients,
    hospital_inventory: normalizeEmbed<OrderedPrescriptionRow["hospital_inventory"]>(r.hospital_inventory),
  };
}

/** Ordered queue: `SELECT * FROM pharmacy_ordered_prescription_queue WHERE hospital_id = ?` — no extra joins. */
async function fetchOrderedPrescriptions(
  pharmacistHospitalId: string,
): Promise<{ rows: OrderedPrescriptionRow[]; error: string | null }> {
  const { data: rawList, error: rxErr } = await supabase
    .from("pharmacy_ordered_prescription_queue")
    .select("*")
    .eq("hospital_id", pharmacistHospitalId)
    .order("created_at", { ascending: false });

  if (rxErr) return { rows: [], error: rxErr.message };

  const rows = (rawList ?? []).map((row) => normalizePrescriptionQueueRow(row));
  return { rows, error: null };
}

/** Low stock: `SELECT id, brand_name, generic_name, stock_quantity, reorder_level FROM pharmacy_low_stock_items WHERE hospital_id = ?` */
async function fetchLowStockFromView(orgId: string): Promise<{ rows: LowStockRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("pharmacy_low_stock_items")
    .select("id, brand_name, generic_name, stock_quantity, reorder_level")
    .eq("hospital_id", orgId)
    .order("stock_quantity", { ascending: true, nullsFirst: true });

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as LowStockRow[], error: null };
}

/** DB: pharmacy_dispensed_today_count(p_hospital_id) — pharmacist's hospital_id (same as auth_org()). */
async function fetchDispensedTodayCount(pharmacistHospitalId: string): Promise<{ count: number; error: string | null }> {
  const { data, error } = await supabase.rpc("pharmacy_dispensed_today_count", {
    p_hospital_id: pharmacistHospitalId,
  });
  if (error) return { count: 0, error: error.message };
  const n = typeof data === "number" ? data : parseInt(String(data ?? "0"), 10);
  return { count: Number.isFinite(n) ? n : 0, error: null };
}

/** RPC get_expiring_stock_counts(p_hospital_id) → { critical, warning }. */
async function fetchExpiringStockCounts(
  pharmacistHospitalId: string,
): Promise<{ critical: number; warning: number; error: string | null }> {
  const { data, error } = await supabase.rpc("get_expiring_stock_counts", {
    p_hospital_id: pharmacistHospitalId,
  });
  if (error) return { critical: 0, warning: 0, error: error.message };
  const def = { critical: 0, warning: 0 };
  if (data == null) return { ...def, error: null };
  let o: Record<string, unknown>;
  if (typeof data === "string") {
    try {
      o = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return { ...def, error: null };
    }
  } else if (typeof data === "object") {
    o = data as Record<string, unknown>;
  } else {
    return { ...def, error: null };
  }
  const critical = typeof o.critical === "number" ? o.critical : parseInt(String(o.critical ?? "0"), 10);
  const warning = typeof o.warning === "number" ? o.warning : parseInt(String(o.warning ?? "0"), 10);
  return {
    critical: Number.isFinite(critical) ? critical : 0,
    warning: Number.isFinite(warning) ? warning : 0,
    error: null,
  };
}

/** Ledger: `SELECT * FROM pharmacy_dispensed_prescriptions WHERE hospital_id = ? ORDER BY dispensed_at DESC`. */
async function fetchPharmacyLedger(hospitalId: string): Promise<{ rows: PharmacyLedgerRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("pharmacy_dispensed_prescriptions")
    .select("*")
    .eq("hospital_id", hospitalId)
    .order("dispensed_at", { ascending: false })
    .limit(500);

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as PharmacyLedgerRow[], error: null };
}

const searchInputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

const tabBtnBase =
  "rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2";
const tabBtnActive = "bg-emerald-600 text-white shadow-sm";
const tabBtnIdle = "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

export default function PharmacyDashboardPage() {
  const pendingDispenseRef = useRef<PendingQueueDispense | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("queue");
  const [rows, setRows] = useState<OrderedPrescriptionRow[]>([]);
  const [ledgerRows, setLedgerRows] = useState<PharmacyLedgerRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [dispensedTodayCount, setDispensedTodayCount] = useState<number>(0);
  const [expiringCritical, setExpiringCritical] = useState(0);
  const [expiringWarning, setExpiringWarning] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [lowStockLoading, setLowStockLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [expiringLoading, setExpiringLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [lowStockError, setLowStockError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [expiringError, setExpiringError] = useState<string | null>(null);
  const [queueSearch, setQueueSearch] = useState("");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptPayload, setReceiptPayload] = useState<PrescriptionReceiptPayload | null>(null);
  const [receiptPrescriptionId, setReceiptPrescriptionId] = useState<string | null>(null);
  const [receiptAwaitingDispenseConfirm, setReceiptAwaitingDispenseConfirm] = useState(false);
  const [receiptConfirmBusy, setReceiptConfirmBusy] = useState(false);
  const [receiptConfirmError, setReceiptConfirmError] = useState<string | null>(null);

  const filteredRows = useMemo(
    () => filterPrescriptionQueueRows(rows, queueSearch),
    [rows, queueSearch],
  );

  const queueSummary = useMemo(() => {
    const cards = countQueueGroups(filteredRows);
    const lines = filteredRows.length;
    return { cards, lines };
  }, [filteredRows]);

  const searchTrim = queueSearch.trim();
  const searchEmpty = searchTrim.length > 0 && filteredRows.length === 0 && rows.length > 0;

  const filteredLedgerRows = useMemo(
    () => filterLedgerRows(ledgerRows, ledgerSearch),
    [ledgerRows, ledgerSearch],
  );
  const ledgerSearchTrim = ledgerSearch.trim();
  const ledgerSearchEmpty =
    ledgerSearchTrim.length > 0 && filteredLedgerRows.length === 0 && ledgerRows.length > 0;

  const loadDashboard = useCallback(async () => {
    setQueueLoading(true);
    setLedgerLoading(true);
    setLowStockLoading(true);
    setStatsLoading(true);
    setExpiringLoading(true);
    setQueueError(null);
    setLedgerError(null);
    setLowStockError(null);
    setStatsError(null);
    setExpiringError(null);

    const { orgId: pharmacistHospitalId, error: orgErr } = await fetchAuthOrgId();
    if (orgErr) {
      setHospitalId(null);
      setRows([]);
      setLedgerRows([]);
      setLowStock([]);
      setDispensedTodayCount(0);
      setExpiringCritical(0);
      setExpiringWarning(0);
      setQueueError(orgErr.message);
      setLedgerError(orgErr.message);
      setLowStockError(orgErr.message);
      setStatsError(orgErr.message);
      setExpiringError(orgErr.message);
      setQueueLoading(false);
      setLedgerLoading(false);
      setLowStockLoading(false);
      setStatsLoading(false);
      setExpiringLoading(false);
      return;
    }
    if (!pharmacistHospitalId) {
      setHospitalId(null);
      setRows([]);
      setLedgerRows([]);
      setLowStock([]);
      setDispensedTodayCount(0);
      setExpiringCritical(0);
      setExpiringWarning(0);
      setQueueError("No hospital context — cannot load data.");
      setLedgerError("No hospital context — cannot load data.");
      setLowStockError("No hospital context — cannot load data.");
      setStatsError("No hospital context — cannot load data.");
      setExpiringError("No hospital context — cannot load data.");
      setQueueLoading(false);
      setLedgerLoading(false);
      setLowStockLoading(false);
      setStatsLoading(false);
      setExpiringLoading(false);
      return;
    }

    setHospitalId(pharmacistHospitalId);

    const [rxRes, ledgerRes, invRes, statsRes, expRes] = await Promise.all([
      fetchOrderedPrescriptions(pharmacistHospitalId),
      fetchPharmacyLedger(pharmacistHospitalId),
      fetchLowStockFromView(pharmacistHospitalId),
      fetchDispensedTodayCount(pharmacistHospitalId),
      fetchExpiringStockCounts(pharmacistHospitalId),
    ]);

    if (rxRes.error) setQueueError(rxRes.error);
    setRows(rxRes.rows);
    setQueueLoading(false);

    if (ledgerRes.error) setLedgerError(ledgerRes.error);
    setLedgerRows(ledgerRes.rows);
    setLedgerLoading(false);

    if (invRes.error) setLowStockError(invRes.error);
    setLowStock(invRes.rows);
    setLowStockLoading(false);

    if (statsRes.error) setStatsError(statsRes.error);
    setDispensedTodayCount(statsRes.count);
    setStatsLoading(false);

    if (expRes.error) setExpiringError(expRes.error);
    setExpiringCritical(expRes.critical);
    setExpiringWarning(expRes.warning);
    setExpiringLoading(false);
  }, []);

  const resetReceiptUi = useCallback(() => {
    pendingDispenseRef.current = null;
    setReceiptAwaitingDispenseConfirm(false);
    setReceiptConfirmBusy(false);
    setReceiptConfirmError(null);
    setReceiptOpen(false);
    setReceiptLoading(false);
    setReceiptError(null);
    setReceiptPayload(null);
    setReceiptPrescriptionId(null);
  }, []);

  const closeReceiptModal = useCallback(() => {
    resetReceiptUi();
  }, [resetReceiptUi]);

  /** Ledger / reprint: receipt only, no dispense. */
  const openReceiptViewOnly = useCallback(async (prescriptionId: string) => {
    pendingDispenseRef.current = null;
    setReceiptAwaitingDispenseConfirm(false);
    setReceiptConfirmError(null);
    setReceiptOpen(true);
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptPayload(null);
    setReceiptPrescriptionId(prescriptionId);
    const { data, error: rpcErr } = await supabase.rpc("generate_prescription_receipt", {
      prescription_id: prescriptionId,
    });
    if (rpcErr) {
      setReceiptLoading(false);
      setReceiptError(rpcErr.message);
      return;
    }
    const parsed = parseRpcReceiptData(data);
    if (!parsed) {
      setReceiptLoading(false);
      setReceiptError("Could not read receipt data.");
      return;
    }
    setReceiptPayload(parsed);
    setReceiptLoading(false);
  }, []);

  /** Queue: generate receipt first; user confirms dispense in modal. */
  const openReceiptPreviewForDispense = useCallback(async (pending: PendingQueueDispense) => {
    pendingDispenseRef.current = pending;
    setReceiptAwaitingDispenseConfirm(true);
    setReceiptConfirmError(null);
    setReceiptOpen(true);
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptPayload(null);
    setReceiptPrescriptionId(pending.prescriptionId);
    const { data, error: rpcErr } = await supabase.rpc("generate_prescription_receipt", {
      prescription_id: pending.prescriptionId,
    });
    if (rpcErr) {
      setReceiptLoading(false);
      setReceiptError(rpcErr.message);
      pendingDispenseRef.current = null;
      setReceiptAwaitingDispenseConfirm(false);
      return;
    }
    const parsed = parseRpcReceiptData(data);
    if (!parsed) {
      setReceiptLoading(false);
      setReceiptError("Could not read receipt data.");
      pendingDispenseRef.current = null;
      setReceiptAwaitingDispenseConfirm(false);
      return;
    }
    setReceiptPayload(patchReceiptPayloadDispensedQty(parsed, pending.dispensedQuantity));
    setReceiptLoading(false);
  }, []);

  const handleConfirmDispenseFromReceiptModal = useCallback(async () => {
    const p = pendingDispenseRef.current;
    if (!p) return;
    setReceiptConfirmBusy(true);
    setReceiptConfirmError(null);
    const { error: rpcErr } = await supabase.rpc("dispense_prescription", {
      p_prescription_id: p.prescriptionId,
      p_dispensed_quantity: p.dispensedQuantity,
      p_pharmacist_id: p.pharmacistId,
      p_notes: p.notes,
    });
    setReceiptConfirmBusy(false);
    if (rpcErr) {
      setReceiptConfirmError(rpcErr.message);
      return;
    }
    resetReceiptUi();
    void loadDashboard();
  }, [loadDashboard, resetReceiptUi]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const initialLoading = queueLoading && ledgerLoading && lowStockLoading && statsLoading && expiringLoading;

  const lowStockSection = useMemo(() => {
    if (lowStockLoading && lowStock.length === 0 && !lowStockError) {
      return <p className="text-sm text-slate-500">Loading from pharmacy_low_stock_items…</p>;
    }
    if (lowStockError) {
      return (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"
        >
          {lowStockError}
          <p className="mt-2 text-[11px] text-amber-800">
            Ensure the <code className="rounded bg-amber-100 px-1">pharmacy_low_stock_items</code> view exists and{" "}
            <code className="rounded bg-amber-100 px-1">select</code> is granted.
          </p>
        </div>
      );
    }
    if (lowStock.length === 0) {
      return (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          No rows in <code className="rounded bg-white px-1">pharmacy_low_stock_items</code> — all SKUs at or above
          reorder level.
        </p>
      );
    }
    return (
      <ul className="max-h-[min(32vh,360px)] space-y-2 overflow-y-auto pr-1">
        {lowStock.map((item) => {
          const stock = parseQty(item.stock_quantity);
          const reorder = parseQty(item.reorder_level);
          const sev = lowStockSeverity(stock, reorder > 0 ? reorder : 25);
          const label = (item.brand_name ?? item.generic_name ?? "Item").trim();
          const sub = item.generic_name && item.brand_name ? item.generic_name : null;
          return (
            <li
              key={item.id}
              className={
                sev === "red"
                  ? "rounded-xl border border-red-200 bg-red-50 px-3 py-2.5"
                  : "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className={
                      sev === "red"
                        ? "text-sm font-semibold text-red-950"
                        : "text-sm font-semibold text-amber-950"
                    }
                  >
                    {label}
                  </p>
                  {sub ? (
                    <p
                      className={
                        sev === "red" ? "truncate text-xs text-red-800/90" : "truncate text-xs text-amber-900/85"
                      }
                    >
                      {sub}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p
                    className={
                      sev === "red" ? "text-sm font-bold text-red-700" : "text-sm font-bold text-amber-800"
                    }
                  >
                    {stock} <span className="font-normal opacity-80">/ {reorder}</span>
                  </p>
                  <p
                    className={
                      sev === "red" ? "text-[10px] font-medium uppercase text-red-600" : "text-[10px] font-medium uppercase text-amber-700"
                    }
                  >
                    {sev === "red" ? "Critical" : "Reorder"}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }, [lowStockLoading, lowStockError, lowStock]);

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Pharmacy</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Queue and stock at a glance — dispensing updates Rx rows only until inventory is wired (Phase 4).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={initialLoading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh
            </button>
            <Link
              href="/dashboard/pharmacy/audit"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Audit
            </Link>
            <Link
              href="/dashboard/pharmacy/inventory"
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Inventory
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10">
          <section className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dispensed today</p>
              {statsLoading ? (
                <p className="mt-2 text-sm text-slate-400">Loading…</p>
              ) : statsError ? (
                <p className="mt-2 text-sm text-red-600" role="alert">
                  {statsError}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{dispensedTodayCount}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Via{" "}
                    <code className="rounded bg-slate-100 px-1">pharmacy_dispensed_today_count(p_hospital_id)</code>{" "}
                    (your hospital from session)
                    : <code className="rounded bg-slate-100 px-1">dispensed_at::date = current_date</code>,{" "}
                    <code className="rounded bg-slate-100 px-1">status = dispensed</code>, patients in that hospital.
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
              <button
                type="button"
                onClick={() => setMainTab("queue")}
                className={`${tabBtnBase} ${mainTab === "queue" ? tabBtnActive : tabBtnIdle}`}
              >
                Queue
              </button>
              <button
                type="button"
                onClick={() => setMainTab("ledger")}
                className={`${tabBtnBase} ${mainTab === "ledger" ? tabBtnActive : tabBtnIdle}`}
              >
                Ledger
              </button>
              <button
                type="button"
                onClick={() => setMainTab("formulary")}
                className={`${tabBtnBase} ${mainTab === "formulary" ? tabBtnActive : tabBtnIdle}`}
              >
                Formulary
              </button>
            </div>

            {mainTab === "formulary" ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <PharmacyInventory role="viewer" variant="embedded" />
              </div>
            ) : mainTab === "queue" ? (
              <>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Prescription queue</h2>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {queueSummary.cards} order{queueSummary.cards === 1 ? "" : "s"} · {queueSummary.lines} drug
                    {queueSummary.lines === 1 ? "" : "s"}
                    {searchTrim && rows.length !== filteredRows.length ? (
                      <span className="text-slate-500"> · of {rows.length}</span>
                    ) : null}
                  </span>
                </div>

                <label className="sr-only" htmlFor="pharmacy-queue-search">
                  Search queue by patient or drug
                </label>
                <input
                  id="pharmacy-queue-search"
                  type="search"
                  placeholder="Search by patient name, DocPad ID, or drug…"
                  autoComplete="off"
                  value={queueSearch}
                  onChange={(e) => setQueueSearch(e.target.value)}
                  className={searchInputCls}
                />

                <PrescriptionQueue
                  rows={filteredRows}
                  loading={queueLoading}
                  error={queueError}
                  onRefresh={() => void loadDashboard()}
                  hospitalId={hospitalId}
                  openReceiptPreviewForDispense={openReceiptPreviewForDispense}
                  searchEmpty={searchEmpty}
                  unfilteredLineCount={rows.length}
                />
              </>
            ) : mainTab === "ledger" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Dispense ledger</h2>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {filteredLedgerRows.length} line{filteredLedgerRows.length === 1 ? "" : "s"}
                    {ledgerSearchTrim && ledgerRows.length !== filteredLedgerRows.length ? (
                      <span className="text-slate-500"> · of {ledgerRows.length}</span>
                    ) : null}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  <code className="rounded bg-slate-100 px-1">SELECT * FROM pharmacy_dispensed_prescriptions</code>{" "}
                  where <code className="rounded bg-slate-100 px-1">hospital_id</code> is your org,{" "}
                  <code className="rounded bg-slate-100 px-1">ORDER BY dispensed_at DESC</code>. Click a row for receipt +
                  Print.
                </p>
                <label className="sr-only" htmlFor="pharmacy-ledger-search">
                  Search ledger by patient or medication
                </label>
                <input
                  id="pharmacy-ledger-search"
                  type="search"
                  placeholder="Search by patient or medication…"
                  autoComplete="off"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  className={searchInputCls}
                />
                <PharmacyLedger
                  rows={filteredLedgerRows}
                  unfilteredRowCount={ledgerRows.length}
                  loading={ledgerLoading}
                  error={ledgerError}
                  searchEmpty={ledgerSearchEmpty}
                  onRowClick={(prescriptionId) => void openReceiptViewOnly(prescriptionId)}
                />
              </div>
            ) : null}
          </section>

          <aside className="flex min-w-0 flex-col gap-6">
            <PharmacyExpiringStockWidget
              hospitalId={hospitalId}
              criticalCount={expiringCritical}
              warningCount={expiringWarning}
              countsLoading={expiringLoading}
              countsError={expiringError}
              onMarkedExpired={() => void loadDashboard()}
            />

            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Low stock</h2>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  {lowStock.length} SKU{lowStock.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mb-3 text-xs text-slate-500">
                From view <code className="rounded bg-slate-100 px-1">pharmacy_low_stock_items</code> only (rows where{" "}
                <code className="rounded bg-slate-100 px-1">stock_quantity &lt; reorder_level</code>).
              </p>
              {lowStockSection}
            </section>

            <PharmacyRestockForm hospitalId={hospitalId} onRestocked={() => void loadDashboard()} />
          </aside>
        </div>

        <PrescriptionReceiptModal
          open={receiptOpen}
          payload={receiptPayload}
          prescriptionId={receiptPrescriptionId}
          loading={receiptLoading}
          error={receiptError}
          onClose={closeReceiptModal}
          variant={receiptAwaitingDispenseConfirm ? "preview" : "view"}
          showConfirmDispense={receiptAwaitingDispenseConfirm}
          onConfirmDispense={handleConfirmDispenseFromReceiptModal}
          confirmDispenseBusy={receiptConfirmBusy}
          confirmDispenseError={receiptConfirmError}
        />
      </main>
    </div>
  );
}
