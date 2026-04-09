"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchHospitalInventoryMedicines } from "../lib/hospitalInventoryCatalog";
import {
  catalogFromRegistryRow,
  compareCatalogEntriesByInventoryStock,
  extractStrengthFromLabel,
  searchMedicationRegistry,
} from "../lib/medicationRegistry";
import type { CatalogEntry } from "../lib/medicineCatalog";
import { formatAbdmMedicationLabel } from "../lib/medicineCatalog";
import type { MedicationPrefillFields } from "../lib/medicationWorkspace";
import { buildManualCatalogEntry, isManualCatalogEntry } from "../lib/manualMedicationCatalog";
import {
  calculateTotalQuantity,
  clampPrescriptionQuantity,
  isAsNeededFrequency,
  formatTotalQuantityLabel,
} from "../lib/medicationUtils";
import type { PrescriptionLine } from "../lib/prescriptionLine";
import { newPrescriptionLineId } from "../lib/prescriptionLine";

const DOSAGE_CHIPS = ["250mg", "500mg", "1g"] as const;
const FREQUENCY_CHIPS = [
  { label: "Once daily (OD)", value: "1 tab OD" },
  { label: "Twice daily (BD)", value: "1 tab BD" },
  { label: "TDS", value: "1 tab TDS" },
  { label: "1-0-1", value: "1-0-1" },
  { label: "SOS", value: "SOS" },
] as const;
const DURATION_CHIPS = [
  { label: "3 days", value: "3 days" },
  { label: "5 days", value: "5 days" },
  { label: "1 week", value: "1 week" },
] as const;
const TIMING_OPTIONS = ["After food", "Before food"] as const;

const chipCls =
  "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50";
const chipActiveCls = "border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-200";

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export type MedicationModifierModalProps = {
  open: boolean;
  catalog: CatalogEntry | null;
  /** When editing an existing line; `null` = new add */
  existingLine: PrescriptionLine | null;
  /** Manual flow: doctor types medicine name; catalog stub until confirm */
  variant?: "catalog" | "manual";
  /** When adding (not editing), seed dosage fields — e.g. from recent history */
  prefillForNew?: MedicationPrefillFields | null;
  /** Org / hospital id for in-house formulary search (optional) */
  hospitalId?: string | null;
  /** Focus frequency field after open (e.g. after picking from formulary search) */
  focusFrequencyOnOpen?: boolean;
  onClose: () => void;
  onConfirm: (line: PrescriptionLine) => void;
};

export default function MedicationModifierModal({
  open,
  catalog,
  existingLine,
  variant = "catalog",
  prefillForNew = null,
  hospitalId = null,
  focusFrequencyOnOpen = false,
  onClose,
  onConfirm,
}: MedicationModifierModalProps) {
  const baseId = useId();
  const frequencyInputRef = useRef<HTMLInputElement>(null);
  const [medicineName, setMedicineName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");
  const [timing, setTiming] = useState("");
  const [instructions, setInstructions] = useState("");
  const [nameSugList, setNameSugList] = useState<CatalogEntry[]>([]);
  const [nameSugLoading, setNameSugLoading] = useState(false);
  const [sugOpen, setSugOpen] = useState(false);
  const [pickedCatalog, setPickedCatalog] = useState<CatalogEntry | null>(null);
  const [asNeededQty, setAsNeededQty] = useState(1);
  const nameSearchSeqRef = useRef(0);
  const sugBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || !catalog) return;
    const isManual = variant === "manual" || isManualCatalogEntry(catalog);
    if (isManual && !existingLine) {
      setMedicineName("");
      setPickedCatalog(null);
      setNameSugList([]);
      setSugOpen(false);
      setAsNeededQty(1);
    } else {
      setMedicineName((existingLine?.catalog.displayName ?? catalog.displayName ?? catalog.name).trim());
    }

    const src = existingLine;
    if (src) {
      setDosage((src.dosage ?? catalog.defaultDose ?? "").trim());
      const fq = (src.frequency ?? catalog.defaultFreq ?? "").trim();
      setFrequency(fq);
      setDuration((src.duration ?? catalog.defaultDuration ?? "").trim());
      setTiming((src.timing ?? "").trim());
      setInstructions((src.instructions ?? "").trim());
      if (isAsNeededFrequency(fq)) {
        const tq = src.total_quantity;
        setAsNeededQty(
          typeof tq === "number" && Number.isFinite(tq) && tq > 0 ? clampPrescriptionQuantity(tq) : 1,
        );
      } else {
        setAsNeededQty(1);
      }
      return;
    }

    if (prefillForNew) {
      setDosage((prefillForNew.dosage || catalog.defaultDose || "").trim());
      setFrequency((prefillForNew.frequency || catalog.defaultFreq || "").trim());
      setDuration((prefillForNew.duration || catalog.defaultDuration || "").trim());
      setTiming((prefillForNew.timing || "").trim());
      setInstructions((prefillForNew.instructions || "").trim());
      setAsNeededQty(1);
      return;
    }

    setDosage((catalog.defaultDose ?? "").trim());
    setFrequency((catalog.defaultFreq ?? "").trim());
    setDuration((catalog.defaultDuration ?? "").trim());
    setTiming("");
    setInstructions("");
    setAsNeededQty(1);
  }, [open, catalog, existingLine, variant, prefillForNew]);

  useEffect(() => {
    if (!open || !catalog || !focusFrequencyOnOpen) return;
    const isManual = variant === "manual" || isManualCatalogEntry(catalog);
    if (isManual && !existingLine) return;
    const tid = window.setTimeout(() => {
      frequencyInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(tid);
  }, [open, catalog, existingLine, variant, focusFrequencyOnOpen]);

  const displayTotalQuantity = useMemo(() => {
    if (isAsNeededFrequency(frequency)) return clampPrescriptionQuantity(asNeededQty);
    return calculateTotalQuantity(frequency, duration);
  }, [frequency, duration, asNeededQty]);

  function applyFrequency(next: string) {
    setFrequency((prev) => {
      if (isAsNeededFrequency(next) && !isAsNeededFrequency(prev)) {
        setAsNeededQty(1);
      }
      return next;
    });
  }

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

  useEffect(() => {
    if (!open || !catalog) return;
    const isManual = variant === "manual" || isManualCatalogEntry(catalog);
    if (!isManual || existingLine) {
      setNameSugList([]);
      setNameSugLoading(false);
      return;
    }

    const q = medicineName.trim();
    if (q.length < 2) {
      setNameSugList([]);
      setNameSugLoading(false);
      return;
    }

    setNameSugLoading(true);
    const seq = ++nameSearchSeqRef.current;
    const tid = window.setTimeout(() => {
      void (async () => {
        const [regRes, stockRes] = await Promise.all([
          searchMedicationRegistry(q, { limit: 22, hospitalId: hospitalId?.trim() || null }),
          hospitalId?.trim()
            ? searchHospitalInventoryMedicines(hospitalId.trim(), q, { limit: 22 })
            : Promise.resolve({ data: [] as CatalogEntry[], error: null as Error | null }),
        ]);

        if (seq !== nameSearchSeqRef.current) return;
        setNameSugLoading(false);

        const stockCats = stockRes.data ?? [];
        const regCats = (regRes.data ?? []).map((row) => catalogFromRegistryRow(row, hospitalId?.trim() || null));
        const seen = new Set(
          stockCats.map(
            (c) =>
              `${(c.brand_name ?? c.name).toLowerCase()}|${(c.generic_name ?? c.active_ingredient ?? "").toLowerCase()}`,
          ),
        );
        const merged = [
          ...stockCats,
          ...regCats.filter((c) => {
            const k = `${(c.brand_name ?? c.name).toLowerCase()}|${(c.generic_name ?? c.active_ingredient ?? "").toLowerCase()}`;
            return !seen.has(k);
          }),
        ];
        merged.sort(compareCatalogEntriesByInventoryStock);
        setNameSugList(merged.slice(0, 36));
      })();
    }, 300);

    return () => window.clearTimeout(tid);
  }, [open, catalog, variant, existingLine, medicineName, hospitalId]);

  if (!open || !catalog) return null;

  function handleMedicineNameChange(v: string) {
    setMedicineName(v);
    if (pickedCatalog) {
      const pl = formatAbdmMedicationLabel(pickedCatalog).trim();
      if (v.trim() !== pl) setPickedCatalog(null);
    }
    setSugOpen(true);
  }

  function handlePickSuggestion(entry: CatalogEntry) {
    setPickedCatalog(entry);
    setMedicineName(formatAbdmMedicationLabel(entry));
    const label = (entry.brand_name ?? entry.name).trim();
    const st = extractStrengthFromLabel(label);
    if (st) setDosage(st);
    else if ((entry.defaultDose ?? "").trim()) setDosage(entry.defaultDose.trim());
    setSugOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!catalog) return;
    const isManual = variant === "manual" || isManualCatalogEntry(catalog);
    if (isManual && !existingLine) {
      const name = medicineName.trim();
      if (!name) return;
    }
    const resolvedCatalog =
      isManual && !existingLine ? pickedCatalog ?? buildManualCatalogEntry(medicineName) : catalog;
    const line: PrescriptionLine = {
      id: existingLine?.id ?? newPrescriptionLineId(),
      catalog: resolvedCatalog,
      dosage: dosage.trim(),
      frequency: frequency.trim(),
      duration: duration.trim(),
      timing: timing.trim(),
      instructions: instructions.trim(),
      total_quantity: displayTotalQuantity,
    };
    onConfirm(line);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${baseId}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id={`${baseId}-title`} className="text-base font-bold text-gray-900">
              Dosage &amp; schedule
            </h2>
            <p className="mt-0.5 text-sm font-medium text-blue-800">
              {variant === "manual" && !existingLine
                ? "Add medication manually"
                : formatAbdmMedicationLabel(catalog)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="space-y-5 px-5 py-4">
            {(variant === "manual" || isManualCatalogEntry(catalog)) && !existingLine && (
              <div className="relative">
                <label
                  htmlFor={`${baseId}-med-name`}
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500"
                >
                  Medicine name
                </label>
                <input
                  id={`${baseId}-med-name`}
                  value={medicineName}
                  onChange={(e) => handleMedicineNameChange(e.target.value)}
                  onFocus={() => {
                    if (sugBlurTimerRef.current) {
                      clearTimeout(sugBlurTimerRef.current);
                      sugBlurTimerRef.current = null;
                    }
                    setSugOpen(true);
                  }}
                  onBlur={() => {
                    sugBlurTimerRef.current = setTimeout(() => setSugOpen(false), 200);
                  }}
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={sugOpen && (nameSugLoading || nameSugList.length > 0)}
                  aria-controls={`${baseId}-med-suggestions`}
                  placeholder="Search or type a custom name"
                  required
                  className={inputCls}
                />
                {sugOpen && (nameSugLoading || nameSugList.length > 0 || medicineName.trim().length >= 2) && (
                  <div
                    id={`${baseId}-med-suggestions`}
                    className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                    role="listbox"
                  >
                    {nameSugLoading && (
                      <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
                    )}
                    {!nameSugLoading &&
                      nameSugList.map((entry) => (
                        <button
                          key={`${entry.id}-${entry.medication_source ?? "x"}`}
                          type="button"
                          role="option"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-blue-50"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handlePickSuggestion(entry)}
                        >
                          <span className="font-medium text-gray-900">{formatAbdmMedicationLabel(entry)}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                            {entry.medication_source === "stock" ? "In-house" : "Registry"}
                            {entry.form_name && entry.form_name !== "N/A" ? ` · ${entry.form_name}` : ""}
                          </span>
                        </button>
                      ))}
                    {!nameSugLoading && medicineName.trim().length >= 2 && nameSugList.length === 0 && (
                      <p className="px-3 py-2 text-xs text-gray-500">No matches — continue typing to use a custom name.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Dosage */}
            <div>
              <label htmlFor={`${baseId}-dosage`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Dosage
              </label>
              <input
                id={`${baseId}-dosage`}
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="e.g. 500mg, 2 tabs"
                className={inputCls}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {DOSAGE_CHIPS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDosage(d)}
                    className={`${chipCls} ${dosage === d ? chipActiveCls : ""}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Frequency — text field supports 1-0-1 and free typing; chips apply presets */}
            <div>
              <label htmlFor={`${baseId}-freq`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Frequency
              </label>
              <input
                ref={frequencyInputRef}
                id={`${baseId}-freq`}
                value={frequency}
                onChange={(e) => applyFrequency(e.target.value)}
                placeholder="e.g. 1-0-1, 1 tab BD, SOS"
                autoComplete="off"
                className={inputCls}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {FREQUENCY_CHIPS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => applyFrequency(f.value)}
                    className={`${chipCls} ${frequency === f.value ? chipActiveCls : ""}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <label htmlFor={`${baseId}-dur`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Duration
              </label>
              <input
                id={`${baseId}-dur`}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="e.g. 7 days, 2 weeks"
                className={inputCls}
              />
              <input type="hidden" name={`${baseId}-total_quantity`} value={displayTotalQuantity} readOnly />
              <div className="mt-2 flex flex-wrap gap-2">
                {DURATION_CHIPS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDuration(d.value)}
                    className={`${chipCls} ${duration === d.value ? chipActiveCls : ""}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                  Total: {formatTotalQuantityLabel(displayTotalQuantity, catalog.form_name)}
                </span>
                {isAsNeededFrequency(frequency) ? (
                  <label className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600">
                    <span className="font-medium text-gray-500">Adjust qty (as needed)</span>
                    <input
                      type="number"
                      min={1}
                      max={99999}
                      value={asNeededQty}
                      onChange={(e) => {
                        const v = Number.parseInt(e.target.value, 10);
                        setAsNeededQty(Number.isFinite(v) ? clampPrescriptionQuantity(v) : 1);
                      }}
                      className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold tabular-nums outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
                    />
                  </label>
                ) : null}
              </div>
            </div>

            {/* Timing */}
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">Timing</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTiming("")}
                  className={`${chipCls} ${timing === "" ? chipActiveCls : ""}`}
                >
                  None
                </button>
                {TIMING_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTiming(t)}
                    className={`${chipCls} ${timing === t ? chipActiveCls : ""}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom instructions */}
            <div>
              <label htmlFor={`${baseId}-inst`} className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Custom instructions
              </label>
              <textarea
                id={`${baseId}-inst`}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Take with plenty of water"
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </div>
          </div>

          <div className="mt-auto flex gap-2 border-t border-gray-100 bg-gray-50/80 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                (variant === "manual" || isManualCatalogEntry(catalog)) &&
                !existingLine &&
                !medicineName.trim()
              }
              className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {existingLine ? "Update medication" : "Add to prescription"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
