/**
 * Billing / new-invoice form hook — alias of `useInvoiceCreate`.
 * Submission flow, step logs, and error handling live in `./useInvoiceCreate` (`handleSubmit` inside `submit`).
 */
export {
  useInvoiceCreate as useBillingForm,
  invoiceFormSchema,
  invoiceLineSchema,
  emptyInvoiceLine,
  computeLineNet,
  computeInvoiceTotals,
} from "./useInvoiceCreate";
export type { InvoiceLineFormState } from "./useInvoiceCreate";
