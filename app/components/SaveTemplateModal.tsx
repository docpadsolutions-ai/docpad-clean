"use client";

import { useEffect, useId, useState } from "react";
import type { PrescriptionLine } from "../lib/prescriptionLine";
import { saveRxTemplateBundle } from "../lib/rxTemplates";

export type SaveTemplateModalProps = {
  open: boolean;
  onClose: () => void;
  currentPrescription: PrescriptionLine[];
  onSaved: (templateName: string) => void;
};

export default function SaveTemplateModal({
  open,
  onClose,
  currentPrescription,
  onSaved,
}: SaveTemplateModalProps) {
  const baseId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const result = await saveRxTemplateBundle(name, currentPrescription);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(name.trim());
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${baseId}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${baseId}-title`} className="text-lg font-bold text-gray-900">
          Save as template
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Saves {currentPrescription.length} medication{currentPrescription.length !== 1 ? "s" : ""} as a reusable bundle.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <div>
            <label htmlFor={`${baseId}-name`} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Template name
            </label>
            <input
              id={`${baseId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. URTI bundle, Post-op analgesia"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              autoFocus
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || currentPrescription.length === 0}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save template"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
