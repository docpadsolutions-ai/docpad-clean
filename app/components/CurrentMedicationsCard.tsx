"use client";

import type { FhirMedicationRequest } from "../lib/fhirMedicationRequest";
import { groupMedicationRequestsByIndication } from "../lib/fhirMedicationRequest";

/** Secondary line: expanded frequency · duration (see `prescriptionSummaryMap`). */
function scheduleLine(mr: FhirMedicationRequest): string {
  const di = mr.dosageInstruction?.[0];
  if (di?.text?.trim()) return di.text.trim();
  if (di?.doseAndRateSummary?.trim()) return di.doseAndRateSummary.trim();
  return "—";
}

export default function CurrentMedicationsCard({
  requests,
  loading,
  error,
  subtitle = "From `prescriptions` for the last 3 OPD encounters (frequency shown in full words).",
}: {
  requests: FhirMedicationRequest[];
  loading: boolean;
  error: string | null;
  /** Optional line under the title (e.g. when sourcing from an RPC vs encounter scan). */
  subtitle?: string;
}) {
  const grouped = groupMedicationRequestsByIndication(requests);
  const sections = [...grouped.entries()].sort(([a], [b]) => {
    if (a === "Current") return -1;
    if (b === "Current") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="border-b border-gray-100 pb-3 text-sm font-bold text-gray-900">Current medications</h3>
      <p className="mt-2 text-[11px] text-gray-500">{subtitle}</p>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <ul className="mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <li key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </ul>
      ) : requests.length === 0 ? (
        <p className="mt-6 text-center text-sm text-gray-500">No medications in recent encounters.</p>
      ) : (
        <div className="mt-4 space-y-5">
          {sections.map(([indication, list]) => (
            <div key={indication}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {indication === "Current" ? "Current" : `Indication: ${indication}`}
              </p>
              <ul className="space-y-3">
                {list.map((mr) => (
                  <li
                    key={mr.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-gray-100 bg-gradient-to-br from-white to-slate-50/50 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {mr.medicationCodeableConcept?.text ?? "Medication"}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">{scheduleLine(mr)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800 ring-1 ring-sky-100">
                      Ongoing
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
