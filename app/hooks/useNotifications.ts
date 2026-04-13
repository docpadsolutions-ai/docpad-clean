"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { toast } from "sonner";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { practitionersOrFilterForAuthUid } from "@/app/lib/practitionerAuthLookup";

dayjs.extend(relativeTime);

export type NotificationContext = "OPD" | "IPD";

export type AppNotification = {
  id: string;
  title: string;
  body: string | null;
  priority: string;
  context: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function normalizeNotificationRow(row: Record<string, unknown>): AppNotification {
  return {
    id: s(row.id),
    title: s(row.title) || "Notification",
    body: row.body == null || s(row.body) === "" ? null : s(row.body),
    priority: s(row.priority) || "normal",
    context: s(row.context) || "IPD",
    action_url: row.action_url == null || s(row.action_url) === "" ? null : s(row.action_url),
    read_at: row.read_at == null ? null : s(row.read_at),
    created_at: s(row.created_at) || new Date().toISOString(),
  };
}

export async function fetchCurrentPractitionerId(client: SupabaseClient): Promise<string | null> {
  const { data: auth } = await client.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data } = await client.from("practitioners").select("id").or(practitionersOrFilterForAuthUid(uid)).maybeSingle();
  const id = data && typeof data === "object" && "id" in data ? s((data as { id: unknown }).id) : "";
  return id || null;
}

export function useNotifications(context: NotificationContext) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const notificationsChannelRef = useRef<RealtimeChannel | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pid = await fetchCurrentPractitionerId(supabase);
      if (!cancelled) setPractitionerId(pid);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_notifications", { p_context: context });
    setLoading(false);
    if (error) {
      console.warn("[useNotifications]", error.message);
      setItems([]);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    setItems(rows.map((r) => normalizeNotificationRow(r as Record<string, unknown>)));
  }, [context]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!practitionerId) {
      if (notificationsChannelRef.current) {
        void supabase.removeChannel(notificationsChannelRef.current);
        notificationsChannelRef.current = null;
      }
      return;
    }

    if (notificationsChannelRef.current) {
      void supabase.removeChannel(notificationsChannelRef.current);
      notificationsChannelRef.current = null;
    }

    const channel = supabase
      .channel(`notifications:${practitionerId}:${context}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${practitionerId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (s(row.context) !== contextRef.current) return;
          const n = normalizeNotificationRow(row);
          setItems((prev) => {
            if (prev.some((p) => p.id === n.id)) return prev;
            return [n, ...prev];
          });
          if (n.priority.toLowerCase() === "critical") {
            toast.error(n.title, { description: n.body ?? undefined });
          }
        },
      )
      .subscribe();

    notificationsChannelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      notificationsChannelRef.current = null;
    };
  }, [practitionerId, context]);

  const markRead = useCallback(
    async (id?: string) => {
      const { error } = await supabase.rpc("mark_notifications_read", {
        p_notification_id: id ?? null,
        p_context: id ? null : context,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      await load();
    },
    [context, load],
  );

  return { items, loading, markRead, refresh: load };
}

export type NotificationCounts = { OPD: number; IPD: number; total: number };

export function useNotificationCounts(): NotificationCounts & { refetch: () => Promise<void> } {
  const [counts, setCounts] = useState<NotificationCounts>({ OPD: 0, IPD: 0, total: 0 });
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const refetchRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pid = await fetchCurrentPractitionerId(supabase);
      if (!cancelled) setPractitionerId(pid);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_notification_counts");
    if (error) {
      console.warn("[useNotificationCounts]", error.message);
      setCounts({ OPD: 0, IPD: 0, total: 0 });
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const r = row as Record<string, unknown> | null | undefined;
    if (!r) {
      setCounts({ OPD: 0, IPD: 0, total: 0 });
      return;
    }
    const n = (k: string) => {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") return Number.parseInt(v, 10) || 0;
      return 0;
    };
    setCounts({
      OPD: n("opd"),
      IPD: n("ipd"),
      total: n("total"),
    });
  }, []);

  refetchRef.current = refetch;

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;

    const bump = () => {
      void refetchRef.current();
    };

    if (practitionerId) {
      const instanceId =
        typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      channel = supabase
        .channel(`notification-counts:${practitionerId}:${instanceId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${practitionerId}`,
          },
          bump,
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${practitionerId}`,
          },
          bump,
        )
        .subscribe();
    }

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [practitionerId]);

  return useMemo(
    () => ({ OPD: counts.OPD, IPD: counts.IPD, total: counts.total, refetch }),
    [counts, refetch],
  );
}

export function formatNotificationRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = dayjs(iso);
  if (!d.isValid()) return "—";
  return d.fromNow();
}
