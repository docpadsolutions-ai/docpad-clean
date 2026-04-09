"use client";

import { useState } from "react";
import { supabase } from "../supabase";

export default function AddProblemListModal({
  open,
  onClose,
  patientId,
  orgId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  patientId: string;
  orgId: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [snomed, setSnomed] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  async function submit() {
    const condition = name.trim();
    if (!condition) {
      setErr("Enter a condition name.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("active_problems").upsert(
      {
        patient_id: patientId,
        org_id: orgId,
        condition_name: condition,
        snomed_code: snomed.trim() || null,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "patient_id,condition_name" },
    );
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setName("");
    setSnomed("");
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-bold text-gray-900">Add to problem list</h2>
        <p className="mt-1 text-sm text-gray-500">Creates or updates an active problem for this patient.</p>
        {err && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {err}
          </p>
        )}
        <label className="mt-4 block">
          <span className="text-xs font-semibold text-gray-700">Condition name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="e.g. Type 2 diabetes mellitus"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-gray-700">SNOMED code (optional)</span>
          <input
            value={snomed}
            onChange={(e) => setSnomed(e.target.value.replace(/\D/g, "").slice(0, 18))}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="Concept ID"
            inputMode="numeric"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
