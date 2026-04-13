"use client";

import Link from "next/link";

export default function BillingDashboardPage() {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Billing</h1>
          <p className="mt-2 text-sm text-gray-500">Invoices, payments, and insurance workflows.</p>
        </header>

        <nav className="rounded-xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Quick links</h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            <li>
              <Link href="/billing/invoices" className="font-semibold text-blue-600 hover:text-blue-700">
                All invoices
              </Link>
            </li>
            <li>
              <Link href="/billing/invoice/new" className="font-semibold text-blue-600 hover:text-blue-700">
                + New invoice
              </Link>
            </li>
            <li>
              <Link href="/billing/insurance" className="font-semibold text-blue-600 hover:text-blue-700">
                Insurance
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
