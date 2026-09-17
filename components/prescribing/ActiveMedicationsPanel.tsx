"use client";

import type { ActiveMedication, ReconciliationAction } from "@/hooks/usePrescriptionSafety";

const ACTIONS: { value: ReconciliationAction; label: string; className: string }[] = [
  { value: "continue", label: "Continue", className: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { value: "stop", label: "Stop", className: "border-red-300 bg-red-50 text-red-800" },
  { value: "modify", label: "Modify", className: "border-amber-300 bg-amber-50 text-amber-900" },
];

/**
 * SOW §2.2 — what the patient is already taking, shown at the point of prescribing, with a
 * continue / stop / modify decision recorded against this encounter.
 */
export default function ActiveMedicationsPanel({
  medications,
  decisions,
  onDecision,
  loading,
  disabled = false,
}: {
  medications: ActiveMedication[];
  decisions: Record<string, ReconciliationAction>;
  onDecision: (medication: ActiveMedication, action: ReconciliationAction) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const undecided = medications.filter((m) => !decisions[m.prescription_id]).length;

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-3" aria-label="Active medications">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-blue-900">
          Currently on {medications.length > 0 ? `(${medications.length})` : ""}
        </h3>
        {loading ? (
          <span className="text-[11px] text-blue-700">Checking…</span>
        ) : undecided > 0 ? (
          <span className="text-[11px] font-medium text-blue-800">{undecided} not yet reviewed</span>
        ) : medications.length > 0 ? (
          <span className="text-[11px] font-medium text-emerald-700">All reviewed</span>
        ) : null}
      </header>

      {medications.length === 0 ? (
        <p className="text-[11px] text-blue-900/70">
          {loading ? "Loading the patient's active medications…" : "No active medications on record."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {medications.map((med) => {
            const decision = decisions[med.prescription_id];
            return (
              <li
                key={med.prescription_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-white px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-gray-800">
                    {med.medicine_name}
                    {med.generic_name ? (
                      <span className="ml-1 font-normal text-gray-500">({med.generic_name})</span>
                    ) : null}
                  </p>
                  <p className="truncate text-[11px] text-gray-500">
                    {[med.dose, med.frequency, med.duration].filter(Boolean).join(" · ") || "No dosing recorded"}
                    {med.expected_end ? ` · until ${med.expected_end}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1" role="group" aria-label={`Decision for ${med.medicine_name}`}>
                  {ACTIONS.map((action) => {
                    const selected = decision === action.value;
                    return (
                      <button
                        key={action.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onDecision(med, action.value)}
                        aria-pressed={selected}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          selected ? action.className : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
