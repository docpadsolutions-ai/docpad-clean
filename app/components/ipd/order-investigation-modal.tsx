"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type OrderInvestigationCatalogRow = {
  id: string;
  test_name: string | null;
  short_code: string | null;
  category: string | null;
  loinc_code: string | null;
  sample_type: string | null;
  requires_fasting: boolean | null;
  expected_tat_hours: number | null;
  is_in_house: boolean | null;
  external_lab_name: string | null;
  list_price: number | string | null;
};

type Priority = "routine" | "urgent" | "stat";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function fmtMoney(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  if (Number.isNaN(n)) return "—";
  return `₹${n.toFixed(0)}`;
}

export default function OrderInvestigationModal({
  open,
  test,
  coverageId,
  coverageLabel,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  test: OrderInvestigationCatalogRow | null;
  /** Admission `coverage_id` — when set, insurance path. */
  coverageId: string | null;
  coverageLabel?: string | null;
  onCancel: () => void;
  onConfirm: (priority: Priority) => void | Promise<void>;
  busy?: boolean;
}) {
  const [priority, setPriority] = useState<Priority>("routine");

  const labLine = useMemo(() => {
    if (!test) return "—";
    const inHouse = test.is_in_house !== false;
    if (inHouse) return "In-house";
    return test.external_lab_name?.trim() ? `External · ${test.external_lab_name.trim()}` : "External";
  }, [test]);

  if (!open || !test) return null;

  const statBypass = priority === "stat";
  const hasInsurance = Boolean(coverageId);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal
        className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900">Confirm Investigation Order</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Test</dt>
            <dd className="text-right font-medium text-gray-900">{s(test.test_name) || "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">LOINC</dt>
            <dd className="font-mono text-right text-gray-900">{s(test.loinc_code) || "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Sample</dt>
            <dd className="text-right text-gray-900">{s(test.sample_type) || "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Fasting</dt>
            <dd className="text-right text-gray-900">{test.requires_fasting ? "Required" : "Not required"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">TAT</dt>
            <dd className="text-right text-gray-900">
              {test.expected_tat_hours != null && !Number.isNaN(Number(test.expected_tat_hours))
                ? `${test.expected_tat_hours} hrs`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Lab</dt>
            <dd className="text-right text-gray-900">{labLine}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Priority</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["routine", "urgent", "stat"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition",
                  priority === p
                    ? p === "stat"
                      ? "bg-red-600 text-white"
                      : p === "urgent"
                        ? "bg-amber-500 text-white"
                        : "bg-slate-600 text-white"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {statBypass ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            STAT orders bypass billing — sample collection proceeds immediately.
          </div>
        ) : null}

        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Billing</p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Price</span>
              <span className="font-medium text-gray-900">{fmtMoney(test.list_price)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Coverage</span>
              <span className="text-right text-gray-900">
                {hasInsurance ? s(coverageLabel) || "Insurance/TPA" : "Self-pay"}
              </span>
            </div>
            {!hasInsurance && !statBypass ? (
              <p className="text-xs text-gray-600">
                → Payment required at reception before sample collection
              </p>
            ) : null}
            {hasInsurance && !statBypass ? (
              <p className="text-xs text-emerald-800">→ Order will proceed directly to lab</p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={() => void onConfirm(priority)}
            disabled={busy}
          >
            {busy ? "Placing…" : "Confirm Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
