"use client";

import Link from "next/link";

export default function IpdDashboardPage() {
  return (
    <div className="p-6 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Inpatient (IPD)</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Open an admission from the OPD encounter using{" "}
        <span className="font-semibold text-foreground">Admit this patient</span>, or navigate directly to{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">/dashboard/ipd/&lt;admissionId&gt;</code>.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/dashboard/opd" className="font-semibold text-primary underline hover:no-underline">
          Back to OPD
        </Link>
      </p>
    </div>
  );
}
