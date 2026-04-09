"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../supabase";

export const DOSAGE_FORM_OPTIONS = [
  "tablet",
  "capsule",
  "syrup",
  "injection",
  "cream",
  "ointment",
  "drops",
  "inhaler",
  "powder",
  "suspension",
] as const;

export type InventoryTableRow = {
  id: string;
  brand_name: string | null;
  generic_name: string | null;
  dosage_form_name: string | null;
  strength: string | null;
  stock_quantity: number | null;
  reorder_level: number | null;
  manufacturer: string | null;
  storage_conditions?: string | null;
};

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

const labelCls = "mb-1 block text-xs font-medium text-slate-600";

type Mode = "add" | "edit";

type Props = {
  open: boolean;
  mode: Mode;
  hospitalId: string | null;
  row: InventoryTableRow | null;
  onClose: () => void;
  onSaved: () => void;
};

export function InventoryItemModal({ open, mode, hospitalId, row, onClose, onSaved }: Props) {
  const [brandName, setBrandName] = useState("");
  const [genericName, setGenericName] = useState("");
  const [dosageForm, setDosageForm] = useState("");
  const [strength, setStrength] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [reorderLevel, setReorderLevel] = useState("10");
  const [storageConditions, setStorageConditions] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && row) {
      setBrandName(row.brand_name?.trim() ?? "");
      setGenericName(row.generic_name?.trim() ?? "");
      const rawForm = (row.dosage_form_name ?? "").trim();
      const low = rawForm.toLowerCase();
      const canonical = DOSAGE_FORM_OPTIONS.find((o) => o === low);
      setDosageForm(canonical ?? rawForm);
      setStrength(row.strength?.trim() ?? "");
      setManufacturer(row.manufacturer?.trim() ?? "");
      setReorderLevel(row.reorder_level != null ? String(row.reorder_level) : "10");
      setStorageConditions(row.storage_conditions?.trim() ?? "");
    } else {
      setBrandName("");
      setGenericName("");
      setDosageForm("");
      setStrength("");
      setManufacturer("");
      setReorderLevel("10");
      setStorageConditions("");
    }
  }, [open, mode, row]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!hospitalId?.trim()) {
        setError("No hospital context.");
        return;
      }
      const brand = brandName.trim();
      const generic = genericName.trim();
      if (!brand) {
        setError("Brand name is required.");
        return;
      }
      if (!generic) {
        setError("Generic name is required.");
        return;
      }

      setSubmitting(true);
      try {
        if (mode === "add") {
          const reorder = parseInt(reorderLevel, 10);
          const { error: rpcErr } = await supabase.rpc("add_inventory_item", {
            p_hospital_id: hospitalId.trim(),
            p_brand_name: brand,
            p_generic_name: generic,
            p_dosage_form: dosageForm.trim() || null,
            p_strength: strength.trim() || null,
            p_manufacturer: manufacturer.trim() || null,
            p_reorder_level: Number.isFinite(reorder) ? reorder : 10,
            p_storage_conditions: storageConditions.trim() || null,
          });
          if (rpcErr) {
            setError(rpcErr.message);
            return;
          }
        } else {
          if (!row?.id) {
            setError("Missing item.");
            return;
          }
          const reorder = parseInt(reorderLevel, 10);
          const { error: rpcErr } = await supabase.rpc("update_inventory_item", {
            p_item_id: row.id,
            p_brand_name: brand,
            p_generic_name: generic,
            p_reorder_level: Number.isFinite(reorder) ? reorder : null,
            p_storage_conditions: storageConditions.trim() || null,
          });
          if (rpcErr) {
            setError(rpcErr.message);
            return;
          }
        }
        onSaved();
        onClose();
      } finally {
        setSubmitting(false);
      }
    },
    [
      hospitalId,
      brandName,
      genericName,
      dosageForm,
      strength,
      manufacturer,
      reorderLevel,
      storageConditions,
      mode,
      row,
      onClose,
      onSaved,
    ],
  );

  if (!open) return null;

  const editLocked = mode === "edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-modal-title"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="inventory-modal-title" className="text-lg font-bold text-slate-900">
            {mode === "add" ? "Add inventory item" : "Edit inventory item"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            Close
          </button>
        </div>
        {editLocked ? (
          <p className="mt-2 text-xs text-slate-500">
            Dosage form, strength, and manufacturer are set at creation. To change them, deactivate this item and add a
            new one.
          </p>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
          <div>
            <label className={labelCls} htmlFor="inv-brand">
              Brand name <span className="text-red-600">*</span>
            </label>
            <input
              id="inv-brand"
              className={inputCls}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-generic">
              Generic name <span className="text-red-600">*</span>
            </label>
            <input
              id="inv-generic"
              className={inputCls}
              value={genericName}
              onChange={(e) => setGenericName(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-form">
              Dosage form
            </label>
            <select
              id="inv-form"
              className={inputCls}
              value={dosageForm}
              onChange={(e) => setDosageForm(e.target.value)}
              disabled={editLocked}
            >
              <option value="">Select…</option>
              {DOSAGE_FORM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
              {editLocked && dosageForm && !DOSAGE_FORM_OPTIONS.includes(dosageForm as (typeof DOSAGE_FORM_OPTIONS)[number]) ? (
                <option value={dosageForm}>{dosageForm}</option>
              ) : null}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-strength">
              Strength
            </label>
            <input
              id="inv-strength"
              className={inputCls}
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              placeholder="e.g. 500mg"
              disabled={editLocked}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-mfr">
              Manufacturer
            </label>
            <input
              id="inv-mfr"
              className={inputCls}
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              disabled={editLocked}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-reorder">
              Reorder level
            </label>
            <input
              id="inv-reorder"
              type="number"
              min={0}
              className={inputCls}
              value={reorderLevel}
              onChange={(e) => setReorderLevel(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-storage">
              Storage conditions
            </label>
            <textarea
              id="inv-storage"
              className={`${inputCls} min-h-[72px] resize-y`}
              value={storageConditions}
              onChange={(e) => setStorageConditions(e.target.value)}
              rows={2}
              placeholder="Optional"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : mode === "add" ? "Add item" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
