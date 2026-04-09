"use client";

import { Building2, Calendar, CreditCard, Hash, UserCircle } from "lucide-react";

export type CoverageSummary = {
  id: string;
  insurance_name_raw: string | null;
  policy_number: string | null;
  member_id: string | null;
  valid_until: string | null;
  remaining_balance: number | null;
  coverage_limit: number | null;
  insurance_companies: { name: string } | null;
};

function formatInr(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

export function EligibilitySummaryCard({ row }: { row: CoverageSummary }) {
  const payer = row.insurance_companies?.name?.trim() || row.insurance_name_raw?.trim() || "—";
  const balance = row.remaining_balance;
  const limit = row.coverage_limit;
  const pct =
    balance != null && limit != null && limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950/60">
            <Building2 className="h-5 w-5 text-blue-700 dark:text-blue-300" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Eligibility</p>
            <p className="font-semibold text-slate-900 dark:text-slate-50">{payer}</p>
          </div>
        </div>
        {pct != null ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
            {pct}% of limit
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <Hash className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Policy</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-200">{row.policy_number?.trim() || "—"}</dd>
          </div>
        </div>
        <div className="flex gap-2">
          <UserCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Member ID</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-200">{row.member_id?.trim() || "—"}</dd>
          </div>
        </div>
        <div className="flex gap-2">
          <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Valid until</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-200">
              {row.valid_until
                ? new Date(`${row.valid_until}T12:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" })
                : "—"}
            </dd>
          </div>
        </div>
        <div className="flex gap-2">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Balance</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatInr(balance)}</dd>
          </div>
        </div>
      </dl>

      {limit != null ? (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Coverage limit: <span className="font-medium text-slate-700 dark:text-slate-300">{formatInr(limit)}</span>
        </p>
      ) : null}
    </div>
  );
}
