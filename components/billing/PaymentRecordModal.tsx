"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../app/supabase";

const METHODS = ["cash", "upi", "card", "netbanking", "cheque"] as const;
export type PaymentMethod = (typeof METHODS)[number];

type Props = {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  balanceDue: number;
  onRecorded: (next: { balance_due: number; amount_paid: number }) => void;
};

export function PaymentRecordModal({ open, onClose, invoiceId, balanceDue, onRecorded }: Props) {
  const formId = useId();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(balanceDue > 0 ? String(balanceDue) : "");
      setMethod("cash");
      setReference("");
      setNotes("");
    }
  }, [open, balanceDue]);

  const submit = useCallback(async () => {
    const amt = Number.parseFloat(amount.replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (amt > balanceDue + 0.009) {
      toast.error(`Amount cannot exceed balance due (${balanceDue.toFixed(2)}).`);
      return;
    }

    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (!uid) {
        toast.error("Sign in required.");
        return;
      }

      const { data, error } = await supabase.rpc("record_payment", {
        p_invoice_id: invoiceId,
        p_amount: amt,
        p_payment_method: method,
        p_reference_number: reference.trim() || null,
        p_notes: notes.trim() || null,
        p_collected_by: uid,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      const row = Array.isArray(data) ? data[0] : null;
      if (!row || typeof row !== "object") {
        toast.error("Unexpected response from record_payment.");
        return;
      }

      const bd = Number((row as { balance_due: unknown }).balance_due);
      const ap = Number((row as { amount_paid: unknown }).amount_paid);
      toast.success("Payment recorded.");
      onRecorded({
        balance_due: Number.isFinite(bd) ? bd : 0,
        amount_paid: Number.isFinite(ap) ? ap : 0,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [amount, balanceDue, invoiceId, method, notes, onClose, onRecorded, reference]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-600 dark:bg-slate-900"
        role="dialog"
        aria-labelledby={`${formId}-title`}
        aria-modal="true"
      >
        <h2 id={`${formId}-title`} className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Record payment
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Balance due:{" "}
          <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200">
            {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(balanceDue)}
          </span>
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Amount
            <input
              type="number"
              min={0}
              step="0.01"
              max={balanceDue}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Payment method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace("netbanking", "Net banking")}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Reference number (optional)
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              placeholder="UPI ref / cheque no. / txn id"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || balanceDue <= 0}
            onClick={() => void submit()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Record payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
