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

function formatStarted(iso: string | undefined): string | null {
  if (!iso?.trim()) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Prefer a finite course from schedule text (e.g. "7 days") for badge styling. */
function durationHint(schedule: string): { label: string; ongoing: boolean } {
  const m = schedule.match(/(\d+)\s*(day|days|week|weeks|month|months)/i);
  if (m) {
    return { label: `${m[1]} ${m[2].toLowerCase()}`, ongoing: false };
  }
  return { label: "Ongoing", ongoing: true };
}

export default function CurrentMedicationsCard({
  requests,
  loading,
  error,
  subtitle = "From recent OPD prescriptions (grouped by clinical indication when documented).",
  onPastRx,
}: {
  requests: FhirMedicationRequest[];
  loading: boolean;
  error: string | null;
  /** Optional line under the title (e.g. when sourcing from an RPC vs encounter scan). */
  subtitle?: string;
  onPastRx?: () => void;
}) {
  const grouped = groupMedicationRequestsByIndication(requests);
  const sections = [...grouped.entries()].sort(([a], [b]) => {
    if (a === "Current") return -1;
    if (b === "Current") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 pb-3">
        <h3 className="text-sm font-bold text-gray-900">Current Medications</h3>
        {onPastRx ? (
          <button
            type="button"
            onClick={onPastRx}
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            Past Rx
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-gray-500">{subtitle}</p>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      ) : null}

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
                {indication === "Current" ? "General" : `For ${indication}`}
              </p>
              <ul className="space-y-3">
                {list.map((mr) => {
                  const sched = scheduleLine(mr);
                  const started = formatStarted(mr.authoredOn);
                  const hint = durationHint(sched);
                  return (
                    <li
                      key={mr.id}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-gray-100 bg-gradient-to-br from-white to-slate-50/50 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900">
                          {mr.medicationCodeableConcept?.text ?? "Medication"}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-600">{sched}</p>
                        {started ? (
                          <p className="mt-1 text-[11px] text-gray-500">Started: {started}</p>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                          hint.ongoing
                            ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
                            : "bg-amber-50 text-amber-900 ring-amber-100"
                        }`}
                      >
                        {hint.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
