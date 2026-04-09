"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { practitionersOrFilterForAuthUid } from "@/app/lib/practitionerAuthLookup";
import { supabase } from "@/app/supabase";
import { toast } from "sonner";

type Pgish = { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };

/** Never throw a bare PostgREST object — empty `{}` is truthy and logs as `{}` in the console. */
function throwPostgrestIfPresent(error: Pgish | null | undefined, fallback: string): void {
  if (error == null) return;
  const msg = typeof error.message === "string" ? error.message.trim() : "";
  const details = typeof error.details === "string" ? error.details.trim() : "";
  const hint = typeof error.hint === "string" ? error.hint.trim() : "";
  const code = typeof error.code === "string" ? error.code.trim() : "";
  if (!msg && !details && !hint && !code) {
    throw new Error(fallback);
  }
  const parts = [code ? `[${code}]` : "", msg, details, hint].filter(Boolean);
  throw new Error(parts.join(" ").trim() || fallback);
}

function invoiceErrDebugPayload(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const o = err as Error & { code?: unknown; details?: unknown; hint?: unknown };
    return {
      name: err.name,
      message: err.message,
      ...(o.code !== undefined ? { code: o.code } : {}),
      ...(o.details !== undefined ? { details: o.details } : {}),
      ...(o.hint !== undefined ? { hint: o.hint } : {}),
    };
  }
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    return {
      message: o.message,
      code: o.code,
      details: o.details,
      hint: o.hint,
    };
  }
  return { value: String(err) };
}

/** PostgREST / Supabase errors are plain objects with `message`, not always `Error`. */
function invoiceSubmissionErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object") {
    const o = err as Pgish;
    const msg = typeof o.message === "string" ? o.message.trim() : "";
    const details = typeof o.details === "string" ? o.details.trim() : "";
    const hint = typeof o.hint === "string" ? o.hint.trim() : "";
    const code = typeof o.code === "string" ? o.code.trim() : "";
    const parts = [code ? `[${code}]` : "", msg, details, hint].filter(Boolean);
    if (parts.length) return parts.join(" ").trim();
  }
  return "Invoice save failed";
}

export const invoiceLineSchema = z.object({
  definitionId: z.string().uuid(),
  displayName: z.string().min(1),
  code: z.string().min(1),
  codeSystem: z.string().min(1),
  category: z.string().optional().default(""),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unitPrice: z.number().positive("Unit price must be greater than 0"),
  discountPercent: z.number().min(0).max(100),
  taxPercent: z.number().min(0).max(100),
});

export const invoiceFormSchema = z.object({
  patientId: z.string().uuid("Select a patient"),
  opdEncounterId: z.string().uuid().nullable().optional(),
  billingAccountId: z.string().uuid().nullable().optional(),
  notes: z.string().max(8000).optional().default(""),
  dueDate: z.string().optional().nullable(),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line item"),
});

export type InvoiceLineFormState = {
  clientId: string;
  definitionId: string | null;
  displayName: string;
  code: string;
  codeSystem: string;
  category: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
};

export function emptyInvoiceLine(): InvoiceLineFormState {
  return {
    clientId: typeof crypto !== "undefined" ? crypto.randomUUID() : `line-${Date.now()}`,
    definitionId: null,
    displayName: "",
    code: "",
    codeSystem: "http://snomed.info/sct",
    category: "",
    quantity: 1,
    unitPrice: 0,
    discountPercent: 0,
    taxPercent: 0,
  };
}

/** Line net: qty × unit × (1 − discount%) × (1 + tax%). */
export function computeLineNet(line: Pick<InvoiceLineFormState, "quantity" | "unitPrice" | "discountPercent" | "taxPercent">): number {
  const d = line.discountPercent / 100;
  const t = line.taxPercent / 100;
  return line.quantity * line.unitPrice * (1 - d) * (1 + t);
}

/**
 * Invoice header totals (matches `invoices.total_net`, `total_discount`, `total_tax`, `total_gross`):
 * - **totalNet** — sum of qty × unit price before line discount and tax (“base” / list amount).
 * - **totalDiscount** — sum of line discount amounts (off the base).
 * - **totalTax** — sum of tax amounts (applied after discount on each line).
 * - **totalGross** — sum of line finals: after discount + tax (amount due before payments).
 */
export function computeInvoiceTotals(lines: InvoiceLineFormState[]) {
  let totalNet = 0;
  let totalDiscount = 0;
  let totalTax = 0;
  let totalGross = 0;

  for (const li of lines) {
    if (!li.definitionId || li.unitPrice <= 0 || li.quantity <= 0) continue;
    const base = li.quantity * li.unitPrice;
    const afterDisc = base * (1 - li.discountPercent / 100);
    const discAmt = base - afterDisc;
    const taxAmt = afterDisc * (li.taxPercent / 100);
    const net = afterDisc + taxAmt;
    totalNet += base;
    totalDiscount += discAmt;
    totalTax += taxAmt;
    totalGross += net;
  }

  return {
    totalNet: roundMoney(totalNet),
    totalDiscount: roundMoney(totalDiscount),
    totalTax: roundMoney(totalTax),
    totalGross: roundMoney(totalGross),
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineSubtotalFromValidated(line: z.infer<typeof invoiceLineSchema>): number {
  return roundMoney(line.quantity * line.unitPrice * (1 - line.discountPercent / 100));
}

export function useInvoiceCreate() {
  const router = useRouter();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [opdEncounterId, setOpdEncounterId] = useState<string | null>(null);
  const [billingAccountId, setBillingAccountId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState<string>("");
  const [lines, setLines] = useState<InvoiceLineFormState[]>(() => [emptyInvoiceLine()]);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totals = useMemo(() => computeInvoiceTotals(lines), [lines]);

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, emptyInvoiceLine()]);
  }, []);

  const removeLine = useCallback((clientId: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.clientId !== clientId)));
  }, []);

  const updateLine = useCallback((clientId: string, patch: Partial<InvoiceLineFormState>) => {
    setLines((prev) => prev.map((l) => (l.clientId === clientId ? { ...l, ...patch } : l)));
  }, []);

  const submit = useCallback(
    async (status: "draft" | "issued") => {
      setValidationMessage(null);
      setFieldErrors({});

      const chargedLines = lines.filter((l) => l.definitionId);
      if (chargedLines.length === 0) {
        const msg =
          "Select at least one charge using “Search charge item”. Unit price and totals apply after you pick a catalog row (typing price alone is not enough).";
        setFieldErrors({ lines: msg });
        setValidationMessage(msg);
        return { ok: false as const };
      }

      const payload = {
        patientId: patientId ?? "",
        opdEncounterId: opdEncounterId || null,
        billingAccountId: billingAccountId || null,
        notes: notes.trim(),
        dueDate: dueDate.trim() || null,
        lines: chargedLines.map((l) => ({
            definitionId: l.definitionId as string,
            displayName: l.displayName,
            code: l.code,
            codeSystem: l.codeSystem,
            category: l.category,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            taxPercent: l.taxPercent,
          })),
      };

      const parsed = invoiceFormSchema.safeParse(payload);
      if (!parsed.success) {
        const flat = parsed.error.flatten();
        const fe: Record<string, string> = {};
        if (flat.fieldErrors.patientId?.[0]) fe.patientId = flat.fieldErrors.patientId[0];
        if (flat.fieldErrors.lines?.[0]) fe.lines = flat.fieldErrors.lines[0];
        parsed.error.issues.forEach((iss, i) => {
          fe[`issue_${i}`] = iss.message;
        });
        setFieldErrors(fe);
        setValidationMessage(flat.formErrors[0] ?? "Fix the highlighted fields.");
        return { ok: false as const };
      }

      const v = parsed.data;
      const formData = {
        patient_id: v.patientId,
        encounter_id: v.opdEncounterId ?? null,
        account_id: v.billingAccountId ?? null,
        due_date: v.dueDate || null,
        notes: v.notes || null,
        lineItems: v.lines.map((row) => ({
          /** ChargeItemDefinition / charge_item_definitions.id (FHIR + definition FK) */
          charge_item_id: row.definitionId,
          description: row.displayName,
          code: row.code,
          codeSystem: row.codeSystem,
          category: row.category?.trim() ? row.category : "other",
          quantity: row.quantity,
          unit_price: row.unitPrice,
          discount_percent: row.discountPercent,
          tax_percent: row.taxPercent,
          displayName: row.displayName,
        })),
      };

      const lineStatesForTotals = v.lines.map((l, i) => ({
        ...emptyInvoiceLine(),
        clientId: String(i),
        definitionId: l.definitionId,
        displayName: l.displayName,
        code: l.code,
        codeSystem: l.codeSystem,
        category: l.category ?? "",
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        taxPercent: l.taxPercent,
      }));
      const tAgg = computeInvoiceTotals(lineStatesForTotals);
      const totals = {
        total_gross: tAgg.totalGross,
        total_discount: tAgg.totalDiscount,
        total_tax: tAgg.totalTax,
        total_net: tAgg.totalNet,
      };

      setIsSubmitting(true);

      const handleSubmit = async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        const { data: practitioner, error: prUserErr } = await supabase
          .from("practitioners")
          .select("hospital_id")
          .eq("user_id", session.user.id)
          .single();

        let hospitalRow = practitioner;
        if (prUserErr || !hospitalRow?.hospital_id) {
          const fb = await supabase
            .from("practitioners")
            .select("hospital_id")
            .or(practitionersOrFilterForAuthUid(session.user.id))
            .limit(1)
            .maybeSingle();
          hospitalRow = fb.data;
        }

        if (!hospitalRow?.hospital_id) throw new Error("Hospital context not found");

        const hospitalId = String(hospitalRow.hospital_id).trim();

        const fhirInvoice = {
          resourceType: "Invoice",
          status: status === "issued" ? "issued" : "draft",
          date: new Date().toISOString(),
          subject: { reference: `Patient/${formData.patient_id}` },
          totalNet: { value: totals.total_net, currency: "INR" },
          totalGross: { value: totals.total_gross, currency: "INR" },
          lineItem: formData.lineItems.map((item) => ({
            chargeItemReference: { reference: `ChargeItemDefinition/${item.charge_item_id}` },
            priceComponent: [
              { type: "base" as const, amount: { value: item.unit_price, currency: "INR" } },
            ],
          })),
        };

        const { data: invoice, error: invError } = await supabase
          .from("invoices")
          .insert({
            hospital_id: hospitalId,
            patient_id: formData.patient_id,
            encounter_id: formData.encounter_id,
            account_id: formData.account_id,
            due_date: formData.due_date,
            total_net: totals.total_net,
            total_gross: totals.total_gross,
            total_discount: totals.total_discount,
            total_tax: totals.total_tax,
            amount_paid: 0,
            status,
            notes: formData.notes,
            fhir_json: fhirInvoice,
          })
          .select()
          .single();

        throwPostgrestIfPresent(invError, "Invoice insert failed");
        if (!invoice?.id) throw new Error("No invoice id returned");

        const linePayloads: Array<{
          invoice_id: string;
          charge_item_id: string;
          line_number: number;
          quantity: number;
          unit_price: number;
          discount_percent: number;
          tax_percent: number;
          line_subtotal: number;
          net_amount: number;
        }> = [];

        for (let i = 0; i < formData.lineItems.length; i++) {
          const item = formData.lineItems[i];
          const lineNumber = i + 1;
          const netAmount = roundMoney(
            item.quantity * item.unit_price * (1 - item.discount_percent / 100) * (1 + item.tax_percent / 100),
          );
          const lineSub = roundMoney(item.quantity * item.unit_price * (1 - item.discount_percent / 100));

          const cat = item.category?.trim() ? item.category.trim() : "other";
          const display = item.displayName?.trim() || item.code?.trim() || "Service";

          const { data: ciRow, error: ciErr } = await supabase
            .from("charge_items")
            .insert({
              hospital_id: hospitalId,
              patient_id: formData.patient_id,
              encounter_id: formData.encounter_id,
              definition_id: item.charge_item_id,
              charge_code: item.code,
              charge_code_system: item.codeSystem || "http://snomed.info/sct",
              charge_code_display: display,
              category: cat,
              display_label: item.displayName,
              unit_price_snapshot: item.unit_price,
              unit_price: item.unit_price,
              currency: "INR",
              quantity_value: item.quantity,
              net_amount: netAmount,
              source_type: "manual",
            })
            .select("id")
            .single();

          throwPostgrestIfPresent(ciErr, "Failed to create charge item");
          if (!ciRow?.id) throw new Error("Failed to create charge item (no id returned)");

          linePayloads.push({
            invoice_id: invoice.id,
            charge_item_id: String(ciRow.id),
            line_number: lineNumber,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_percent: item.discount_percent,
            tax_percent: item.tax_percent,
            line_subtotal: lineSub,
            net_amount: netAmount,
          });
        }

        const { error: lineError } = await supabase.from("invoice_line_items").insert(linePayloads);
        throwPostgrestIfPresent(lineError, "Failed to save invoice line items");

        toast.success(`Invoice ${status === "issued" ? "issued" : "saved as draft"}`);
        router.push(`/billing/invoice/${invoice.id}`);
      };

      try {
        await handleSubmit();
        return { ok: true as const };
      } catch (err) {
        const dbg = invoiceErrDebugPayload(err);
        console.error("[invoice] Insert failed:", invoiceSubmissionErrorMessage(err), dbg);
        const msg = invoiceSubmissionErrorMessage(err);
        toast.error(msg);
        setValidationMessage(msg);
        return { ok: false as const };
      } finally {
        setIsSubmitting(false);
      }
    },
    [patientId, opdEncounterId, billingAccountId, notes, dueDate, lines, router],
  );

  return {
    patientId,
    setPatientId,
    opdEncounterId,
    setOpdEncounterId,
    billingAccountId,
    setBillingAccountId,
    notes,
    setNotes,
    dueDate,
    setDueDate,
    lines,
    addLine,
    removeLine,
    updateLine,
    totals,
    validationMessage,
    fieldErrors,
    isSubmitting,
    submitDraft: () => submit("draft"),
    submitIssue: () => submit("issued"),
  };
}
