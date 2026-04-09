"use client";

import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { ConsentApprovalModal } from "./ConsentApprovalModal";
import { ABDM_CONSENT_EVENT_TYPES, inboxRowMatchesPatient } from "./consentInboxUtils";

type Props = {
  patientId: string;
  className?: string;
};

/**
 * Bell + pending consent count; realtime on `abdm_webhook_inbox`. Opens consent modal on click.
 */
export function ConsentNotificationBadge({ patientId, className = "" }: Props) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const refreshCount = useCallback(async () => {
    const pid = patientId.trim();
    if (!pid) {
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("abdm_webhook_inbox")
      .select("id, payload, event_type")
      .in("event_type", [...ABDM_CONSENT_EVENT_TYPES])
      .eq("processed", false)
      .limit(200);

    setLoading(false);
    if (error) {
      console.error("ConsentNotificationBadge count:", error.message);
      setCount(0);
      return;
    }
    const n = (data ?? []).filter((r) => inboxRowMatchesPatient((r as { payload: unknown }).payload, pid)).length;
    setCount(n);
  }, [patientId]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    const pid = patientId.trim();
    if (!pid) return;

    const channel = supabase
      .channel(`abdm-consent-badge-${pid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "abdm_webhook_inbox",
        },
        () => {
          void refreshCount();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [patientId, refreshCount]);

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={loading}
        className={`relative inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 ${className}`}
        title={count > 0 ? `${count} pending consent request(s)` : "ABDM consent notifications"}
        aria-label="Open consent notifications"
      >
        <span className="relative inline-flex">
          <Bell className="h-4 w-4" strokeWidth={2} />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" aria-hidden />
          ) : null}
        </span>
        {count > 0 ? <span className="text-[12px] font-semibold tabular-nums text-red-600">{count > 99 ? "99+" : count}</span> : null}
      </button>

      <ConsentApprovalModal
        patientId={patientId}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onApproved={() => void refreshCount()}
      />
    </>
  );
}
