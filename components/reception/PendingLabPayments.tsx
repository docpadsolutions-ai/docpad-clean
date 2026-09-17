"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { practitionersOrFilterForAuthUid } from "@/lib/practitionerAuthLookup";
import { cn } from "@/lib/utils";

function sv(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type ChargeDefEmbed = {
  /** Canonical column in migrations; some DBs may expose `unit_price` instead. */
  base_price?: unknown;
  unit_price?: unknown;
};

type PendingRow = {
  id: string;
  test_name: string | null;
  test_category: string | null;
  priority: string | null;
  ordered_date: string | null;
  charge_item_id: string | null;
  created_at: string | null;
  /** Merged client-side from a separate `charge_item_definitions` query (not PostgREST embed). */
  charge_item_definitions: ChargeDefEmbed | null;
  patient: { full_name: string | null } | { full_name: string | null }[] | null;
  ipd_admissions:
    | {
        admission_number: string | null;
        ward: { name: string | null } | { name: string | null }[] | null;
        bed: { bed_number: string | null } | { bed_number: string | null }[] | null;
      }
    | null
    | Array<{
        admission_number: string | null;
        ward: { name: string | null } | { name: string | null }[] | null;
        bed: { bed_number: string | null } | { bed_number: string | null }[] | null;
      }>;
};

type PaymentHistoryRow = {
  id: string;
  amount: number | null;
  payment_method: string | null;
  payment_date: string | null;
  patient_id: string | null;
  patient: { full_name: string | null } | { full_name: string | null }[] | null;
};

type OpdChargeRow = {
  source: "opd";
  id: string;
  patient_id: string;
  encounter_id: string | null;
  charge_code_display: string | null;
  unit_price: number | null;
  net_amount: number | null;
  source_id: string | null;
  created_at: string | null;
  patient: { full_name: string | null } | { full_name: string | null }[] | null;
};

type IpdPendingRow = PendingRow & { source: "ipd" };

type UnifiedRow = IpdPendingRow | OpdChargeRow;

function isIpdRow(r: UnifiedRow): r is IpdPendingRow {
  return r.source === "ipd";
}

function pickOne<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

function rowAmountInr(row: IpdPendingRow): number | null {
  const def = row.charge_item_definitions;
  const raw = def?.unit_price ?? def?.base_price;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function createdAtMs(row: UnifiedRow): number {
  const t = row.created_at;
  if (!t) return 0;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

const sourceBadgeIpd =
  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset bg-slate-100 text-slate-800 ring-slate-200";
const sourceBadgeOpd =
  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset bg-indigo-50 text-indigo-900 ring-indigo-200";

function priorityClass(p: string | null | undefined): string {
  const t = (p ?? "").toLowerCase();
  if (t === "stat") return "bg-red-100 text-red-900 ring-red-200";
  if (t === "urgent") return "bg-amber-100 text-amber-950 ring-amber-200";
  return "bg-slate-100 text-slate-800 ring-slate-200";
}

const btnPrimary =
  "inline-flex items-center justify-center rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40";
const btnGhost =
  "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50";

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function todayUtcStart(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function PendingLabPaymentsSection({
  hospitalId,
  onPendingCountChange,
}: {
  hospitalId: string | null;
  /** Fired when the pending list length changes (same data as the table). */
  onPendingCountChange?: (count: number) => void;
}) {
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<Record<string, "Cash" | "UPI" | "Card">>({});
  const [overrideOpen, setOverrideOpen] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [history, setHistory] = useState<PaymentHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    if (!hospitalId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data: orderData, error: orderErr } = await supabase
      .from("ipd_investigation_orders")
      .select(
        `
        id, test_name, test_category, priority, ordered_date, charge_item_id, created_at,
        patient:patients(full_name),
        ipd_admissions(admission_number, ward:ipd_wards(name), bed:ipd_beds(bed_number))
      `,
      )
      .eq("hospital_id", hospitalId)
      .eq("billing_status", "pending_payment")
      .order("created_at", { ascending: true });

    if (orderErr) {
      setErr(orderErr.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const rawOrders = (orderData ?? []) as Omit<PendingRow, "charge_item_definitions">[];
    const defIds = [...new Set(rawOrders.map((o) => sv(o.charge_item_id)).filter(Boolean))];

    const priceByDefId = new Map<string, ChargeDefEmbed>();
    if (defIds.length > 0) {
      const { data: defData, error: defErr } = await supabase
        .from("charge_item_definitions")
        .select("id, base_price")
        .eq("hospital_id", hospitalId)
        .in("id", defIds);
      if (defErr) {
        setErr(defErr.message);
        setRows([]);
        setLoading(false);
        return;
      }
      for (const row of defData ?? []) {
        const rec = row as Record<string, unknown>;
        const id = sv(rec.id);
        if (!id) continue;
        priceByDefId.set(id, {
          base_price: rec.base_price,
        });
      }
    }

    const merged: PendingRow[] = rawOrders.map((o) => {
      const cid = sv(o.charge_item_id);
      return {
        ...o,
        charge_item_definitions: cid ? priceByDefId.get(cid) ?? null : null,
      };
    });

    const { data: chargeData, error: chargeErr } = await supabase
      .from("charge_items")
      .select(
        "id, patient_id, encounter_id, charge_code_display, unit_price, net_amount, source_id, created_at, patient:patients(full_name)",
      )
      .eq("hospital_id", hospitalId)
      .eq("source_type", "service_request")
      .eq("status", "billable")
      .order("created_at", { ascending: true });

    if (chargeErr) {
      setErr((prev) => (prev ? `${prev}\n${chargeErr.message}` : chargeErr.message));
    }

    const opdRows: OpdChargeRow[] = (chargeData ?? []).map((raw) => {
      const rec = raw as Record<string, unknown>;
      const netRaw = rec.net_amount;
      const unitRaw = rec.unit_price;
      const net = netRaw != null && netRaw !== "" ? Number(netRaw) : NaN;
      const unit = unitRaw != null && unitRaw !== "" ? Number(unitRaw) : NaN;
      return {
        source: "opd" as const,
        id: sv(rec.id),
        patient_id: sv(rec.patient_id),
        encounter_id: rec.encounter_id != null ? sv(rec.encounter_id) : null,
        charge_code_display: rec.charge_code_display != null ? sv(rec.charge_code_display) : null,
        unit_price: Number.isFinite(unit) ? unit : null,
        net_amount: Number.isFinite(net) ? net : null,
        source_id: rec.source_id != null ? sv(rec.source_id) : null,
        created_at: rec.created_at != null ? sv(rec.created_at) : null,
        patient: rec.patient as OpdChargeRow["patient"],
      };
    });

    const ipdUnified: IpdPendingRow[] = merged.map((o) => ({ ...o, source: "ipd" as const }));
    const combined: UnifiedRow[] = [...ipdUnified, ...opdRows].sort((a, b) => createdAtMs(a) - createdAtMs(b));

    setRows(combined);
    setLoading(false);
  }, [hospitalId]);

  const loadHistory = useCallback(async () => {
    if (!hospitalId) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    const { data } = await supabase
      .from("payments")
      .select("id, amount, payment_method, payment_date, patient_id, patient:patients(full_name)")
      .eq("hospital_id", hospitalId)
      .gte("payment_date", todayUtcStart())
      .order("payment_date", { ascending: false })
      .limit(20);
    setHistory(
      (data ?? []).map((raw) => {
        const rec = raw as Record<string, unknown>;
        const amtRaw = rec.amount;
        const n = amtRaw != null ? Number(amtRaw) : NaN;
        return {
          id: sv(rec.id),
          amount: Number.isFinite(n) ? n : null,
          payment_method: rec.payment_method != null ? sv(rec.payment_method) : null,
          payment_date: rec.payment_date != null ? sv(rec.payment_date) : null,
          patient_id: rec.patient_id != null ? sv(rec.patient_id) : null,
          patient: rec.patient as PaymentHistoryRow["patient"],
        };
      }),
    );
    setHistoryLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onPendingCountChange?.(rows.length);
  }, [rows.length, onPendingCountChange]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;
      const { data: pr } = await supabase.from("practitioners").select("id").or(practitionersOrFilterForAuthUid(uid)).maybeSingle();
      if (!cancelled && pr?.id) setPractitionerId(String(pr.id));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase
      .channel(`reception-lab-payments-${hospitalId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ipd_investigation_orders", filter: `hospital_id=eq.${hospitalId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "investigations", filter: `hospital_id=eq.${hospitalId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "charge_items", filter: `hospital_id=eq.${hospitalId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payments", filter: `hospital_id=eq.${hospitalId}` },
        () => void loadHistory(),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [hospitalId, load, loadHistory]);

  async function collectPayment(row: IpdPendingRow) {
    if (!hospitalId) {
      toast.error("No hospital context.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id;
    if (!uid) {
      toast.error("Sign in to collect payment.");
      return;
    }
    setBusyKey(`ipd:${row.id}`);
    const { error } = await supabase.rpc("collect_lab_payment", {
      p_investigation_order_id: row.id,
      p_collected_by: uid,
      p_hospital_id: hospitalId,
    });
    setBusyKey(null);
    if (error) {
      const e = error as { message?: string; code?: string; details?: string };
      const blob = `${e.message ?? ""} ${e.code ?? ""} ${e.details ?? ""}`.toLowerCase();
      if (blob.includes("already_paid")) {
        toast.error("Already collected");
      } else {
        toast.error(e.message || "Could not collect payment");
      }
      return;
    }
    const amt = rowAmountInr(row);
    toast.success(
      amt != null
        ? `Payment collected · ₹${amt.toFixed(0)} added to invoice`
        : "Payment collected · added to invoice",
    );
    setRows((prev) => prev.filter((r) => !isIpdRow(r) || r.id !== row.id));
  }

  async function markOpdPaid(row: OpdChargeRow) {
    if (!hospitalId) {
      toast.error("No hospital context.");
      return;
    }
    const pid = practitionerId;
    if (!pid) {
      toast.error("No practitioner profile — sign in again.");
      return;
    }
    setBusyKey(`opd:${row.id}`);
    const net = row.net_amount != null ? Number(row.net_amount) : NaN;
    const paidAmount = Number.isFinite(net) ? net : 0;

    const { error } = await supabase.rpc("record_lab_payment", {
      p_charge_item_id: row.id,
      p_hospital_id: hospitalId,
      p_patient_id: row.patient_id,
      p_amount: paidAmount,
      p_payment_method: "cash",
      p_collected_by: pid,
      p_notes: null,
    });

    setBusyKey(null);
    if (error) {
      toast.error("Payment failed");
      return;
    }

    const invId = row.source_id?.trim();
    if (invId) {
      const { error: invErr } = await supabase
        .from("investigations")
        .update({ billing_status: "paid" })
        .eq("id", invId)
        .eq("hospital_id", hospitalId);
      if (invErr) {
        console.warn("[markOpdPaid] investigations billing_status", invErr.message);
      }
    }

    toast.success(`Marked paid · ₹${paidAmount.toFixed(0)}`);
    setRows((prev) => prev.filter((r) => r.source !== "opd" || r.id !== row.id));
    void loadHistory();
  }

  async function emergencyOverride(row: IpdPendingRow) {
    const pid = practitionerId;
    if (!pid) {
      setErr("No practitioner profile.");
      return;
    }
    const reason = overrideReason.trim();
    if (reason.length < 3) {
      setErr("Enter a reason (at least 3 characters).");
      return;
    }
    setBusyKey(`ipd:${row.id}`);
    const { error } = await supabase.rpc("confirm_investigation_emergency_override", {
      p_order_id: row.id,
      p_confirmed_by: pid,
      p_reason: reason,
    });
    setBusyKey(null);
    if (error) {
      setErr(error.message);
      return;
    }
    setOverrideOpen(null);
    setOverrideReason("");
    void load();
  }

  if (!hospitalId) return <p className="text-sm text-gray-500">No hospital context.</p>;

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Pending lab payments</h2>
        <p className="text-xs text-gray-500">
          IPD investigation orders and OPD lab charges awaiting payment before sample collection.
        </p>
      </div>
      {err ? <div className="px-4 py-3 text-sm text-red-600">{err}</div> : null}
      {loading && rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">No pending lab payments.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/90 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2.5">Patient</th>
                <th className="px-3 py-2.5">Ward / bed</th>
                <th className="px-3 py-2.5">Test</th>
                <th className="px-3 py-2.5">Priority</th>
                <th className="px-3 py-2.5">Price</th>
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const rowKey = `${row.source}:${row.id}`;
                const busy = busyKey === rowKey;

                if (isIpdRow(row)) {
                  const p = pickOne(row.patient);
                  const adm = pickOne(row.ipd_admissions as PendingRow["ipd_admissions"]);
                  const w = pickOne(adm?.ward as { name: string | null } | { name: string | null }[] | null);
                  const b = pickOne(adm?.bed as { bed_number: string | null } | { bed_number: string | null }[] | null);
                  const wardBed =
                    [sv(w?.name), b?.bed_number ? `Bed ${sv(b.bed_number)}` : ""].filter(Boolean).join(" · ") || "—";
                  const priceLabel = (() => {
                    if (!sv(row.charge_item_id)) return "—";
                    const def = row.charge_item_definitions;
                    const raw = def?.unit_price ?? def?.base_price;
                    const n = raw != null && raw !== "" ? Number(raw) : NaN;
                    return Number.isFinite(n) ? `₹${n.toFixed(0)}` : "—";
                  })();
                  const mode = payMode[row.id] ?? "Cash";
                  return (
                    <tr key={rowKey} className="hover:bg-gray-50/80">
                      <td className="px-3 py-3 font-medium text-gray-900">{sv(p?.full_name) || "—"}</td>
                      <td className="px-3 py-3 text-gray-700">{wardBed}</td>
                      <td className="px-3 py-3 text-gray-800">{sv(row.test_name) || "—"}</td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset",
                            priorityClass(row.priority),
                          )}
                        >
                          {sv(row.priority) || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-gray-800">{priceLabel}</td>
                      <td className="px-3 py-3">
                        <span className={sourceBadgeIpd}>IPD</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <select
                            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                            value={mode}
                            onChange={(e) =>
                              setPayMode((m) => ({ ...m, [row.id]: e.target.value as "Cash" | "UPI" | "Card" }))
                            }
                          >
                            <option value="Cash">Cash</option>
                            <option value="UPI">UPI</option>
                            <option value="Card">Card</option>
                          </select>
                          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void collectPayment(row)}>
                            {busy ? "…" : "Collect"}
                          </button>
                          <button type="button" className={btnGhost} onClick={() => setOverrideOpen(row.id)}>
                            Emergency override
                          </button>
                        </div>
                        {overrideOpen === row.id ? (
                          <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-2 text-left">
                            <textarea
                              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                              placeholder="Reason for override"
                              rows={2}
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                            />
                            <div className="mt-1 flex gap-2">
                              <button
                                type="button"
                                className={btnPrimary}
                                disabled={busy}
                                onClick={() => void emergencyOverride(row)}
                              >
                                Confirm override
                              </button>
                              <button type="button" className={btnGhost} onClick={() => setOverrideOpen(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                }

                const p = pickOne(row.patient);
                const n = row.net_amount != null ? Number(row.net_amount) : NaN;
                const priceLabel = Number.isFinite(n) ? `₹${n.toFixed(0)}` : "—";
                return (
                  <tr key={rowKey} className="hover:bg-gray-50/80">
                    <td className="px-3 py-3 font-medium text-gray-900">{sv(p?.full_name) || "—"}</td>
                    <td className="px-3 py-3 text-gray-500">—</td>
                    <td className="px-3 py-3 text-gray-800">{sv(row.charge_code_display) || "—"}</td>
                    <td className="px-3 py-3 text-gray-400">—</td>
                    <td className="px-3 py-3 tabular-nums text-gray-800">{priceLabel}</td>
                    <td className="px-3 py-3">
                      <span className={sourceBadgeOpd}>OPD</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void markOpdPaid(row)}>
                        {busy ? "…" : "Mark Paid"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-gray-100">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Today&apos;s lab collections</h2>
        </div>
        {historyLoading && history.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">Loading…</div>
        ) : history.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">No collections today.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/90 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2.5">Time</th>
                  <th className="px-3 py-2.5">Patient</th>
                  <th className="px-3 py-2.5">Amount</th>
                  <th className="px-3 py-2.5">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => {
                  const hp = pickOne(h.patient);
                  const amt = h.amount != null ? `₹${Number(h.amount).toFixed(0)}` : "—";
                  return (
                    <tr key={h.id} className="hover:bg-gray-50/80">
                      <td className="px-3 py-2.5 tabular-nums text-gray-600">{fmtTime(h.payment_date)}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{sv(hp?.full_name) || "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-800">{amt}</td>
                      <td className="px-3 py-2.5 capitalize text-gray-700">{sv(h.payment_method) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
