"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type UnbilledNursingChargesSectionProps = {
  admissionId: string;
  /** Bump to reload rows (e.g. after nursing logs a procedure). */
  refreshKey?: number;
  className?: string;
};

type UnbilledRow = {
  charge_item_id: string;
  procedure_name: string;
  performed_by_name: string;
  performed_at: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  source: string;
  oversight_status: string;
};

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function sourceLabel(src: string): string {
  const t = src.trim().toLowerCase();
  if (t === "consumable") return "Consumable";
  if (t === "procedure") return "Procedure";
  return src;
}

function formatPerformedAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function UnbilledNursingChargesSection({
  admissionId,
  refreshKey = 0,
  className,
}: UnbilledNursingChargesSectionProps) {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rows, setRows] = useState<UnbilledRow[]>([]);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const aid = admissionId.trim();
    if (!aid) {
      setRows([]);
      setInvoiceId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadErr(null);
    try {
      const { data: invIdRaw, error: invErr } = await supabase.rpc("get_or_create_ipd_draft_invoice", {
        p_admission_id: aid,
      });
      if (invErr) throw invErr;
      const invId = invIdRaw != null ? s(invIdRaw) : "";
      setInvoiceId(invId || null);

      if (invId) {
        const { data: invRow, error: invFetchErr } = await supabase
          .from("invoices")
          .select("invoice_number")
          .eq("id", invId)
          .maybeSingle();
        if (!invFetchErr && invRow && typeof invRow === "object") {
          const n = (invRow as { invoice_number?: unknown }).invoice_number;
          setInvoiceNumber(n != null ? s(n) : null);
        } else {
          setInvoiceNumber(null);
        }
      } else {
        setInvoiceNumber(null);
      }

      const { data: rawRows, error: rpcErr } = await supabase.rpc("get_unbilled_nursing_charges", {
        p_admission_id: aid,
      });
      if (rpcErr) throw rpcErr;
      const list = Array.isArray(rawRows) ? rawRows : [];
      setRows(
        list.map((r: Record<string, unknown>) => ({
          charge_item_id: s(r.charge_item_id),
          procedure_name: s(r.procedure_name) || "—",
          performed_by_name: s(r.performed_by_name) || "—",
          performed_at: r.performed_at != null ? s(r.performed_at) : null,
          quantity: num(r.quantity),
          unit_price: num(r.unit_price),
          total: num(r.total),
          source: s(r.source) || "procedure",
          oversight_status: s(r.oversight_status) || "open",
        })),
      );
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load unbilled charges");
      setRows([]);
      setInvoiceId(null);
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, refreshKey]);

  const runningTotal = useMemo(() => rows.reduce((acc, r) => acc + r.total, 0), [rows]);

  async function addToInvoice(chargeItemId: string) {
    const inv = invoiceId?.trim();
    if (!inv) {
      toast.error("Draft invoice not available.");
      return;
    }
    setAddingId(chargeItemId);
    try {
      const { error } = await supabase.rpc("add_unbilled_nursing_charge_to_invoice", {
        p_charge_item_id: chargeItemId,
        p_invoice_id: inv,
      });
      if (error) throw error;
      toast.success("Added to invoice.");
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add to invoice");
    } finally {
      setAddingId(null);
    }
  }

  async function flagCharge(chargeItemId: string) {
    setFlaggingId(chargeItemId);
    try {
      const { error } = await supabase.rpc("flag_ipd_nursing_charge_for_review", {
        p_charge_item_id: chargeItemId,
      });
      if (error) throw error;
      toast.success("Flagged for nursing review.");
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not flag charge");
    } finally {
      setFlaggingId(null);
    }
  }

  return (
    <section
      className={cn(
        "light-form-surface rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm md:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Unbilled nursing charges</h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Read-only queue from the nursing portal. Add lines to the IPD draft invoice or flag for nursing review.
          </p>
        </div>
      </div>

      {invoiceId ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>
            Draft invoice:{" "}
            <Link
              href={`/billing/invoice/${encodeURIComponent(invoiceId)}`}
              className="font-mono font-medium text-blue-600 underline-offset-2 hover:underline"
            >
              {invoiceNumber || invoiceId.slice(0, 8)}
            </Link>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={invoiceBusy}
            onClick={() => {
              setInvoiceBusy(true);
              void loadAll().finally(() => setInvoiceBusy(false));
            }}
          >
            Refresh
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600">No draft invoice yet — it will be created automatically.</p>
      )}

      {loadErr ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{loadErr}</p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-600">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No unbilled charges yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2">Procedure</th>
                <th className="px-3 py-2">Performed by</th>
                <th className="px-3 py-2">Performed at</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const flagged = r.oversight_status.toLowerCase() === "flagged";
                return (
                  <tr
                    key={r.charge_item_id}
                    className={cn(
                      "border-b border-slate-100 last:border-b-0",
                      flagged ? "bg-amber-50/80" : "odd:bg-white even:bg-slate-50/50",
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {r.procedure_name}
                      {flagged ? (
                        <span className="ml-2 inline-flex rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">
                          Flagged
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-800">{r.performed_by_name}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{formatPerformedAt(r.performed_at)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                      ₹{r.total.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">
                        {sourceLabel(r.source)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={!invoiceId || addingId === r.charge_item_id}
                          onClick={() => void addToInvoice(r.charge_item_id)}
                        >
                          {addingId === r.charge_item_id ? "Adding…" : "Add to Invoice"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          disabled={flaggingId === r.charge_item_id || flagged}
                          onClick={() => void flagCharge(r.charge_item_id)}
                        >
                          {flaggingId === r.charge_item_id ? "…" : "Flag"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-semibold">
                <td colSpan={3} className="px-3 py-2 text-right text-slate-800">
                  Unbilled total
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">₹{runningTotal.toFixed(2)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
