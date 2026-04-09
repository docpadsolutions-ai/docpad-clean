"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";

type PatientEmbed = {
  id: string;
  full_name: string | null;
  docpad_id: string | null;
};

type InventoryEmbed = {
  id: string;
  brand_name: string | null;
  generic_name: string | null;
  stock_quantity: number | null;
  dosage_form_name: string | null;
};

export type OrderedPrescriptionRow = {
  id: string;
  encounter_id?: string | null;
  medicine_name: string | null;
  total_quantity: number | null;
  status: string | null;
  dosage_text: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  created_at: string | null;
  patient_id: string | null;
  patients: PatientEmbed | PatientEmbed[] | null;
  hospital_inventory: InventoryEmbed | InventoryEmbed[] | null;
};

type QueueGroup = {
  key: string;
  patient: PatientEmbed | null;
  lines: OrderedPrescriptionRow[];
  latestAt: string | null;
};

function patientFromEmbed(embed: OrderedPrescriptionRow["patients"]): PatientEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

function inventoryFromEmbed(
  embed: OrderedPrescriptionRow["hospital_inventory"],
): InventoryEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

export function parseQty(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function countQueueGroups(rows: OrderedPrescriptionRow[]): number {
  return groupQueueRows(rows).length;
}

/** Client-side filter: patient name, DocPad ID, or drug name. */
export function filterPrescriptionQueueRows(
  rows: OrderedPrescriptionRow[],
  query: string,
): OrderedPrescriptionRow[] {
  const s = query.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => {
    const pt = patientFromEmbed(r.patients);
    const name = (pt?.full_name ?? "").toLowerCase();
    const doc = (pt?.docpad_id ?? "").toLowerCase();
    const med = (r.medicine_name ?? "").toLowerCase();
    return name.includes(s) || doc.includes(s) || med.includes(s);
  });
}

function groupQueueRows(rows: OrderedPrescriptionRow[]): QueueGroup[] {
  const byKey = new Map<string, OrderedPrescriptionRow[]>();
  for (const r of rows) {
    const enc = r.encounter_id;
    const key =
      enc != null && String(enc).trim() !== "" ? `enc:${enc}` : `rx:${r.id}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }

  const groups: QueueGroup[] = [];
  for (const [key, lines] of byKey) {
    const sorted = [...lines].sort((a, b) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
    );
    const patient = patientFromEmbed(sorted[0].patients);
    const times = sorted.map((l) => l.created_at).filter(Boolean) as string[];
    const latestAt = times.length ? [...times].sort().reverse()[0]! : null;
    groups.push({ key, patient, lines: sorted, latestAt });
  }

  groups.sort((a, b) => String(b.latestAt ?? "").localeCompare(String(a.latestAt ?? "")));
  return groups;
}

type LineDraft = { dispensed: string; notes: string };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export type ReceiptPreviewDispensePayload = {
  prescriptionId: string;
  dispensedQuantity: number;
  notes: string | null;
  pharmacistId: string;
};

type Props = {
  rows: OrderedPrescriptionRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /** Current hospital (auth org); used to resolve practitioners.id for dispense. */
  hospitalId: string | null;
  /** Generate receipt preview in modal; user confirms dispense there. */
  openReceiptPreviewForDispense: (pending: ReceiptPreviewDispensePayload) => Promise<void>;
  /** True when parent search is non-empty but yielded no rows */
  searchEmpty?: boolean;
  unfilteredLineCount?: number;
};

export function PrescriptionQueue({
  rows,
  loading,
  error,
  onRefresh,
  hospitalId,
  openReceiptPreviewForDispense,
  searchEmpty = false,
  unfilteredLineCount = 0,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const groups = useMemo(() => groupQueueRows(rows), [rows]);

  const groupKeys = useMemo(() => new Set(groups.map((g) => g.key)), [groups]);
  useEffect(() => {
    if (expandedKey && !groupKeys.has(expandedKey)) setExpandedKey(null);
  }, [expandedKey, groupKeys]);

  const ensureDraftsForGroup = useCallback((g: QueueGroup) => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const line of g.lines) {
        if (next[line.id] != null) continue;
        const tq = Math.max(1, parseQty(line.total_quantity));
        next[line.id] = { dispensed: String(tq), notes: "" };
      }
      return next;
    });
  }, []);

  const toggleGroup = (g: QueueGroup) => {
    setActionError(null);
    if (expandedKey === g.key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(g.key);
    ensureDraftsForGroup(g);
  };

  const updateDraft = (lineId: string, patch: Partial<LineDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { dispensed: prev[lineId]?.dispensed ?? "1", notes: prev[lineId]?.notes ?? "", ...patch },
    }));
  };

  const handlePrintReceiptPreview = async (line: OrderedPrescriptionRow) => {
    const total = Math.max(1, parseQty(line.total_quantity));
    const draft = drafts[line.id] ?? { dispensed: String(total), notes: "" };
    const dispensed = parseInt(draft.dispensed, 10);
    if (!Number.isFinite(dispensed) || dispensed < 1 || dispensed > total) {
      setActionError(`Dispensed quantity must be between 1 and ${total}.`);
      return;
    }
    if (dispensed < total && !draft.notes.trim()) {
      setActionError("Enter a reason when dispensing fewer units than prescribed.");
      return;
    }

    setBusyLineId(line.id);
    setActionError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusyLineId(null);
      setActionError("You must be signed in to dispense.");
      return;
    }

    if (!hospitalId?.trim()) {
      setBusyLineId(null);
      setActionError("No hospital context — cannot dispense.");
      return;
    }

    const { data: practitioner, error: prErr } = await supabase
      .from("practitioners")
      .select("id")
      .eq("user_id", user.id)
      .eq("hospital_id", hospitalId.trim())
      .maybeSingle();

    if (prErr) {
      setBusyLineId(null);
      setActionError(prErr.message);
      return;
    }
    const pharmacistId = practitioner?.id != null ? String(practitioner.id).trim() : "";
    if (!pharmacistId) {
      setBusyLineId(null);
      setActionError("No practitioner profile found for your user in this hospital.");
      return;
    }

    const notes = draft.notes.trim() || null;
    try {
      await openReceiptPreviewForDispense({
        prescriptionId: line.id,
        dispensedQuantity: dispensed,
        notes,
        pharmacistId,
      });
    } finally {
      setBusyLineId(null);
    }
  };

  const handleRemoveFromQueue = async (line: OrderedPrescriptionRow) => {
    setBusyLineId(line.id);
    setActionError(null);
    const { error: upErr } = await supabase
      .from("prescriptions")
      .update({ status: "cancelled" })
      .eq("id", line.id)
      .eq("status", "ordered");

    setBusyLineId(null);
    if (upErr) {
      setActionError(upErr.message);
      return;
    }
    if (expandedKey?.startsWith("rx:") && expandedKey === `rx:${line.id}`) {
      setExpandedKey(null);
    }
    onRefresh();
  };

  if (loading && rows.length === 0 && !error) {
    return <p className="text-sm text-slate-500">Loading prescription queue…</p>;
  }

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center">
        <p className="text-sm font-medium text-slate-800">
          {searchEmpty ? "No prescriptions match your search" : "No ordered prescriptions"}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {searchEmpty ? (
            <>
              Try another patient or drug name
              {unfilteredLineCount > 0 ? (
                <span className="block pt-1 text-slate-400">
                  ({unfilteredLineCount} line{unfilteredLineCount === 1 ? "" : "s"} hidden by filter)
                </span>
              ) : null}
            </>
          ) : (
            <>
              Rows with <code className="rounded bg-white px-1">status = ordered</code> appear here.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {actionError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <div className="max-h-[min(70vh,720px)] space-y-2 overflow-y-auto pr-1">
        {groups.map((g) => {
          const open = expandedKey === g.key;
          const pt = g.patient;
          const count = g.lines.length;
          const timeLabel = g.latestAt
            ? new Date(g.latestAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "—";

          return (
            <div
              key={g.key}
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${
                open ? "border-emerald-300 ring-1 ring-emerald-200" : "border-slate-200"
              }`}
            >
              <button
                type="button"
                onClick={() => toggleGroup(g)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
              >
                <span
                  className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-slate-500 ${
                    open ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50"
                  }`}
                  aria-hidden
                >
                  <svg
                    className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{(pt?.full_name ?? "Unknown patient").trim() || "—"}</p>
                  {pt?.docpad_id ? <p className="text-xs text-slate-500">{pt.docpad_id}</p> : null}
                  <p className="mt-1 text-xs text-slate-600">
                    <span className="text-slate-500">Ordered</span> {timeLabel}
                    <span className="mx-2 text-slate-300">·</span>
                    <span className="font-medium text-slate-800">
                      {count} {count === 1 ? "drug" : "drugs"}
                    </span>
                  </p>
                </div>
              </button>

              {open ? (
                <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-4 space-y-4">
                  {g.lines.map((line) => {
                    const inv = inventoryFromEmbed(line.hospital_inventory);
                    const total = Math.max(1, parseQty(line.total_quantity));
                    const draft = drafts[line.id] ?? { dispensed: String(total), notes: "" };
                    const dispensedNum = parseInt(draft.dispensed, 10);
                    const showReason =
                      Number.isFinite(dispensedNum) && dispensedNum >= 1 && dispensedNum < total;
                    const sig = [line.dosage_text, line.frequency, line.duration].filter(Boolean).join(" · ");
                    const busy = busyLineId === line.id;

                    return (
                      <div
                        key={line.id}
                        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="grid gap-1 text-sm text-slate-800">
                          <p className="text-base font-semibold text-slate-900">
                            {(line.medicine_name ?? "—").trim()}
                          </p>
                          {sig ? <p className="text-slate-600">{sig}</p> : null}
                          {line.instructions?.trim() ? (
                            <p className="text-xs text-slate-500">{line.instructions.trim()}</p>
                          ) : null}
                          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                            <div>
                              <dt className="text-slate-400">Prescribed qty</dt>
                              <dd className="font-medium tabular-nums text-slate-900">{total}</dd>
                            </div>
                            {inv ? (
                              <div className="col-span-2 sm:col-span-2">
                                <dt className="text-slate-400">Formulary</dt>
                                <dd className="text-slate-700">
                                  {(inv.brand_name ?? inv.generic_name ?? "—").trim()}
                                  {inv.dosage_form_name ? ` · ${inv.dosage_form_name}` : ""}
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                        </div>

                        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`dq-${line.id}`}>
                              Dispensed quantity (max {total})
                            </label>
                            <input
                              id={`dq-${line.id}`}
                              type="number"
                              min={1}
                              max={total}
                              inputMode="numeric"
                              className={inputCls}
                              value={draft.dispensed}
                              onChange={(e) => updateDraft(line.id, { dispensed: e.target.value })}
                              disabled={busy}
                            />
                          </div>
                          {showReason ? (
                            <div>
                              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`note-${line.id}`}>
                                Reason for partial dispense
                              </label>
                              <textarea
                                id={`note-${line.id}`}
                                rows={2}
                                className={`${inputCls} resize-y`}
                                placeholder="Required when quantity is less than prescribed"
                                value={draft.notes}
                                onChange={(e) => updateDraft(line.id, { notes: e.target.value })}
                                disabled={busy}
                              />
                            </div>
                          ) : null}

                          <div className="flex flex-wrap gap-2 pt-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handlePrintReceiptPreview(line)}
                              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {busy ? "Loading…" : "Print receipt"}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRemoveFromQueue(line)}
                              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Remove from queue
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Print receipt opens a preview; use <span className="font-medium">Confirm &amp; Close</span>{" "}
                            there to record the dispense. Inventory is not adjusted on this action (Phase 4).
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
