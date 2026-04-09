"use client";

import type { RegisteredPatientRow } from "../lib/registerNewPatient";
import { NewPatientRegistrationForm } from "./NewPatientRegistrationForm";

export type NewPatientModalProps = {
  open: boolean;
  onClose: () => void;
  orgId: string | null;
  onSuccess: (patient: RegisteredPatientRow) => void;
};

export default function NewPatientModal({ open, onClose, orgId, onSuccess }: NewPatientModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-patient-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 id="new-patient-modal-title" className="text-lg font-bold text-gray-900">
            New patient registration
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
            aria-label="Close"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
          <NewPatientRegistrationForm
            orgId={orgId}
            variant="modal"
            onCancel={onClose}
            onSuccess={(patient) => {
              onSuccess(patient);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
