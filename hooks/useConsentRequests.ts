"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/supabase";
import { ABDM_CONSENT_EVENT_TYPES, isAbdmConsentEventType } from "@/components/abdm/consentInboxUtils";

export type ConsentRequestItem = {
  inboxId: string;
  receivedAt: string;
  consentRequestId: string | null;
  status: string | null;
  title: string;
  rawPayload: unknown;
};

function parseConsentItem(row: { id: string; created_at: string; payload: unknown }): ConsentRequestItem {
  const payload = row.payload as Record<string, unknown> | null;
  const notif =
    (payload?.notification as Record<string, unknown> | undefined) ??
    (payload?.Notification as Record<string, unknown> | undefined);

  const cr =
    (notif?.consentRequest as Record<string, unknown> | undefined) ??
    (notif?.consent_request as Record<string, unknown> | undefined);

  const consentRequestId = cr?.id != null ? String(cr.id) : null;
  const status = notif?.status != null ? String(notif.status) : null;

  let title = "Consent request";
  const purpose = cr?.purpose;
  if (purpose && typeof purpose === "object") {
    const t = (purpose as { text?: string }).text;
    if (t?.trim()) title = t.trim();
  } else if (consentRequestId) {
    title = `Request ${consentRequestId.slice(0, 8)}…`;
  }

  return {
    inboxId: row.id,
    receivedAt: row.created_at,
    consentRequestId,
    status,
    title,
    rawPayload: row.payload,
  };
}

const TERMINAL = new Set(["GRANTED", "DENIED", "REVOKED", "EXPIRED", "REJECTED"]);

function isPendingItem(item: ConsentRequestItem): boolean {
  if (!item.status) return true;
  return !TERMINAL.has(item.status.toUpperCase());
}

/**
 * Loads `abdm_webhook_inbox` rows from `consent-request-notify` and subscribes to Realtime INSERTs.
 */
export function useConsentRequests(enabled = true) {
  const [items, setItems] = useState<ConsentRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("abdm_webhook_inbox")
      .select("id, created_at, payload, event_type")
      .in("event_type", [...ABDM_CONSENT_EVENT_TYPES])
      .order("created_at", { ascending: false })
      .limit(80);

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setItems(
      (data ?? []).map((r) =>
        parseConsentItem(r as { id: string; created_at: string; payload: unknown }),
      ),
    );
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel("abdm-consent-inbox-ui")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "abdm_webhook_inbox",
        },
        (payload) => {
          const row = payload.new as { id: string; created_at: string; payload: unknown; event_type?: string };
          if (!row?.id) return;
          if (!isAbdmConsentEventType(row.event_type)) return;
          setItems((prev) => {
            const next = parseConsentItem(row);
            if (prev.some((p) => p.inboxId === next.inboxId)) return prev;
            return [next, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  const pendingItems = useMemo(() => items.filter(isPendingItem), [items]);
  const pendingCount = pendingItems.length;

  return {
    items,
    pendingItems,
    pendingCount,
    loading,
    error,
    refresh,
  };
}
