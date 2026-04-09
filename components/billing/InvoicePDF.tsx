"use client";

import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1e293b",
  },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  brandSub: { fontSize: 9, color: "#64748b", marginBottom: 16 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  meta: { fontSize: 9, color: "#64748b", marginBottom: 16 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 12,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingBottom: 4,
  },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 100, color: "#64748b" },
  value: { flex: 1 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 4,
    marginTop: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f1f5f9",
    fontSize: 8,
  },
  colDesc: { width: "38%" },
  colQty: { width: "10%", textAlign: "right" },
  colUnit: { width: "14%", textAlign: "right" },
  colDisc: { width: "10%", textAlign: "right" },
  colTax: { width: "10%", textAlign: "right" },
  colNet: { width: "18%", textAlign: "right", fontFamily: "Helvetica-Bold" },
  totalsBlock: { marginTop: 16, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 4, width: "45%" },
  totalLabel: { width: "55%", textAlign: "right", paddingRight: 8, color: "#64748b" },
  totalValue: { width: "45%", textAlign: "right", fontFamily: "Helvetica-Bold" },
  terms: { marginTop: 20, fontSize: 8, color: "#64748b", lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingTop: 8,
  },
});

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export type InvoicePdfPatient = {
  full_name: string | null;
  phone: string | null;
  docpad_id: string | null;
  gender: string | null;
  date_of_birth: string | null;
  address: string | null;
};

export type InvoicePdfHospital = {
  name: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
};

export type InvoicePdfLine = {
  line_number: number;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  tax_percent: number | string;
  line_subtotal: number | string;
  net_amount: number | string;
  charge_label: string | null;
  charge_code: string | null;
};

export type InvoicePdfInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  status: string | null;
  total_net: number | string | null;
  total_discount: number | string | null;
  total_tax: number | string | null;
  total_gross: number | string | null;
  amount_paid: number | string | null;
  balance_due: number | string | null;
  notes: string | null;
  fhir_json: unknown;
};

export type InvoicePdfData = {
  invoice: InvoicePdfInvoice;
  patient: InvoicePdfPatient | null;
  hospital: InvoicePdfHospital | null;
  lines: InvoicePdfLine[];
};

function fhirInvoiceRef(data: InvoicePdfData): string {
  const j = data.invoice.fhir_json;
  if (j && typeof j === "object" && "id" in j && typeof (j as { id: unknown }).id === "string") {
    return `Invoice/${(j as { id: string }).id}`;
  }
  return `Invoice/${data.invoice.id}`;
}

export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const inv = data.invoice;
  const due = inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-IN") : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>{data.hospital?.name ?? "Hospital"}</Text>
        <Text style={styles.brandSub}>
          {[data.hospital?.address, data.hospital?.city].filter(Boolean).join(", ")}
          {data.hospital?.phone ? ` · ${data.hospital.phone}` : ""}
        </Text>

        <Text style={styles.title}>Tax Invoice</Text>
        <Text style={styles.meta}>
          {inv.invoice_number ?? inv.id}
          {inv.invoice_date
            ? ` · ${new Date(inv.invoice_date).toLocaleDateString("en-IN")}`
            : ""}
          {inv.status ? ` · ${inv.status}` : ""}
        </Text>

        <Text style={styles.sectionTitle}>Patient</Text>
        {data.patient ? (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{data.patient.full_name ?? "—"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>MRN / ID</Text>
              <Text style={styles.value}>{data.patient.docpad_id ?? "—"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Phone</Text>
              <Text style={styles.value}>{data.patient.phone ?? "—"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>DOB / Gender</Text>
              <Text style={styles.value}>
                {[data.patient.date_of_birth, data.patient.gender].filter(Boolean).join(" · ") || "—"}
              </Text>
            </View>
            {data.patient.address ? (
              <View style={styles.row}>
                <Text style={styles.label}>Address</Text>
                <Text style={styles.value}>{data.patient.address}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={{ fontSize: 9, color: "#64748b" }}>Patient details unavailable.</Text>
        )}

        <Text style={styles.sectionTitle}>Line items</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colUnit}>Unit</Text>
          <Text style={styles.colDisc}>Disc%</Text>
          <Text style={styles.colTax}>Tax%</Text>
          <Text style={styles.colNet}>Net</Text>
        </View>
        {data.lines.map((li) => (
          <View key={li.line_number} style={styles.tableRow} wrap={false}>
            <Text style={styles.colDesc}>
              {li.charge_label ?? "Item"}
              {li.charge_code ? ` (${li.charge_code})` : ""}
            </Text>
            <Text style={styles.colQty}>{String(n(li.quantity))}</Text>
            <Text style={styles.colUnit}>{formatInr(n(li.unit_price))}</Text>
            <Text style={styles.colDisc}>{String(n(li.discount_percent))}</Text>
            <Text style={styles.colTax}>{String(n(li.tax_percent))}</Text>
            <Text style={styles.colNet}>{formatInr(n(li.net_amount))}</Text>
          </View>
        ))}

        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total net</Text>
            <Text style={styles.totalValue}>{formatInr(n(inv.total_net))}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total discount</Text>
            <Text style={styles.totalValue}>{formatInr(n(inv.total_discount))}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total tax</Text>
            <Text style={styles.totalValue}>{formatInr(n(inv.total_tax))}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total gross</Text>
            <Text style={styles.totalValue}>{formatInr(n(inv.total_gross))}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Amount paid</Text>
            <Text style={styles.totalValue}>{formatInr(n(inv.amount_paid))}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Balance due</Text>
            <Text style={styles.totalValue}>{formatInr(n(inv.balance_due))}</Text>
          </View>
        </View>

        <Text style={styles.terms}>
          Payment terms: {due ? `Payment due by ${due}. ` : ""}
          {inv.notes?.trim() ? `Notes: ${inv.notes.trim()}` : "Thank you for your visit."}
        </Text>

        <Text style={styles.footer} fixed>
          FHIR resource reference: {fhirInvoiceRef(data)} · Generated by DocPad · Not a clinical document
        </Text>
      </Page>
    </Document>
  );
}

/** Download PDF to disk (browser file save). */
export async function downloadInvoicePdf(data: InvoicePdfData): Promise<void> {
  const blob = await pdf(<InvoicePdfDocument data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${data.invoice.invoice_number ?? data.invoice.id}.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Open PDF in a new tab for print / system viewer (closest to “present file”). */
export function openInvoicePdfInNewTab(data: InvoicePdfData): void {
  void pdf(<InvoicePdfDocument data={data} />).toBlob().then((blob) => {
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) {
      w.addEventListener(
        "load",
        () => {
          try {
            w.focus();
            w.print();
          } catch {
            /* viewer may block print */
          }
        },
        { once: true },
      );
    }
  });
}
