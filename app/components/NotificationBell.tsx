"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Stethoscope } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatNotificationRelativeTime, useNotificationCounts } from "@/app/hooks/useNotifications";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function notifId(row: Record<string, unknown>): string {
  return s(row.id ?? row.notification_id);
}

function notifType(row: Record<string, unknown>): string {
  return s(row.type ?? row.notification_type ?? "").toLowerCase();
}

function isUnread(row: Record<string, unknown>): boolean {
  if (row.is_read === true) return false;
  if (row.read_at != null && s(row.read_at)) return false;
  return true;
}

export function NotificationBell() {
  const router = useRouter();
  const { total, refetch: refetchCounts } = useNotificationCounts();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [opdRes, ipdRes] = await Promise.all([
      supabase.rpc("get_notifications", { p_context: "OPD" }),
      supabase.rpc("get_notifications", { p_context: "IPD" }),
    ]);
    setLoading(false);
    const err = opdRes.error ?? ipdRes.error;
    if (err) {
      console.warn("[NotificationBell]", err.message);
      setItems([]);
      return;
    }
    const a = Array.isArray(opdRes.data) ? opdRes.data : [];
    const b = Array.isArray(ipdRes.data) ? ipdRes.data : [];
    const merged = [...a, ...b] as Record<string, unknown>[];
    merged.sort((x, y) => {
      const tx = Date.parse(s(x.created_at));
      const ty = Date.parse(s(y.created_at));
      return (Number.isNaN(ty) ? 0 : ty) - (Number.isNaN(tx) ? 0 : tx);
    });
    setItems(merged.slice(0, 20));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const handleClickRow = async (row: Record<string, unknown>) => {
    const id = notifId(row);
    const url = s(row.action_url);
    if (id) {
      const { error } = await supabase.rpc("mark_notifications_read", {
        p_notification_id: id,
        p_context: null,
      });
      if (error) console.warn("[NotificationBell] mark read", error.message);
    }
    setOpen(false);
    void load();
    void refetchCounts();
    if (url) {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        window.location.href = url;
      } else {
        const path = url.startsWith("/") ? url : `/${url}`;
        router.push(path);
      }
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {total > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[200] w-[min(100vw-2rem,380px)] rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-700">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notifications</p>
          </div>
          <div className="max-h-[min(70vh,420px)] overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-500">No notifications</p>
            ) : (
              items.map((row) => {
                const id = notifId(row);
                const ty = notifType(row);
                const title = s(row.title) || "Notification";
                const body = s(row.body ?? row.message);
                const t = s(row.created_at ?? row.sent_at);
                const icon =
                  ty.includes("consult_request") || ty.includes("consult request") ? (
                    <Stethoscope className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                  ) : ty.includes("consult_response") ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Bell className="h-4 w-4 shrink-0 text-slate-400" />
                  );
                return (
                  <button
                    key={id || title + t}
                    type="button"
                    onClick={() => void handleClickRow(row)}
                    className={cn(
                      "flex w-full gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-xs transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/80",
                      isUnread(row) && "bg-sky-50/80 dark:bg-sky-950/30",
                    )}
                  >
                    <span className="mt-0.5">{icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900 dark:text-white">{title}</span>
                      {body ? (
                        <span className="mt-0.5 line-clamp-2 block text-slate-600 dark:text-slate-400">{body}</span>
                      ) : null}
                      <span className="mt-1 block text-[10px] text-slate-400">{formatNotificationRelativeTime(t)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
