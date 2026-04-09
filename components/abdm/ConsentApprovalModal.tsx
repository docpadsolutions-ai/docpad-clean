"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import {
  ABDM_CONSENT_EVENT_TYPES,
  extractConsentRequestId,
  extractHiTypes,
  extractHiuDisplay,
  extractPurpose,
  extractValidityIst,
  inboxRowMatchesPatient,
} from "./consentInboxUtils";

export type ConsentInboxRow = {
  id: string;
  event_type: string;
  payload: unknown;
  processed: boolean | null;
  created_at: string;
};

type Props = {
  patientId: string;
  isOpen: boolean;
  onClose: () => void;
  onApproved?: () => void;
};

const HI_BADGE_CLASS =
  "rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-900";

/**
 * Pending consent requests for a patient — HIU name (policy §4.2), validity in IST, approve / deny.
 */
export function ConsentApprovalModal({ patientId, isOpen, onClose, onApproved }: Props) {
  const [rows, setRows] = useState<ConsentInboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const pid = patientId.trim();
    if (!pid) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("abdm_webhook_inbox")
      .select("id, event_type, payload, processed, created_at")
      .in("event_type", [...ABDM_CONSENT_EVENT_TYPES])
      .eq("processed", false)
      .order("created_at", { ascending: false })
      .limit(80);

    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const list = (data ?? []) as ConsentInboxRow[];
    setRows(list.filter((r) => inboxRowMatchesPatient(r.payload, pid)));
  }, [patientId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleApprove = useCallback(
    async (row: ConsentInboxRow) => {
      const consentRequestId = extractConsentRequestId(row.payload)?.trim();
      if (!consentRequestId) {
        toast.error("Missing consent request id in payload.");
        return;
      }
      setBusyId(row.id);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("consent-approve", {
          body: { consentRequestId, status: "GRANTED" },
        });
        if (fnErr) throw new Error(fnErr.message);
        const body = data as { ok?: boolean; error?: string };
        if (body?.ok === false) throw new Error(body.error ?? "Approve failed");
        const { error: upErr } = await supabase.from("abdm_webhook_inbox").update({ processed: true }).eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
        toast.success("Consent approved.");
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        onApproved?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Approve failed");
      } finally {
        setBusyId(null);
      }
    },
    [onApproved],
  );

  const handleDeny = useCallback(
    async (row: ConsentInboxRow) => {
      setBusyId(row.id);
      try {
        const { error: upErr } = await supabase.from("abdm_webhook_inbox").update({ processed: true }).eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
        toast.success("Marked as processed (denied).");
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        onApproved?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      } finally {
        setBusyId(null);
      }
    },
    [onApproved],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="abdm-consent-modal-title"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 id="abdm-consent-modal-title" className="text-base font-bold text-gray-900">
            Consent requests
          </h2>
          <p className="mt-1 text-[11px] leading-snug text-gray-500">
            HIU identity is shown per ABDM Health Data Management Policy (section 4.2). Validity uses IST (Asia/Kolkata).
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-gray-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">No pending consent requests for this patient.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => {
                const hiTypes = extractHiTypes(row.payload);
                const purpose = extractPurpose(row.payload);
                const hiu = extractHiuDisplay(row.payload);
                const validity = extractValidityIst(row.payload);
                const createdIst = new Date(row.created_at).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  dateStyle: "medium",
                  timeStyle: "short",
                });
                return (
                  <li key={row.id} className="rounded-xl border border-gray-100 bg-slate-50/90 p-3 text-sm shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Health Information User</p>
                    <p className="mt-0.5 font-medium text-gray-900">{hiu ?? "—"}</p>
                    {purpose ? <p className="mt-2 text-gray-800">{purpose}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {hiTypes.length === 0 ? (
                        <span className={HI_BADGE_CLASS}>HI types —</span>
                      ) : (
                        hiTypes.map((t) => (
                          <span key={t} className={HI_BADGE_CLASS}>
                            {t}
                          </span>
                        ))
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-600">
                      Validity (IST):{" "}
                      <span className="font-medium">
                        {validity.from ?? "—"} → {validity.to ?? "—"}
                      </span>
                    </p>
                    <p className="mt-1 text-[10px] text-gray-400">Received (IST): {createdIst}</p>
                    {detailsId === row.id ? (
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-gray-200 bg-white p-2 text-[10px] leading-relaxed text-gray-800">
                        {JSON.stringify(row.payload, null, 2)}
                      </pre>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void handleApprove(row)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busyId === row.id ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void handleDeny(row)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Deny
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => setDetailsId((id) => (id === row.id ? null : row.id))}
                        className="rounded-lg border border-gray-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {detailsId === row.id ? "Hide details" : "View details"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
