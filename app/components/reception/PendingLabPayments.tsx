"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { practitionersOrFilterForAuthUid } from "@/app/lib/practitionerAuthLookup";
import { cn } from "@/lib/utils";

function sv(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type PendingRow = {
  id: string;
  test_name: string | null;
  test_category: string | null;
  priority: string | null;
  ordered_date: string | null;
  order_amount: number | string | null;
  created_at: string | null;
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

function pickOne<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

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

export function PendingLabPaymentsSection({ hospitalId }: { hospitalId: string | null }) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<Record<string, "Cash" | "UPI" | "Card">>({});
  const [overrideOpen, setOverrideOpen] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [practitionerId, setPractitionerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("ipd_investigation_orders")
      .select(
        `
        id, test_name, test_category, priority, ordered_date, order_amount, created_at,
        patient:patients(full_name),
        ipd_admissions(admission_number, ward:ipd_wards(name), bed:ipd_beds(bed_number))
      `,
      )
      .eq("hospital_id", hospitalId)
      .eq("billing_status", "pending_payment")
      .order("created_at", { ascending: true });
    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as PendingRow[]);
    }
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      .channel("reception-lab-payments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ipd_investigation_orders", filter: `hospital_id=eq.${hospitalId}` },
        () => void load(),
      )
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [hospitalId, load]);

  async function confirmPayment(row: PendingRow) {
    const pid = practitionerId;
    if (!pid) {
      setErr("No practitioner profile — cannot confirm payment.");
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase.rpc("confirm_investigation_payment", {
      p_order_id: row.id,
      p_confirmed_by: pid,
    });
    setBusyId(null);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function emergencyOverride(row: PendingRow) {
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
    setBusyId(row.id);
    const { error } = await supabase.rpc("confirm_investigation_emergency_override", {
      p_order_id: row.id,
      p_confirmed_by: pid,
      p_reason: reason,
    });
    setBusyId(null);
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
        <p className="text-xs text-gray-500">IPD investigation orders awaiting payment before sample collection.</p>
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
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const p = pickOne(row.patient);
                const adm = pickOne(row.ipd_admissions as PendingRow["ipd_admissions"]);
                const w = pickOne(adm?.ward as { name: string | null } | { name: string | null }[] | null);
                const b = pickOne(adm?.bed as { bed_number: string | null } | { bed_number: string | null }[] | null);
                const wardBed = [sv(w?.name), b?.bed_number ? `Bed ${sv(b.bed_number)}` : ""].filter(Boolean).join(" · ") || "—";
                const amt = row.order_amount;
                const n = amt != null && amt !== "" ? Number(amt) : NaN;
                const priceLabel = Number.isFinite(n) ? `₹${n.toFixed(0)}` : "—";
                const mode = payMode[row.id] ?? "Cash";
                const busy = busyId === row.id;
                return (
                  <tr key={row.id} className="hover:bg-gray-50/80">
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
                        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void confirmPayment(row)}>
                          {busy ? "…" : "Collect & confirm"}
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
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
