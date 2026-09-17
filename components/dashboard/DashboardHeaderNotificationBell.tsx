"use client";

import { Bell } from "lucide-react";

export function DashboardHeaderNotificationBell({ total }: { total: number }) {

  return (
    <button
      type="button"
      onClick={() => {
        document.getElementById("dashboard-notifications-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100"
      aria-label={`Notifications${total > 0 ? `, ${total} unread` : ""}`}
    >
      <Bell className="h-5 w-5" strokeWidth={1.75} />
      {total > 0 ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {total > 99 ? "99+" : total}
        </span>
      ) : null}
    </button>
  );
}
