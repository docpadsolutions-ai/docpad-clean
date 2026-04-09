"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/supabase";

export type DailyCollectionRow = {
  payment_method: string;
  transaction_count: number;
  total_amount: number;
  voided_count: number;
  voided_amount: number;
  net_collected: number;
};

export type CollectionReportRow = {
  report_date: string;
  cash_total: number;
  upi_total: number;
  card_total: number;
  other_total: number;
  total_collected: number;
  invoice_count: number;
};

export type OutstandingInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  patient_id: string;
  patient_full_name: string;
  total_gross: number;
  amount_paid: number;
  balance_due: number;
  status: string | null;
  invoice_date: string | null;
  due_date: string | null;
  days_overdue: number | null;
};

export type RevenueByChargeRow = {
  charge_category: string;
  total_billed: number;
  total_collected: number;
  collection_rate: number;
};

export type ChartPreset = "7d" | "30d" | "custom";

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function useBillingAnalytics(
  reportRange: { from: Date; to: Date },
  chartPreset: ChartPreset,
) {
  const reportFromYmd = useMemo(() => toYmd(startOfDay(reportRange.from)), [reportRange.from]);
  const reportToYmd = useMemo(() => toYmd(startOfDay(reportRange.to)), [reportRange.to]);

  const chartBounds = useMemo(() => {
    const today = startOfDay(new Date());
    if (chartPreset === "7d") {
      return { from: toYmd(addDays(today, -6)), to: toYmd(today) };
    }
    if (chartPreset === "30d") {
      return { from: toYmd(addDays(today, -29)), to: toYmd(today) };
    }
    return { from: reportFromYmd, to: reportToYmd };
  }, [chartPreset, reportFromYmd, reportToYmd]);

  const [dailyToday, setDailyToday] = useState<DailyCollectionRow[]>([]);
  const [dailyYesterday, setDailyYesterday] = useState<DailyCollectionRow[]>([]);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState<string | null>(null);

  const [collectionRows, setCollectionRows] = useState<CollectionReportRow[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(true);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  const [outstandingRows, setOutstandingRows] = useState<OutstandingInvoiceRow[]>([]);
  const [outstandingLoading, setOutstandingLoading] = useState(true);
  const [outstandingError, setOutstandingError] = useState<string | null>(null);

  const [revenueRows, setRevenueRows] = useState<RevenueByChargeRow[]>([]);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  const loadDaily = useCallback(async () => {
    setDailyLoading(true);
    setDailyError(null);
    const today = startOfDay(new Date());
    const todayYmd = toYmd(today);
    const yesterdayYmd = toYmd(addDays(today, -1));
    try {
      const [tRes, yRes] = await Promise.all([
        supabase.rpc("get_daily_collection_summary", { p_date: todayYmd }),
        supabase.rpc("get_daily_collection_summary", { p_date: yesterdayYmd }),
      ]);
      if (tRes.error) throw new Error(tRes.error.message);
      if (yRes.error) throw new Error(yRes.error.message);
      setDailyToday((tRes.data ?? []) as DailyCollectionRow[]);
      setDailyYesterday((yRes.data ?? []) as DailyCollectionRow[]);
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : "Failed to load daily summary");
      setDailyToday([]);
      setDailyYesterday([]);
    } finally {
      setDailyLoading(false);
    }
  }, []);

  const loadCollection = useCallback(async () => {
    setCollectionLoading(true);
    setCollectionError(null);
    try {
      const { data, error } = await supabase.rpc("get_collection_report", {
        p_from: chartBounds.from,
        p_to: chartBounds.to,
      });
      if (error) throw new Error(error.message);
      setCollectionRows((data ?? []) as CollectionReportRow[]);
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Failed to load collection report");
      setCollectionRows([]);
    } finally {
      setCollectionLoading(false);
    }
  }, [chartBounds.from, chartBounds.to]);

  const loadOutstanding = useCallback(async () => {
    setOutstandingLoading(true);
    setOutstandingError(null);
    try {
      const { data, error } = await supabase.rpc("get_outstanding_invoices", { p_limit: 500 });
      if (error) throw new Error(error.message);
      setOutstandingRows((data ?? []) as OutstandingInvoiceRow[]);
    } catch (e) {
      setOutstandingError(e instanceof Error ? e.message : "Failed to load outstanding invoices");
      setOutstandingRows([]);
    } finally {
      setOutstandingLoading(false);
    }
  }, []);

  const loadRevenue = useCallback(async () => {
    setRevenueLoading(true);
    setRevenueError(null);
    try {
      const { data, error } = await supabase.rpc("get_revenue_by_charge_type", {
        p_from: reportFromYmd,
        p_to: reportToYmd,
      });
      if (error) throw new Error(error.message);
      setRevenueRows((data ?? []) as RevenueByChargeRow[]);
    } catch (e) {
      setRevenueError(e instanceof Error ? e.message : "Failed to load revenue breakdown");
      setRevenueRows([]);
    } finally {
      setRevenueLoading(false);
    }
  }, [reportFromYmd, reportToYmd]);

  useEffect(() => {
    void loadDaily();
  }, [loadDaily]);

  useEffect(() => {
    void loadCollection();
  }, [loadCollection]);

  useEffect(() => {
    void loadOutstanding();
  }, [loadOutstanding]);

  useEffect(() => {
    void loadRevenue();
  }, [loadRevenue]);

  const refetchAll = useCallback(() => {
    void loadDaily();
    void loadCollection();
    void loadOutstanding();
    void loadRevenue();
  }, [loadDaily, loadCollection, loadOutstanding, loadRevenue]);

  return {
    reportRangeYmd: { from: reportFromYmd, to: reportToYmd },
    chartBounds,
    dailyToday,
    dailyYesterday,
    dailyLoading,
    dailyError,
    collectionRows,
    collectionLoading,
    collectionError,
    outstandingRows,
    outstandingLoading,
    outstandingError,
    revenueRows,
    revenueLoading,
    revenueError,
    refetchAll,
  };
}
