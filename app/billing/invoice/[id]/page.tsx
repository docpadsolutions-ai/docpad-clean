"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  downloadInvoicePdf,
  openInvoicePdfInNewTab,
  type InvoicePdfData,
} from "../../../../components/billing/InvoicePDF";
import { PaymentRecordModal } from "../../../../components/billing/PaymentRecordModal";
import { supabase } from "../../../supabase";

type InvoiceRow = {
  id: string;
  hospital_id: string | null;
  invoice_number: string | null;
  status: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total_net: number | string | null;
  total_discount: number | string | null;
  total_tax: number | string | null;
  total_gross: number | string | null;
  amount_paid: number | string | null;
  balance_due: number | string | null;
  patient_id: string | null;
  notes: string | null;
  fhir_json: unknown;
  created_at: string | null;
};

type LineRow = {
  line_number: number;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  tax_percent: number | string;
  line_subtotal: number | string;
  net_amount: number | string;
  charge_item_id: string;
};

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const [row, setRow] = useState<InvoiceRow | null>(null);
  const [pdfData, setPdfData] = useState<InvoicePdfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setError("Missing invoice id");
      return;
    }
    setLoading(true);
    setError(null);

    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select(
        "id, hospital_id, invoice_number, status, invoice_date, due_date, total_net, total_discount, total_tax, total_gross, amount_paid, balance_due, patient_id, notes, fhir_json, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (invErr) {
      setError(invErr.message);
      setRow(null);
      setPdfData(null);
      setLoading(false);
      return;
    }
    if (!inv) {
      setRow(null);
      setPdfData(null);
      setLoading(false);
      return;
    }

    const invRow = inv as InvoiceRow;
    setRow(invRow);

    const patientId = invRow.patient_id;
    const hid = invRow.hospital_id;

    const [{ data: patient }, { data: hospital }, { data: lineRows }] = await Promise.all([
      patientId
        ? supabase
            .from("patients")
            .select("full_name, phone, docpad_id, gender, date_of_birth, address")
            .eq("id", patientId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      hid
        ? supabase.from("hospitals").select("name, address, city, phone").eq("id", hid).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("invoice_line_items")
        .select("line_number, quantity, unit_price, discount_percent, tax_percent, line_subtotal, net_amount, charge_item_id")
        .eq("invoice_id", id)
        .order("line_number", { ascending: true }),
    ]);

    const lines = (lineRows ?? []) as LineRow[];
    const chargeIds = [...new Set(lines.map((l) => l.charge_item_id).filter(Boolean))];
    let chargeMap = new Map<string, { label: string | null; code: string | null }>();

    if (chargeIds.length > 0) {
      const { data: charges } = await supabase
        .from("charge_items")
        .select("id, display_label, charge_code")
        .in("id", chargeIds);

      for (const c of charges ?? []) {
        const r = c as { id: string; display_label: string | null; charge_code: string | null };
        chargeMap.set(r.id, {
          label: r.display_label,
          code: r.charge_code,
        });
      }
    }

    const pdfLines = lines.map((li) => {
      const ch = chargeMap.get(li.charge_item_id);
      return {
        line_number: li.line_number,
        quantity: li.quantity,
        unit_price: li.unit_price,
        discount_percent: li.discount_percent,
        tax_percent: li.tax_percent,
        line_subtotal: li.line_subtotal,
        net_amount: li.net_amount,
        charge_label: ch?.label ?? null,
        charge_code: ch?.code ?? null,
      };
    });

    setPdfData({
      invoice: {
        id: invRow.id,
        invoice_number: invRow.invoice_number,
        invoice_date: invRow.invoice_date,
        due_date: invRow.due_date,
        status: invRow.status,
        total_net: invRow.total_net,
        total_discount: invRow.total_discount,
        total_tax: invRow.total_tax,
        total_gross: invRow.total_gross,
        amount_paid: invRow.amount_paid,
        balance_due: invRow.balance_due,
        notes: invRow.notes,
        fhir_json: invRow.fhir_json,
      },
      patient: patient
        ? {
            full_name: (patient as { full_name?: string | null }).full_name ?? null,
            phone: (patient as { phone?: string | null }).phone ?? null,
            docpad_id: (patient as { docpad_id?: string | null }).docpad_id ?? null,
            gender: (patient as { gender?: string | null }).gender ?? null,
            date_of_birth: (patient as { date_of_birth?: string | null }).date_of_birth ?? null,
            address: (patient as { address?: string | null }).address ?? null,
          }
        : null,
      hospital: hospital
        ? {
            name: (hospital as { name?: string | null }).name ?? null,
            address: (hospital as { address?: string | null }).address ?? null,
            city: (hospital as { city?: string | null }).city ?? null,
            phone: (hospital as { phone?: string | null }).phone ?? null,
          }
        : null,
      lines: pdfLines,
    });

    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const gross = useMemo(() => num(row?.total_gross), [row?.total_gross]);
  const balanceDue = useMemo(() => {
    if (!row) return 0;
    const b = num(row.balance_due);
    if (b > 0) return b;
    return Math.max(0, num(row.total_gross) - num(row.amount_paid));
  }, [row]);

  const onPaymentRecorded = useCallback(
    (next: { balance_due: number; amount_paid: number }) => {
      setRow((prev) =>
        prev
          ? {
              ...prev,
              balance_due: next.balance_due,
              amount_paid: next.amount_paid,
            }
          : null,
      );
      setPdfData((prev) =>
        prev
          ? {
              ...prev,
              invoice: {
                ...prev.invoice,
                balance_due: next.balance_due,
                amount_paid: next.amount_paid,
              },
            }
          : null,
      );
      void load();
    },
    [load],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/billing" className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Billing
          </Link>
          <Link
            href="/billing/invoice/new"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            New invoice
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : !row ? (
          <p className="text-sm text-slate-500">Invoice not found.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
                    {row.invoice_number ?? "Invoice"}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">Status: {row.status ?? "—"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!pdfData}
                    onClick={() => pdfData && void downloadInvoicePdf(pdfData)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    disabled={!pdfData}
                    onClick={() => pdfData && openInvoicePdfInNewTab(pdfData)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    Print / preview
                  </button>
                  <button
                    type="button"
                    disabled={balanceDue <= 0}
                    onClick={() => setPaymentOpen(true)}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Record payment
                  </button>
                </div>
              </div>

              <p className="mt-4 text-2xl font-semibold tabular-nums text-blue-700 dark:text-blue-300">
                {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
                  gross,
                )}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Balance due:{" "}
                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
                    balanceDue,
                  )}
                </span>
              </p>

              {row.notes ? (
                <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{row.notes}</p>
              ) : null}
              <p className="mt-6 text-xs text-slate-400">Patient: {row.patient_id ?? "—"}</p>
            </div>
          </div>
        )}
      </div>

      {row ? (
        <PaymentRecordModal
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          invoiceId={row.id}
          balanceDue={balanceDue}
          onRecorded={onPaymentRecorded}
        />
      ) : null}
    </div>
  );
}
