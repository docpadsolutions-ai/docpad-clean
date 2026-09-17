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
  id: string;
  line_number: number;
  item_description: string | null;
  quantity: number | string;
  unit_price: number | string;
  gross_amount: number | string | null;
  discount_amount: number | string | null;
  tax_amount: number | string | null;
  discount_percent: number | string;
  tax_percent: number | string;
  line_subtotal: number | string;
  net_amount: number | string;
  charge_item_id: string | null;
  charge_items:
    | { category: string | null; charge_code_display: string | null; source_type: string | null }
    | { category: string | null; charge_code_display: string | null; source_type: string | null }[]
    | null;
};

function fmtCategory(cat: string | null | undefined): string {
  if (!cat) return "—";
  const known: Record<string, string> = {
    lab_test: "Lab Test",
    imaging: "Imaging",
    consultation: "Consultation",
    procedure: "Procedure",
    pharmacy: "Pharmacy",
    room_charge: "Room Charge",
    other: "Other",
  };
  return known[cat] ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function inr(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function pickOne<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

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
  const [lineItems, setLineItems] = useState<LineRow[]>([]);

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
        .select(
          `id, line_number, item_description,
           unit_price, quantity, gross_amount, discount_amount, tax_amount,
           discount_percent, tax_percent, line_subtotal, net_amount, charge_item_id,
           charge_items(category, charge_code_display, source_type)`,
        )
        .eq("invoice_id", id)
        .order("line_number", { ascending: true }),
    ]);

    const lines = (lineRows ?? []) as LineRow[];
    setLineItems(lines);

    const pdfLines = lines.map((li) => {
      const ci = pickOne(li.charge_items);
      return {
        line_number: li.line_number,
        quantity: li.quantity,
        unit_price: li.unit_price,
        discount_percent: li.discount_percent,
        tax_percent: li.tax_percent,
        line_subtotal: li.line_subtotal,
        net_amount: li.net_amount,
        charge_label: li.item_description ?? ci?.charge_code_display ?? null,
        charge_code: null,
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
    <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/billing" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
            ← Billing
          </Link>
          <Link href="/billing/invoice/new" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
            New invoice
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-gray-600">Loading…</p>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : !row ? (
          <p className="text-sm text-gray-600">Invoice not found.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">{row.invoice_number ?? "Invoice"}</h1>
                  <p className="mt-1 text-sm text-gray-600">Status: {row.status ?? "—"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!pdfData}
                    onClick={() => pdfData && void downloadInvoicePdf(pdfData)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    disabled={!pdfData}
                    onClick={() => pdfData && openInvoicePdfInNewTab(pdfData)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Print / preview
                  </button>
                  <button
                    type="button"
                    disabled={balanceDue <= 0}
                    onClick={() => setPaymentOpen(true)}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    Record payment
                  </button>
                </div>
              </div>

              <p className="mt-4 text-2xl font-semibold tabular-nums text-blue-700">
                {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
                  gross,
                )}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                Balance due:{" "}
                <span className="font-semibold tabular-nums text-gray-900">
                  {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
                    balanceDue,
                  )}
                </span>
              </p>

              {row.notes ? (
                <p className="mt-4 whitespace-pre-wrap text-sm text-gray-600">{row.notes}</p>
              ) : null}
              <p className="mt-6 text-xs text-gray-500">Patient: {row.patient_id ?? "—"}</p>
            </div>

            {/* Line items */}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Line items</h2>
              </div>
              {lineItems.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-500">No line items.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/90 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-3 py-2.5 tabular-nums">#</th>
                        <th className="px-3 py-2.5">Description</th>
                        <th className="px-3 py-2.5">Category</th>
                        <th className="px-3 py-2.5 text-right">Qty</th>
                        <th className="px-3 py-2.5 text-right">Unit Price</th>
                        <th className="px-3 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lineItems.map((li, idx) => {
                        const ci = pickOne(li.charge_items);
                        const desc = li.item_description ?? ci?.charge_code_display ?? "—";
                        const category = fmtCategory(ci?.category);
                        const lineNum = li.line_number ?? idx + 1;
                        return (
                          <tr key={li.id ?? idx} className="hover:bg-gray-50/80">
                            <td className="px-3 py-3 tabular-nums text-gray-500">{lineNum}</td>
                            <td className="px-3 py-3 text-gray-900">{desc}</td>
                            <td className="px-3 py-3 text-gray-600">{category}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-800">
                              {num(li.quantity)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-800">
                              {inr(li.unit_price)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-900">
                              {inr(li.gross_amount ?? li.line_subtotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Financial summary */}
              <div className="border-t border-gray-100 px-4 py-4">
                <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between gap-8">
                    <dt className="text-gray-600">Subtotal</dt>
                    <dd className="tabular-nums text-gray-900">{inr(row.total_net)}</dd>
                  </div>
                  <div className="flex justify-between gap-8">
                    <dt className="text-gray-600">Discount</dt>
                    <dd className="tabular-nums text-gray-900">
                      {num(row.total_discount) > 0 ? `− ${inr(row.total_discount)}` : inr(0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-8">
                    <dt className="text-gray-600">Tax</dt>
                    <dd className="tabular-nums text-gray-900">{inr(row.total_tax)}</dd>
                  </div>
                  <div className="flex justify-between gap-8 border-t border-gray-200 pt-1.5 font-semibold">
                    <dt className="text-gray-900">Total</dt>
                    <dd className="tabular-nums text-gray-900">{inr(row.total_gross)}</dd>
                  </div>
                  <div className="flex justify-between gap-8">
                    <dt className="text-gray-600">Paid</dt>
                    <dd className="tabular-nums text-gray-900">{inr(row.amount_paid)}</dd>
                  </div>
                  <div className="flex justify-between gap-8 border-t border-gray-200 pt-1.5 font-bold">
                    <dt className={balanceDue > 0 ? "text-red-700" : "text-gray-900"}>Balance due</dt>
                    <dd className={`tabular-nums ${balanceDue > 0 ? "text-red-700" : "text-gray-900"}`}>
                      {inr(balanceDue)}
                    </dd>
                  </div>
                </dl>
              </div>
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
