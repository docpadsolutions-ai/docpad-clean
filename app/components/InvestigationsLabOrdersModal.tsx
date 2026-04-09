"use client";

import { FlaskConical, Microscope, X } from "lucide-react";

/**
 * Entry modal for lab orders & imaging (encounter quick action).
 * "Create Investigation Plan" → `/opd/[encounterId]/investigations`; "View results" → `.../investigations/view`.
 */
export default function InvestigationsLabOrdersModal({
  open,
  onClose,
  onCreateInvestigationPlan,
  onViewResults,
}: {
  open: boolean;
  onClose: () => void;
  onCreateInvestigationPlan: () => void;
  onViewResults: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="inv-lab-modal-title"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>

        <div className="border-b border-gray-100 px-5 pb-4 pt-5 pr-12">
          <h2 id="inv-lab-modal-title" className="text-lg font-bold text-gray-900">
            Lab orders &amp; imaging
          </h2>
          <p className="mt-1 text-sm text-gray-500">Choose how you want to work with investigations for this visit.</p>
        </div>

        <div className="space-y-3 p-5">
          <button
            type="button"
            onClick={() => {
              onCreateInvestigationPlan();
              onClose();
            }}
            className="flex w-full gap-4 rounded-xl border-2 border-gray-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <FlaskConical className="h-6 w-6" strokeWidth={2} aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900">Create Investigation Plan</p>
              <p className="mt-1 text-sm text-gray-600">
                Open the investigation plan to order tests from the hospital catalogue for this visit.
              </p>
            </div>
          </button>

          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/30 p-4">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                <Microscope className="h-6 w-6" strokeWidth={2} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-gray-900">View Investigations</p>
                <p className="mt-1 text-sm text-gray-600">
                  Open the patient&apos;s investigation dashboard: results, trends, and workflow for this encounter and
                  history.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onViewResults();
                    onClose();
                  }}
                  className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  View results
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
