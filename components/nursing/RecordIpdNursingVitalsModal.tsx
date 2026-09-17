"use client";

import VitalsEntryForm from "@/components/ipd/VitalsEntryForm";

export type RecordIpdNursingVitalsModalProps = {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  admissionId: string;
  patientId: string;
  recordedByPractitionerId: string;
  /** Show optional GCS when recorder role is doctor or nurse. */
  showGcsField: boolean;
  onSaved: () => void;
};

export default function RecordIpdNursingVitalsModal({
  open,
  onClose,
  hospitalId,
  admissionId,
  patientId,
  recordedByPractitionerId,
  showGcsField,
  onSaved,
}: RecordIpdNursingVitalsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ipd-nursing-vitals-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 id="ipd-nursing-vitals-modal-title" className="text-base font-bold text-gray-900">
            Record vitals
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Each reading is timestamped when you save. You can record serial vitals without closing this window. Name and timestamps are
            stored for audit (NABH).
          </p>
        </div>
        <VitalsEntryForm
          active={open}
          hospitalId={hospitalId}
          admissionId={admissionId}
          patientId={patientId}
          recordedByPractitionerId={recordedByPractitionerId}
          showGcsField={showGcsField}
          onCancel={onClose}
          onSaved={() => {
            onSaved();
          }}
        />
      </div>
    </div>
  );
}
