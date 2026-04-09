"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../supabase";

type InventoryOption = {
  id: string;
  brand_name: string | null;
  generic_name: string | null;
};

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

const labelCls = "mb-1 block text-xs font-medium text-slate-600";

type Props = {
  hospitalId: string | null;
  onRestocked: () => void;
};

export function PharmacyRestockForm({ hospitalId, onRestocked }: Props) {
  const [options, setOptions] = useState<InventoryOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [inventoryId, setInventoryId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) {
      setOptions([]);
      setOptionsError(null);
      return;
    }

    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);

    void (async () => {
      const { data, error } = await supabase
        .from("hospital_inventory")
        .select("id, brand_name, generic_name")
        .eq("hospital_id", hospitalId)
        .order("brand_name", { ascending: true, nullsFirst: false })
        .limit(2000);

      if (cancelled) return;
      setOptionsLoading(false);
      if (error) {
        setOptionsError(error.message);
        setOptions([]);
        return;
      }
      setOptions((data ?? []) as InventoryOption[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [hospitalId]);

  const resetFields = useCallback(() => {
    setBatchNumber("");
    setExpiryDate("");
    setQuantity("");
    setSupplierName("");
    setInvoiceNumber("");
    setUnitCost("");
    setFormError(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!hospitalId) {
      setFormError("Hospital context is missing.");
      return;
    }
    if (!inventoryId.trim()) {
      setFormError("Select a medication / SKU.");
      return;
    }

    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      setFormError("Quantity must be a positive whole number.");
      return;
    }

    let unitCostNum: number | null = null;
    if (unitCost.trim() !== "") {
      const u = parseFloat(unitCost);
      if (!Number.isFinite(u) || u < 0) {
        setFormError("Unit cost must be a non-negative number.");
        return;
      }
      unitCostNum = u;
    }

    setSubmitting(true);
    const { error } = await supabase.rpc("restock_medication", {
      p_hospital_inventory_id: inventoryId.trim(),
      p_batch_number: batchNumber.trim() || null,
      p_expiry_date: expiryDate.trim() || null,
      p_quantity: qty,
      p_supplier_name: supplierName.trim() || null,
      p_invoice_number: invoiceNumber.trim() || null,
      p_unit_cost: unitCostNum,
    });
    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    setSuccessMessage("Restock recorded and stock updated.");
    resetFields();
    onRestocked();
    window.setTimeout(() => setSuccessMessage(null), 4500);
  };

  const disabled = !hospitalId || submitting || optionsLoading;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Restock</h2>
      <p className="mt-1 text-xs text-slate-500">
        Adds quantity to <code className="rounded bg-slate-100 px-1">hospital_inventory</code> via{" "}
        <code className="rounded bg-slate-100 px-1">restock_medication()</code>.
      </p>

      {optionsError ? (
        <p className="mt-3 text-xs text-red-600" role="alert">
          {optionsError}
        </p>
      ) : null}

      {successMessage ? (
        <p
          className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3">
        {formError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {formError}
          </div>
        ) : null}

        <div>
          <label className={labelCls} htmlFor="restock-sku">
            Medication / SKU
          </label>
          <select
            id="restock-sku"
            required
            className={inputCls}
            value={inventoryId}
            onChange={(e) => setInventoryId(e.target.value)}
            disabled={disabled}
          >
            <option value="">{optionsLoading ? "Loading…" : "Choose item…"}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {(o.brand_name ?? o.generic_name ?? o.id).trim()}
                {o.generic_name && o.brand_name ? ` — ${o.generic_name}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="restock-batch">
              Batch number
            </label>
            <input
              id="restock-batch"
              type="text"
              autoComplete="off"
              className={inputCls}
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="restock-expiry">
              Expiry date
            </label>
            <input
              id="restock-expiry"
              type="date"
              className={inputCls}
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="restock-qty">
            Quantity (units to add)
          </label>
          <input
            id="restock-qty"
            type="number"
            min={1}
            step={1}
            required
            inputMode="numeric"
            className={inputCls}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="restock-supplier">
            Supplier name
          </label>
          <input
            id="restock-supplier"
            type="text"
            autoComplete="organization"
            className={inputCls}
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="restock-invoice">
              Invoice number
            </label>
            <input
              id="restock-invoice"
              type="text"
              autoComplete="off"
              className={inputCls}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="restock-cost">
              Unit cost
            </label>
            <input
              id="restock-cost"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="Optional"
              className={inputCls}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={disabled || !inventoryId}
          className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Record restock"}
        </button>
      </form>
    </section>
  );
}
