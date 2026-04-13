"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { fetchHospitalIdFromPractitionerAuthId } from "../../lib/authOrg";
import { supabase } from "../../supabase";
import { PaymentRecordModal } from "../../../components/billing/PaymentRecordModal";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = ["all", "draft", "issued", "balanced", "cancelled", "voided"] as const;

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
}

/** Document / billing type badge (derived from workflow status). */
function invoiceTypeBadgeLabel(status: string | null): string {
  switch (status) {
    case "draft":
      return "Proforma";
    case "issued":
      return "Final";
    case "balanced":
      return "Paid";
    case "cancelled":
    case "voided":
      return "Void";
    default:
      return "Invoice";
  }
}

function balanceForRow(row: InvoiceListRow): number {
  const b = num(row.balance_due);
  if (Number.isFinite(b)) return Math.max(0, b);
  return Math.max(0, num(row.total_gross) - num(row.amount_paid));
}

function lineItemCount(row: InvoiceListRow): number {
  const li = row.invoice_line_items as unknown;
  if (Array.isArray(li) && li[0] != null && typeof (li[0] as { count?: number }).count === "number") {
    return (li[0] as { count: number }).count;
  }
  if (li && typeof li === "object" && !Array.isArray(li) && "count" in li && typeof (li as { count: number }).count === "number") {
    return (li as { count: number }).count;
  }
  return 0;
}

function statusBadgeLabel(status: string | null): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

type PatientOpt = { id: string; full_name: string | null; docpad_id: string | null };

type PatientEmbed = { full_name: string | null; docpad_id: string | null } | null;

function singlePatientEmbed(p: unknown): PatientEmbed {
  if (p == null) return null;
  if (Array.isArray(p)) {
    const first = p[0];
    if (first && typeof first === "object" && "full_name" in first) {
      return first as { full_name: string | null; docpad_id: string | null };
    }
    return null;
  }
  if (typeof p === "object" && "full_name" in p) {
    return p as { full_name: string | null; docpad_id: string | null };
  }
  return null;
}

type InvoiceListRow = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  status: string | null;
  total_gross: number | string | null;
  amount_paid: number | string | null;
  balance_due: number | string | null;
  patient_id: string | null;
  patient: PatientEmbed;
  invoice_line_items?: { count?: number }[] | { count?: number } | null;
  payments?: { amount?: number | string | null }[] | null;
};

function patientNameFromRow(row: InvoiceListRow): string {
  const p = row.patient;
  if (!p) return "—";
  return p.full_name?.trim() || "—";
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999));
}

/** Desktop grid: #, Patient, Date, Type, Status, Gross, Paid, Balance, Lines, Actions */
const DESKTOP_INVOICE_COLS =
  "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_72px_88px_88px_88px_88px_52px_132px]";

function TableLoadingSkeleton() {
  return (
    <div className="space-y-0 p-4">
      <div className={`mb-3 hidden md:grid ${DESKTOP_INVOICE_COLS} md:gap-3`}>
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, r) => (
        <div
          key={r}
          className={`mb-3 hidden border-b border-gray-100 pb-3 last:mb-0 dark:border-slate-800 md:grid ${DESKTOP_INVOICE_COLS} md:gap-3 md:items-center`}
        >
          {Array.from({ length: 10 }).map((__, c) => (
            <Skeleton key={c} className="h-9 w-full" />
          ))}
        </div>
      ))}
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function InvoicesListPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [hospitalReady, setHospitalReady] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [patientIdFilter, setPatientIdFilter] = useState<string | null>(null);
  const [patientSearchLabel, setPatientSearchLabel] = useState("");
  const [patientSearchDebounced, setPatientSearchDebounced] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [patientOptions, setPatientOptions] = useState<PatientOpt[]>([]);
  const [patientOpen, setPatientOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentRow, setPaymentRow] = useState<InvoiceListRow | null>(null);
  const patientSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
      setHospitalReady(true);
    })();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setPatientSearchDebounced(patientSearchLabel), 350);
    return () => window.clearTimeout(t);
  }, [patientSearchLabel]);

  const fetchInvoices = useCallback(async () => {
    if (!hospitalReady) {
      return;
    }
    if (!hospitalId) {
      setLoading(false);
      setRows([]);
      setTotalCount(0);
      setError("No hospital linked to your profile. Invoices are scoped by hospital.");
      return;
    }

    setLoading(true);
    setError(null);

    let patientIdsFromName: string[] | null = null;
    const nameTerm = patientSearchDebounced.trim();
    if (!patientIdFilter && nameTerm.length >= 2) {
      const { data: pats, error: pErr } = await supabase
        .from("patients")
        .select("id")
        .eq("hospital_id", hospitalId)
        .ilike("full_name", `%${nameTerm}%`)
        .limit(250);

      if (pErr) {
        setError(pErr.message);
        setRows([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
      patientIdsFromName = (pats ?? []).map((p) => String((p as { id: unknown }).id));
      if (patientIdsFromName.length === 0) {
        setRows([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
    }

    const startIndex = page * PAGE_SIZE;
    const endIndex = startIndex + PAGE_SIZE - 1;

    let q = supabase
      .from("invoices")
      .select(
        `
        *,
        invoice_line_items(count),
        payments(amount),
        patient:patients(full_name, docpad_id)
      `,
        { count: "exact" },
      )
      .eq("hospital_id", hospitalId)
      .order("invoice_date", { ascending: false, nullsFirst: false })
      .range(startIndex, endIndex);

    if (statusFilter !== "all") {
      q = q.eq("status", statusFilter);
    }
    if (patientIdFilter) {
      q = q.eq("patient_id", patientIdFilter);
    } else if (patientIdsFromName) {
      q = q.in("patient_id", patientIdsFromName);
    }
    if (dateRange?.from) {
      q = q.gte("invoice_date", startOfUtcDay(dateRange.from).toISOString());
    }
    if (dateRange?.to) {
      q = q.lte("invoice_date", endOfUtcDay(dateRange.to).toISOString());
    } else if (dateRange?.from && !dateRange.to) {
      q = q.lte("invoice_date", endOfUtcDay(dateRange.from).toISOString());
    }

    const { data, error: qErr, count } = await q;

    if (qErr) {
      setError(qErr.message);
      setRows([]);
      setTotalCount(0);
    } else {
      const raw = (data ?? []) as Record<string, unknown>[];
      setRows(
        raw.map((r) => ({
          ...r,
          patient: singlePatientEmbed(r.patient),
        })) as InvoiceListRow[],
      );
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }, [page, statusFilter, patientIdFilter, patientSearchDebounced, dateRange, hospitalId, hospitalReady]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, patientIdFilter, dateRange, patientSearchDebounced]);

  useEffect(() => {
    if (!patientOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!patientSearchRef.current?.contains(e.target as Node)) setPatientOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [patientOpen]);

  const searchPatients = useCallback(
    async (q: string) => {
      if (!hospitalId) return;
      const t = q.trim();
      if (t.length < 1) {
        setPatientOptions([]);
        return;
      }
      const { data } = await supabase
        .from("patients")
        .select("id, full_name, docpad_id")
        .eq("hospital_id", hospitalId)
        .ilike("full_name", `%${t}%`)
        .limit(15);
      setPatientOptions((data ?? []) as PatientOpt[]);
    },
    [hospitalId],
  );

  useEffect(() => {
    if (!patientOpen) return;
    const t = window.setTimeout(() => void searchPatients(patientQuery), 200);
    return () => window.clearTimeout(t);
  }, [patientQuery, patientOpen, searchPatients]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const dateLabel = useMemo(() => {
    if (!dateRange?.from) return "Any date";
    const a = dateRange.from.toLocaleDateString("en-IN", { dateStyle: "medium" });
    if (!dateRange.to) return a;
    const b = dateRange.to.toLocaleDateString("en-IN", { dateStyle: "medium" });
    return `${a} – ${b}`;
  }, [dateRange]);

  const detailHref = (id: string) => `/billing/invoices/${id}`;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4 md:p-6 lg:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-slate-50">Invoices</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Hospital-scoped list (RLS). Default sort: newest invoice first.</p>
            <Link href="/billing" className="mt-2 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
              ← Billing dashboard
            </Link>
          </div>
          <Button asChild variant="default" className="w-full shrink-0 shadow-sm sm:w-auto">
            <Link href="/billing/invoice/new">New invoice</Link>
          </Button>
        </header>

        <Card className="border border-gray-200 bg-white shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-base text-gray-900">Filters</CardTitle>
            <CardDescription className="text-gray-600">
              Stack on small screens. Status and date range apply directly; type at least two letters in Patient to filter the list by full name (or pick a patient from suggestions).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
            <div className="grid w-full gap-2 md:w-48">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All statuses" : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div ref={patientSearchRef} className="relative w-full min-w-0 flex-1 md:max-w-sm">
              <Label>Patient</Label>
              <Input
                placeholder="Search full name…"
                value={patientSearchLabel}
                onChange={(e) => {
                  const v = e.target.value;
                  setPatientSearchLabel(v);
                  setPatientQuery(v);
                  setPatientOpen(true);
                  if (!v.trim()) {
                    setPatientIdFilter(null);
                  }
                }}
                onFocus={() => setPatientOpen(true)}
                className="mt-1.5"
              />
              {patientOpen && patientQuery.trim().length > 0 ? (
                <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900">
                  {patientOptions.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-500">No matches.</p>
                  ) : (
                    patientOptions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => {
                          setPatientIdFilter(p.id);
                          setPatientSearchLabel(p.full_name ?? p.docpad_id ?? p.id);
                          setPatientOpen(false);
                        }}
                      >
                        <span className="font-medium text-slate-900 dark:text-slate-100">{p.full_name ?? "—"}</span>
                        {p.docpad_id ? <span className="text-xs text-slate-500">{p.docpad_id}</span> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
              {patientIdFilter ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => {
                    setPatientIdFilter(null);
                    setPatientSearchLabel("");
                    setPatientQuery("");
                  }}
                >
                  Clear patient
                </button>
              ) : null}
            </div>

            <div className="grid w-full gap-2 md:w-auto">
              <Label>Invoice date</Label>
              <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full min-w-0 justify-start text-left font-normal md:min-w-[200px]">
                    <CalendarDays className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                    {dateLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <DayPicker mode="range" numberOfMonths={1} selected={dateRange} onSelect={(r) => setDateRange(r)} className="p-3" />
                  <div className="flex justify-end gap-2 border-t border-slate-200 p-2 dark:border-slate-700">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDateRange(undefined);
                        setDatePopoverOpen(false);
                      }}
                    >
                      Clear
                    </Button>
                    <Button type="button" size="sm" onClick={() => setDatePopoverOpen(false)}>
                      Apply
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-gray-200 bg-white shadow-sm">
          <CardContent className="p-0 md:p-0">
            {!hospitalReady || loading ? (
              <TableLoadingSkeleton />
            ) : error ? (
              <div className="p-6 text-sm text-red-600 dark:text-red-400">{error}</div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
                <p className="text-base font-medium text-gray-900 dark:text-slate-300">No invoices found</p>
                <p className="max-w-sm text-sm text-gray-600 dark:text-slate-400">Create an invoice to see it here, or adjust your filters.</p>
                <Button asChild>
                  <Link href="/billing/invoice/new">Create Invoice</Link>
                </Button>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto border-t border-gray-200 md:block">
                  <Table className="bg-white">
                    <TableHeader>
                      <TableRow className="border-gray-200 bg-gray-50 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:bg-slate-900/40">
                        <TableHead className="text-gray-500 dark:text-slate-400">Invoice #</TableHead>
                        <TableHead className="text-gray-500 dark:text-slate-400">Patient</TableHead>
                        <TableHead className="text-gray-500 dark:text-slate-400">Date</TableHead>
                        <TableHead className="text-gray-500 dark:text-slate-400">Type</TableHead>
                        <TableHead className="text-gray-500 dark:text-slate-400">Status</TableHead>
                        <TableHead className="text-right text-gray-500 dark:text-slate-400">Gross</TableHead>
                        <TableHead className="text-right text-gray-500 dark:text-slate-400">Paid</TableHead>
                        <TableHead className="text-right text-gray-500 dark:text-slate-400">Balance</TableHead>
                        <TableHead className="text-right text-gray-500 dark:text-slate-400">Lines</TableHead>
                        <TableHead className="text-right text-gray-500 dark:text-slate-400">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => {
                        const bal = balanceForRow(row);
                        return (
                          <TableRow
                            key={row.id}
                            className="border-gray-200 bg-white hover:bg-gray-100 dark:hover:bg-slate-800/50"
                          >
                            <TableCell className="font-medium">
                              <Link href={detailHref(row.id)} className="text-blue-600 hover:underline dark:text-blue-400">
                                {row.invoice_number ?? row.id.slice(0, 8)}
                              </Link>
                            </TableCell>
                            <TableCell>{patientNameFromRow(row)}</TableCell>
                            <TableCell className="tabular-nums text-slate-600 dark:text-slate-400">{formatDate(row.invoice_date)}</TableCell>
                            <TableCell>
                              <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900 dark:bg-violet-950/60 dark:text-violet-100">
                                {invoiceTypeBadgeLabel(row.status)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                                {statusBadgeLabel(row.status)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatInr(num(row.total_gross))}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatInr(num(row.amount_paid))}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{formatInr(bal)}</TableCell>
                            <TableCell className="text-right tabular-nums text-slate-600 dark:text-slate-400">{lineItemCount(row)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap justify-end gap-1">
                                <Button variant="outline" size="sm" asChild>
                                  <Link href={detailHref(row.id)}>View details</Link>
                                </Button>
                                <Button variant="default" size="sm" disabled={bal <= 0} onClick={() => setPaymentRow(row)}>
                                  Record payment
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile stacked cards */}
                <div className="flex flex-col gap-3 p-4 md:hidden">
                  {rows.map((row) => {
                    const bal = balanceForRow(row);
                    return (
                      <div
                        key={row.id}
                        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <Link href={detailHref(row.id)} className="text-base font-semibold text-blue-600 hover:underline dark:text-blue-400">
                              {row.invoice_number ?? row.id.slice(0, 8)}
                            </Link>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{patientNameFromRow(row)}</p>
                          </div>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900 dark:bg-violet-950/60 dark:text-violet-100">
                              {invoiceTypeBadgeLabel(row.status)}
                            </span>
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                              {statusBadgeLabel(row.status)}
                            </span>
                          </div>
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <dt className="text-xs text-slate-500">Date</dt>
                            <dd className="tabular-nums text-slate-800 dark:text-slate-200">{formatDate(row.invoice_date)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Lines</dt>
                            <dd className="tabular-nums text-slate-800 dark:text-slate-200">{lineItemCount(row)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Gross</dt>
                            <dd className="tabular-nums font-medium">{formatInr(num(row.total_gross))}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Paid</dt>
                            <dd className="tabular-nums">{formatInr(num(row.amount_paid))}</dd>
                          </div>
                          <div className="col-span-2">
                            <dt className="text-xs text-slate-500">Balance</dt>
                            <dd className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatInr(bal)}</dd>
                          </div>
                        </dl>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button variant="outline" className="w-full sm:flex-1" asChild>
                            <Link href={detailHref(row.id)}>View details</Link>
                          </Button>
                          <Button variant="default" className="w-full sm:flex-1" disabled={bal <= 0} onClick={() => setPaymentRow(row)}>
                            Record payment
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row dark:border-slate-700">
                  <p className="text-xs text-gray-600">
                    Showing {rows.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
                  </p>
                  <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                      disabled={page <= 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-xs tabular-nums text-gray-700 dark:text-slate-400">
                      Page {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {paymentRow ? (
        <PaymentRecordModal
          open={Boolean(paymentRow)}
          onClose={() => setPaymentRow(null)}
          invoiceId={paymentRow.id}
          balanceDue={balanceForRow(paymentRow)}
          onRecorded={() => {
            setPaymentRow(null);
            void fetchInvoices();
          }}
        />
      ) : null}
    </div>
  );
}
