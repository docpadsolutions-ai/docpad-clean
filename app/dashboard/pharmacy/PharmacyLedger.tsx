"use client";

/** Row from `pharmacy_dispensed_prescriptions` (`SELECT *`); core columns used in UI. */
export type PharmacyLedgerRow = Record<string, unknown> & {
  prescription_id: string;
};

export function filterLedgerRows(rows: PharmacyLedgerRow[], query: string): PharmacyLedgerRow[] {
  const s = query.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => {
    const patient = String(r.patient_name ?? "").toLowerCase();
    const med = String(r.medicine_name ?? "").toLowerCase();
    return patient.includes(s) || med.includes(s);
  });
}

function formatDispensedDate(d: unknown): string {
  if (d == null || !String(d).trim()) return "—";
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split("-").map(Number);
    if (y && m && day) return new Date(y, m - 1, day).toLocaleDateString(undefined, { dateStyle: "medium" });
  }
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? s : t.toLocaleDateString(undefined, { dateStyle: "medium" });
}

type Props = {
  rows: PharmacyLedgerRow[];
  /** Total rows before client search filter (for empty-search messaging). */
  unfilteredRowCount: number;
  loading: boolean;
  error: string | null;
  searchEmpty?: boolean;
  onRowClick: (prescriptionId: string) => void;
};

export function PharmacyLedger({
  rows,
  unfilteredRowCount,
  loading,
  error,
  searchEmpty = false,
  onRowClick,
}: Props) {
  if (loading && rows.length === 0 && !error) {
    return <p className="text-sm text-slate-500">Loading ledger…</p>;
  }

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
        <p className="mt-2 text-xs text-red-700">
          Ensure the <code className="rounded bg-red-100 px-1">pharmacy_dispensed_prescriptions</code> view exists and
          select is granted.
        </p>
      </div>
    );
  }

  if (unfilteredRowCount === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No dispensed prescriptions in the ledger yet.
      </p>
    );
  }

  if (searchEmpty) {
    return (
      <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
        No ledger rows match your search
        <span className="mt-1 block text-xs text-amber-800">
          ({unfilteredRowCount} line{unfilteredRowCount === 1 ? "" : "s"} hidden by filter)
        </span>
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Patient</th>
            <th className="px-4 py-3">Medication</th>
            <th className="px-4 py-3">Pharmacist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const id = String(r.prescription_id ?? "").trim();
            const open = () => {
              if (id) onRowClick(id);
            };
            return (
              <tr
                key={id || JSON.stringify(r)}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                  }
                }}
                className="cursor-pointer border-b border-slate-100 last:border-0 transition hover:bg-emerald-50/60 focus-visible:bg-emerald-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
              >
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">
                  {formatDispensedDate(r.dispensed_at)}
                </td>
                <td className="max-w-[180px] px-4 py-3 text-slate-900">
                  <span className="line-clamp-2 font-medium">
                    {String(r.patient_name ?? "").trim() || "—"}
                  </span>
                </td>
                <td className="max-w-[220px] px-4 py-3 text-slate-800">
                  <span className="line-clamp-2">{String(r.medicine_name ?? "").trim() || "—"}</span>
                </td>
                <td className="max-w-[180px] px-4 py-3 text-slate-700">
                  <span className="line-clamp-2">{String(r.pharmacist_name ?? "").trim() || "—"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
        Click a row to open the receipt (same as <code className="rounded bg-slate-100 px-1">generate_prescription_receipt</code>
        ) — use Print in the modal.
      </p>
    </div>
  );
}
