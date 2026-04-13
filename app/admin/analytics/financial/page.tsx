"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import "react-day-picker/style.css";
import { CollectionChart } from "@/components/billing/CollectionChart";
import { CollectionMethodChart } from "@/components/billing/CollectionMethodChart";
import { DailyCollectionCard } from "@/components/billing/DailyCollectionCard";
import { DepartmentPerformanceGrid } from "@/components/billing/DepartmentPerformanceGrid";
import { OutstandingInvoicesTable } from "@/components/billing/OutstandingInvoicesTable";
import { ProviderPerformanceTable } from "@/components/billing/ProviderPerformanceTable";
import { RevenuePieChart } from "@/components/billing/RevenuePieChart";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import {
  CategoryBreakdownPie,
  DateRangePicker,
  OutstandingAgingGrid,
  ServiceUtilizationTable,
  TopDefaulters,
} from "@/app/billing/components/AnalyticsDashboard";
import { type ChartPreset, toYmd, useBillingAnalytics } from "@/hooks/useBillingAnalytics";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function parseYmdToStartOfDay(ymd: string): Date {
  const parts = ymd.split("-").map((x) => Number.parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const day = parts[2];
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) {
    return startOfDay(new Date());
  }
  return startOfDay(new Date(y, m - 1, day));
}

function defaultEndYmd(): string {
  return toYmd(startOfDay(new Date()));
}

function defaultStartYmd(): string {
  return toYmd(addDays(startOfDay(new Date()), -6));
}

export default function AdminFinancialAnalyticsPage() {
  const [startDate, setStartDate] = useState(defaultStartYmd);
  const [endDate, setEndDate] = useState(defaultEndYmd);
  const [chartPreset, setChartPreset] = useState<ChartPreset>("7d");
  const [hospitalId, setHospitalId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  const reportRange = useMemo(() => {
    const from = parseYmdToStartOfDay(startDate);
    const to = parseYmdToStartOfDay(endDate);
    return to < from ? { from, to: from } : { from, to };
  }, [startDate, endDate]);

  const analytics = useBillingAnalytics(reportRange, chartPreset);

  const setLastDays = useCallback((days: number) => {
    const to = startOfDay(new Date());
    const from = addDays(to, -(days - 1));
    setStartDate(toYmd(from));
    setEndDate(toYmd(to));
    setChartPreset("custom");
  }, []);

  const fromLabel = reportRange.from.toLocaleDateString("en-IN", { dateStyle: "medium" });
  const toLabel = reportRange.to.toLocaleDateString("en-IN", { dateStyle: "medium" });

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-gray-900">Financial analytics</h2>
            <p className="mt-1 text-sm text-gray-500">
              Hospital-scoped revenue and receivables (invoices, payments, line items). Operational billing tasks stay under
              Billing.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/billing/invoices" className="inline-flex text-sm font-semibold text-blue-600 hover:text-blue-700">
                All invoices
              </Link>
              <Link href="/billing/invoice/new" className="inline-flex text-sm font-semibold text-blue-600 hover:text-blue-700">
                + New invoice
              </Link>
              <Link href="/billing/insurance" className="inline-flex text-sm font-semibold text-blue-600 hover:text-blue-700">
                Insurance
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setLastDays(7)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
              >
                Last 7 days
              </button>
              <button
                type="button"
                onClick={() => setLastDays(30)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
              >
                Last 30 days
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Report range: <span className="font-medium text-gray-900">{fromLabel}</span>
              {" — "}
              <span className="font-medium text-gray-900">{toLabel}</span>
            </p>
          </div>
        </header>

        <DepartmentPerformanceGrid hospitalId={hospitalId} startDate={startDate} endDate={endDate} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <CategoryBreakdownPie hospitalId={hospitalId} startDate={startDate} endDate={endDate} />
          <ServiceUtilizationTable hospitalId={hospitalId} startDate={startDate} endDate={endDate} />
        </div>

        <OutstandingAgingGrid hospitalId={hospitalId} />

        <TopDefaulters hospitalId={hospitalId} />

        <DailyCollectionCard
          todayRows={analytics.dailyToday}
          yesterdayRows={analytics.dailyYesterday}
          loading={analytics.dailyLoading}
          error={analytics.dailyError}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CollectionChart
              rows={analytics.collectionRows}
              loading={analytics.collectionLoading}
              error={analytics.collectionError}
              chartPreset={chartPreset}
              onChartPresetChange={setChartPreset}
            />
          </div>
          <div className="lg:col-span-1">
            <RevenuePieChart
              rows={analytics.revenueRows}
              loading={analytics.revenueLoading}
              error={analytics.revenueError}
            />
          </div>
        </div>

        <CollectionMethodChart hospitalId={hospitalId} startDate={startDate} endDate={endDate} />

        <ProviderPerformanceTable hospitalId={hospitalId} startDate={startDate} endDate={endDate} />

        <OutstandingInvoicesTable
          rows={analytics.outstandingRows}
          loading={analytics.outstandingLoading}
          error={analytics.outstandingError}
        />
      </div>
    </div>
  );
}
