"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  defaultDosageFormSelection,
  fetchSnomedDosageForms,
  SNOMED_DOSAGE_FORMS_FALLBACK,
  TABLET_DOSAGE_FORM_SNOMED,
  type SnomedDosageFormRow,
} from "../lib/snomedDosageForms";

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100";

const selectCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:cursor-wait disabled:opacity-60";

export type ClinicalProposalPayload = {
  brandName: string;
  genericName: string;
  /** SNOMED concept id (e.g. 385055001 Tablet). */
  dosageFormCode: string;
  /** Human-readable display from ValueSet. */
  dosageFormName: string;
};

export type ClinicalProposalModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: ClinicalProposalPayload) => void | Promise<void>;
  submitting?: boolean;
  errorMessage?: string | null;
};

export default function ClinicalProposalModal({
  open,
  onClose,
  onSubmit,
  submitting = false,
  errorMessage = null,
}: ClinicalProposalModalProps) {
  const baseId = useId();
  const [brandName, setBrandName] = useState("");
  const [genericName, setGenericName] = useState("");
  const [dosageForms, setDosageForms] = useState<SnomedDosageFormRow[]>(SNOMED_DOSAGE_FORMS_FALLBACK);
  const [selectedFormCode, setSelectedFormCode] = useState(TABLET_DOSAGE_FORM_SNOMED);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsFetchError, setFormsFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBrandName("");
    setGenericName("");
    setFormsFetchError(null);
    let cancelled = false;
    (async () => {
      setFormsLoading(true);
      const { data, error } = await fetchSnomedDosageForms();
      if (cancelled) return;
      setFormsLoading(false);
      if (error) {
        setFormsFetchError(error.message);
        setDosageForms(SNOMED_DOSAGE_FORMS_FALLBACK);
        setSelectedFormCode(TABLET_DOSAGE_FORM_SNOMED);
        return;
      }
      const list = data.length > 0 ? data : SNOMED_DOSAGE_FORMS_FALLBACK;
      setDosageForms(list);
      const def = defaultDosageFormSelection(list);
      setSelectedFormCode(def.code);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedForm = useMemo(() => {
    const found = dosageForms.find((f) => f.code === selectedFormCode);
    return found ?? defaultDosageFormSelection(dosageForms);
  }, [dosageForms, selectedFormCode]);

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

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const b = brandName.trim();
    const g = genericName.trim();
    if (!b || !g) return;
    await onSubmit({
      brandName: b,
      genericName: g,
      dosageFormCode: selectedForm.code,
      dosageFormName: selectedForm.name,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${baseId}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 to-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">FHIR · ABDM</p>
              <h2 id={`${baseId}-title`} className="mt-0.5 text-base font-bold text-gray-900">
                Clinical medication proposal
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                Not in the national registry search? Propose a drug for pharmacy verification. It will be added to this
                Rx and queued with <span className="font-semibold text-violet-800">pending</span> status.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-violet-50 hover:text-gray-600"
              aria-label="Close"
            >
              <span className="text-xl leading-none">×</span>
            </button>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="space-y-4 px-5 py-4">
            {errorMessage ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                {errorMessage}
              </p>
            ) : null}

            {formsFetchError ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Could not load SNOMED dosage forms: {formsFetchError}. Using Tablet (385055001) as fallback — check{" "}
                <code className="rounded bg-white/80 px-1">snomed_dosage_forms</code> and RLS.
              </p>
            ) : null}

            <div>
              <label htmlFor={`${baseId}-brand`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Brand name
              </label>
              <input
                id={`${baseId}-brand`}
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g. Calpol"
                required
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor={`${baseId}-generic`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Generic name (salt)
              </label>
              <input
                id={`${baseId}-generic`}
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="e.g. Paracetamol"
                required
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor={`${baseId}-form`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Dosage form (SNOMED ValueSet)
              </label>
              <select
                id={`${baseId}-form`}
                value={selectedFormCode}
                onChange={(e) => setSelectedFormCode(e.target.value)}
                disabled={formsLoading || submitting}
                className={selectCls}
                aria-busy={formsLoading}
              >
                {dosageForms.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </select>
              {formsLoading ? (
                <p className="mt-1 text-[11px] text-gray-500">Loading dosage forms…</p>
              ) : (
                <p className="mt-1 text-[11px] text-gray-500">
                  Default: Tablet <span className="font-mono text-gray-600">385055001</span> — interoperable with ABDM
                  MedicationRequest.
                </p>
              )}
            </div>
          </div>

          <div className="mt-auto flex gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !brandName.trim() || !genericName.trim() || formsLoading}
              className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Add to Rx & submit proposal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
