/**
 * Minimal FHIR Invoice-shaped JSON for `invoices.fhir_json` (R5-oriented).
 * DocPad persists derived analytics in Postgres; this blob supports interchange.
 */

export type FhirInvoiceLineInput = {
  sequence: number;
  chargeItemId: string;
  code: string;
  codeSystem: string;
  display: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  netAmount: number;
};

export function buildInvoiceFhirJson(opts: {
  patientId: string;
  encounterId: string | null;
  status: "draft" | "issued";
  currency: string;
  lineItems: FhirInvoiceLineInput[];
  /** Final amount due (after line discount + tax). */
  totalGross: number;
  /** Base amount before discount and tax (sum of qty × unit price). */
  totalNet: number;
  totalDiscount: number;
  totalTax: number;
  notes: string | null;
}): Record<string, unknown> {
  const statusMap: Record<string, string> = {
    draft: "draft",
    issued: "issued",
  };

  return {
    resourceType: "Invoice",
    meta: {
      profile: ["http://hl7.org/fhir/5.0/StructureDefinition/Invoice"],
    },
    status: statusMap[opts.status] ?? "draft",
    subject: { reference: `Patient/${opts.patientId}` },
    ...(opts.encounterId
      ? {
          recipient: [
            {
              reference: `Encounter/${opts.encounterId}`,
            },
          ],
        }
      : {}),
    date: new Date().toISOString(),
    note: opts.notes?.trim()
      ? [{ text: opts.notes.trim() }]
      : undefined,
    lineItem: opts.lineItems.map((li) => ({
      sequence: li.sequence,
      chargeItemReference: {
        reference: `ChargeItem/${li.chargeItemId}`,
      },
      chargeItemCodeableConcept: {
        coding: [
          {
            system: li.codeSystem || "http://snomed.info/sct",
            code: li.code,
            display: li.display,
          },
        ],
      },
      quantity: { value: li.quantity },
      priceComponent: [
        {
          type: "base",
          amount: { value: li.unitPrice, currency: opts.currency },
        },
        ...(li.discountPercent > 0
          ? [
              {
                type: "discount",
                amount: {
                  value: -(li.unitPrice * li.quantity * li.discountPercent) / 100,
                  currency: opts.currency,
                },
              },
            ]
          : []),
        ...(li.taxPercent > 0
          ? [
              {
                type: "tax",
                amount: {
                  value: (li.unitPrice * li.quantity * (1 - li.discountPercent / 100) * li.taxPercent) / 100,
                  currency: opts.currency,
                },
              },
            ]
          : []),
      ],
    })),
    totalGross: { value: opts.totalGross, currency: opts.currency },
    totalNet: { value: opts.totalNet, currency: opts.currency },
    extension: [
      {
        url: "http://docpad.org/fhir/StructureDefinition/invoice-total-net",
        valueMoney: { value: opts.totalNet, currency: opts.currency },
      },
      {
        url: "http://docpad.org/fhir/StructureDefinition/invoice-total-discount",
        valueMoney: { value: opts.totalDiscount, currency: opts.currency },
      },
      {
        url: "http://docpad.org/fhir/StructureDefinition/invoice-total-tax",
        valueMoney: { value: opts.totalTax, currency: opts.currency },
      },
    ],
  };
}
