import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoicePdfData } from "./InvoicePDF";

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

type InvRow = {
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
};

/** Load full bundle for PDF generation (same shape as invoice detail page). */
export async function fetchInvoicePdfData(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<InvoicePdfData | null> {
  const { data: inv, error } = await supabase
    .from("invoices")
    .select(
      "id, hospital_id, invoice_number, status, invoice_date, due_date, total_net, total_discount, total_tax, total_gross, amount_paid, balance_due, patient_id, notes, fhir_json",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !inv) return null;

  const invRow = inv as InvRow;
  const patientId = invRow.patient_id;
  const hid = invRow.hospital_id;

  const [{ data: patient }, { data: hospital }, { data: lineRows }] = await Promise.all([
    patientId
      ? supabase.from("patients").select("full_name, phone, docpad_id, gender, date_of_birth, address").eq("id", patientId).maybeSingle()
      : Promise.resolve({ data: null }),
    hid ? supabase.from("hospitals").select("name, address, city, phone").eq("id", hid).maybeSingle() : Promise.resolve({ data: null }),
    supabase
      .from("invoice_line_items")
      .select("line_number, quantity, unit_price, discount_percent, tax_percent, line_subtotal, net_amount, charge_item_id")
      .eq("invoice_id", invoiceId)
      .order("line_number", { ascending: true }),
  ]);

  const lines = (lineRows ?? []) as LineRow[];
  const chargeIds = [...new Set(lines.map((l) => l.charge_item_id).filter(Boolean))];
  const chargeMap = new Map<string, { label: string | null; code: string | null }>();

  if (chargeIds.length > 0) {
    const { data: charges } = await supabase.from("charge_items").select("id, display_label, charge_code").in("id", chargeIds);
    for (const c of charges ?? []) {
      const r = c as { id: string; display_label: string | null; charge_code: string | null };
      chargeMap.set(r.id, { label: r.display_label, code: r.charge_code });
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

  return {
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
  };
}
