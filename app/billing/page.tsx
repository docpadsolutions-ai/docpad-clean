"use client";

import Link from "next/link";

export default function BillingDashboardPage() {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Billing</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Invoices, payments, and insurance workflows. Financial analytics and revenue dashboards now live under{" "}
            <Link href="/admin/analytics/financial" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
              Admin → Analytics → Financial
            </Link>
            .
          </p>
        </header>

        <nav className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Quick links</h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            <li>
              <Link
                href="/admin/analytics/financial"
                className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Financial analytics (admin)
              </Link>
            </li>
            <li>
              <Link
                href="/billing/invoices"
                className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                All invoices
              </Link>
            </li>
            <li>
              <Link
                href="/billing/invoice/new"
                className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                + New invoice
              </Link>
            </li>
            <li>
              <Link
                href="/billing/insurance"
                className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Insurance
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
