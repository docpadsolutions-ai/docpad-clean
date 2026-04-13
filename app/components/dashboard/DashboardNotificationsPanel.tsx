"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatNotificationRelativeTime,
  useNotifications,
  type AppNotification,
} from "@/app/hooks/useNotifications";

function cardClassForPriority(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "critical") {
    return "border-l-4 border-l-red-500 border border-rose-100 bg-rose-50/80 text-rose-900";
  }
  if (p === "high") {
    return "border-l-4 border-l-amber-500 border border-amber-100 bg-amber-50/80 text-amber-950";
  }
  return "border-l-4 border-l-gray-300 border border-gray-200 bg-white text-slate-900";
}

function subtextClassForPriority(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "critical") return "text-xs text-rose-800/80";
  if (p === "high") return "text-xs text-amber-900/80";
  return "text-xs text-slate-500";
}

export function DashboardNotificationsPanel({
  counts,
  onInvalidate,
}: {
  counts: { OPD: number; IPD: number };
  /** Optional: refetch global counts (e.g. `notificationCounts.refetch`) for instant badge updates. */
  onInvalidate?: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"OPD" | "IPD">("OPD");
  const opd = useNotifications("OPD");
  const ipd = useNotifications("IPD");

  const active = tab === "OPD" ? opd : ipd;

  const onCardClick = async (n: AppNotification) => {
    await active.markRead(n.id);
    onInvalidate?.();
    const url = n.action_url?.trim();
    if (url) {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        window.location.href = url;
      } else {
        router.push(url.startsWith("/") ? url : `/${url}`);
      }
    }
  };

  const onMarkAllRead = () => {
    void (async () => {
      await active.markRead();
      onInvalidate?.();
    })();
  };

  return (
    <div
      id="dashboard-notifications-panel"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 text-slate-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        <h3 className="text-base font-bold text-slate-900">Notifications</h3>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab("OPD")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            tab === "OPD" ? "bg-sky-50 text-sky-900 ring-1 ring-sky-200" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
          )}
        >
          OPD
          {counts.OPD > 0 ? (
            <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{counts.OPD}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setTab("IPD")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            tab === "IPD" ? "bg-sky-50 text-sky-900 ring-1 ring-sky-200" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
          )}
        >
          IPD
          {counts.IPD > 0 ? (
            <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{counts.IPD}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => void onMarkAllRead()}
          className="ml-auto text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          Mark all read
        </button>
      </div>

      <ul className="mt-4 space-y-3">
        {active.loading && active.items.length === 0 ? (
          <li className="text-sm text-slate-500">Loading…</li>
        ) : active.items.length === 0 ? (
          <li className="text-sm text-slate-500">No notifications</li>
        ) : (
          active.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void onCardClick(n)}
                className={cn("w-full rounded-lg px-3 py-2.5 text-left text-sm transition hover:opacity-95", cardClassForPriority(n.priority))}
              >
                <p className="font-medium">{n.title}</p>
                {n.body ? <p className={cn("mt-0.5 line-clamp-3", subtextClassForPriority(n.priority))}>{n.body}</p> : null}
                <p className={cn("mt-1", subtextClassForPriority(n.priority))}>
                  {formatNotificationRelativeTime(n.created_at)}
                  {n.read_at ? " · Read" : ""}
                </p>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
