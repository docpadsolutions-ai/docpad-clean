"use client";

import Link from "next/link";
import { AlertTriangle, Banknote, Coins, CreditCard, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/lib/authOrg";
import { supabase } from "@/lib/supabase";

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function inr(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function sv(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type Summary = {
  total_collected?: number;
  cash?: number;
  upi?: number;
  card?: number;
};

type TxRow = {
  time?: string;
  patient_name?: string;
  patient?: string;
  type?: string;
  amount?: number;
  method?: string;
  collected_by?: string;
};

type OverrideRow = {
  patient_name?: string;
  patient?: string;
  token?: string;
  authorised_by?: string;
  authorised_by_name?: string;
  time?: string;
};

export default function ShiftReconciliationPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayYmd);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>({});
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);

  const load = useCallback(async () => {
    if (!hospitalId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("get_shift_reconciliation", {
      p_hospital_id: hospitalId,
      p_date: selectedDate,
    });
    if (rpcErr) {
      setError(rpcErr.message);
      setSummary({});
      setTransactions([]);
      setOverrides([]);
      setLoading(false);
      return;
    }
    const payload = (data ?? {}) as {
      summary?: Summary;
      transactions?: TxRow[];
      overrides?: OverrideRow[];
    };
    setSummary(payload.summary ?? {});
    setTransactions(Array.isArray(payload.transactions) ? payload.transactions : []);
    setOverrides(Array.isArray(payload.overrides) ? payload.overrides : []);
    setLoading(false);
  }, [hospitalId, selectedDate]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { hospitalId: hid, error: orgErr } = await fetchHospitalIdFromPractitionerAuthId();
      if (cancelled) return;
      if (orgErr) setError(orgErr.message);
      setHospitalId(hid);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const txTotal = useMemo(() => {
    let s = 0;
    for (const t of transactions) {
      const a = t.amount != null ? Number(t.amount) : NaN;
      if (Number.isFinite(a)) s += a;
    }
    return s;
  }, [transactions]);

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  body * { visibility: hidden !important; }
  #shift-reconciliation-print,
  #shift-reconciliation-print * { visibility: visible !important; }
  #shift-reconciliation-print {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    background: white !important;
  }
}
`,
        }}
      />
      <div className="min-h-screen bg-slate-50 p-4 md:p-6 lg:p-8">
        <div id="shift-reconciliation-print" className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link href="/reception" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                ← Reception
              </Link>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">Shift Reconciliation</h1>
              <p className="mt-1 text-sm text-gray-600">End-of-shift cash drawer verification</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50"
              >
                Print report
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          ) : null}

          <div className="no-print flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-gray-700">
              Date
              <input
                type="date"
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </label>
            {loading ? <span className="text-sm text-gray-500">Loading…</span> : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Coins className="h-4 w-4 text-amber-600" aria-hidden />
                Total Collected
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{inr(summary.total_collected)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Banknote className="h-4 w-4 text-emerald-600" aria-hidden />
                Cash
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{inr(summary.cash)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Smartphone className="h-4 w-4 text-violet-600" aria-hidden />
                UPI
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{inr(summary.upi)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <CreditCard className="h-4 w-4 text-sky-600" aria-hidden />
                Card
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{inr(summary.card)}</p>
            </div>
          </div>

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Transactions</h2>
            </div>
            {transactions.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">No transactions</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50/90 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2.5">Time</th>
                      <th className="px-3 py-2.5">Patient</th>
                      <th className="px-3 py-2.5">Type</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="px-3 py-2.5">Method</th>
                      <th className="px-3 py-2.5">Collected By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {transactions.map((t, i) => {
                      const typ = (sv(t.type) || "").toLowerCase();
                      const isLab = typ === "lab";
                      return (
                        <tr key={i} className="hover:bg-gray-50/80">
                          <td className="px-3 py-3 tabular-nums text-gray-700">{fmtTime(t.time)}</td>
                          <td className="px-3 py-3 font-medium text-gray-900">
                            {sv(t.patient_name) || sv(t.patient) || "—"}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={
                                isLab
                                  ? "inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-900 ring-1 ring-inset ring-indigo-200"
                                  : "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-800 ring-1 ring-inset ring-slate-200"
                              }
                            >
                              {isLab ? "Lab" : "Consultation"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-900">{inr(t.amount)}</td>
                          <td className="px-3 py-3 capitalize text-gray-700">{sv(t.method) || "—"}</td>
                          <td className="px-3 py-3 text-gray-700">{sv(t.collected_by) || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-gray-200 bg-gray-50/80">
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-right text-xs font-semibold uppercase text-gray-500">
                        Total
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-gray-900">
                        {inr(txTotal)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {overrides.length > 0 ? (
            <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/40 shadow-sm">
              <div className="border-b border-amber-100 px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
                  Payment Overrides
                </h2>
                <p className="mt-1 text-xs text-amber-900/90">
                  These patients were allowed in without payment. Verify with the authorising staff.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-amber-100 bg-amber-50/90 text-xs font-semibold uppercase tracking-wide text-amber-900/80">
                    <tr>
                      <th className="px-3 py-2.5">Patient</th>
                      <th className="px-3 py-2.5">Token</th>
                      <th className="px-3 py-2.5">Authorised By</th>
                      <th className="px-3 py-2.5">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {overrides.map((o, i) => (
                      <tr key={i} className="bg-white/60">
                        <td className="px-3 py-3 font-medium text-gray-900">
                          {sv(o.patient_name) || sv(o.patient) || "—"}
                        </td>
                        <td className="px-3 py-3 font-mono text-gray-800">{sv(o.token) || "—"}</td>
                        <td className="px-3 py-3 text-gray-700">
                          {sv(o.authorised_by) || sv(o.authorised_by_name) || "—"}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-gray-700">{fmtTime(o.time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
