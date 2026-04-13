"use client";

import { Banknote, CreditCard, Smartphone, Wallet } from "lucide-react";
import { useMemo } from "react";
import type { DailyCollectionRow } from "@/hooks/useBillingAnalytics";

const METHODS = ["cash", "upi", "card", "other"] as const;
type Method = (typeof METHODS)[number];

function rowMap(rows: DailyCollectionRow[]): Record<Method, DailyCollectionRow | undefined> {
  const m: Partial<Record<Method, DailyCollectionRow>> = {};
  for (const r of rows) {
    const key = (r.payment_method ?? "other").toLowerCase() as Method;
    if (METHODS.includes(key)) m[key] = r;
  }
  return {
    cash: m.cash,
    upi: m.upi,
    card: m.card,
    other: m.other,
  };
}

function num(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : 0;
}

function pctChange(todayNet: number, yNet: number): number | null {
  if (yNet === 0) {
    if (todayNet === 0) return null;
    return 100;
  }
  return ((todayNet - yNet) / yNet) * 100;
}

function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function MethodIcon({ method }: { method: Method }) {
  const cls = "h-5 w-5 shrink-0 text-slate-500";
  switch (method) {
    case "cash":
      return <Banknote className={cls} aria-hidden />;
    case "upi":
      return <Smartphone className={cls} aria-hidden />;
    case "card":
      return <CreditCard className={cls} aria-hidden />;
    default:
      return <Wallet className={cls} aria-hidden />;
  }
}

function labelFor(method: Method): string {
  switch (method) {
    case "cash":
      return "Cash";
    case "upi":
      return "UPI";
    case "card":
      return "Card";
    default:
      return "Other";
  }
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        —
      </span>
    );
  }
  const up = pct >= 0;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        up
          ? "bg-emerald-100 text-emerald-800"
          : "bg-red-100 text-red-800"
      }`}
    >
      {up ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

export function DailyCollectionCard({
  todayRows,
  yesterdayRows,
  loading,
  error,
}: {
  todayRows: DailyCollectionRow[];
  yesterdayRows: DailyCollectionRow[];
  loading: boolean;
  error: string | null;
}) {
  const todayM = useMemo(() => rowMap(todayRows), [todayRows]);
  const yM = useMemo(() => rowMap(yesterdayRows), [yesterdayRows]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METHODS.map((m) => (
          <div
            key={m}
            className="animate-pulse rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="h-4 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-8 w-32 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Today&apos;s collection</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METHODS.map((method) => {
          const t = todayM[method];
          const y = yM[method];
          const net = num(t?.net_collected);
          const voided = num(t?.voided_amount);
          const txn = t?.transaction_count ?? 0;
          const yNet = num(y?.net_collected);
          const delta = pctChange(net, yNet);

          return (
            <div
              key={method}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MethodIcon method={method} />
                  <span className="text-sm font-medium text-slate-900">{labelFor(method)}</span>
                </div>
                <ChangeBadge pct={delta} />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">
                {formatInr(net)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {txn} transaction{txn === 1 ? "" : "s"}
              </p>
              {voided > 0 ? (
                <p className="mt-1 text-xs text-slate-400 line-through">
                  Voided {formatInr(voided)}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-300">No voids</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
