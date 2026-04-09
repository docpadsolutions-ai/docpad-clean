"use client";

import { InvoiceForm } from "@/components/billing/InvoiceForm";

export default function NewInvoicePage() {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-slate-950">
      <InvoiceForm />
    </div>
  );
}
