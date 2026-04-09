"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { DocPadLogoMark } from "./DocPadLogoMark";
import { sidebarItemsForRole, isActiveHref } from "../lib/navConfig";
import type { AppRole } from "../lib/userRole";

const SIDEBAR_EXPANDED_KEY = "docpad-sidebar-expanded";

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function navIconForLabel(label: string): ReactNode {
  const key = label.trim().toLowerCase();
  const box = "h-5 w-5 shrink-0 stroke-[1.75]";
  if (key === "home") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (key === "opd") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M4.5 9.5h15v9a2 2 0 01-2 2h-11a2 2 0 01-2-2v-9z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 9.5V7a4 4 0 018 0v2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (key === "patients") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (key === "new visit") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
    );
  }
  if (key === "settings") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path
          d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (key === "reception") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 19h16M9 19v-4h6v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (key === "pharmacy") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M10 6h4v4h-4V6zM6 10h4v4H6v-4zM14 10h4v4h-4v-4zM10 14h4v4h-4v-4z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (key === "inventory") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (key === "admin") {
    return (
      <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={box} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SidebarNavLink({
  href,
  label,
  active,
  expanded,
}: {
  href: string;
  label: string;
  active: boolean;
  expanded: boolean;
}) {
  return (
    <div className="group/item relative">
      <Link
        href={href}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
          active
            ? "bg-blue-600 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
        } ${expanded ? "justify-start" : "justify-center px-0"}`}
      >
        <span
          className={
            active ? "text-white" : "text-slate-500 group-hover/item:text-slate-700 dark:text-slate-400 dark:group-hover/item:text-slate-200"
          }
        >
          {navIconForLabel(label)}
        </span>
        {expanded ? <span className="min-w-0 truncate">{label}</span> : null}
      </Link>
      {!expanded ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-[100] -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/item:opacity-100 group-focus-within/item:opacity-100"
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

export function RoleSidebar({
  role,
  showAdminConsoleLink = false,
}: {
  role: AppRole;
  showAdminConsoleLink?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const items = sidebarItemsForRole(role);
  const onAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const baseId = useId();

  /** Pinned open (toggle + localStorage). When false, rail is narrow until hover. */
  const [pinnedOpen, setPinnedOpen] = useState(true);
  /** True while pointer is over the sidebar and pinned open is false — temporarily shows full width. */
  const [hoverOpen, setHoverOpen] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  useLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
      /* eslint-disable react-hooks/set-state-in-effect -- one-time localStorage → pinned sidebar width */
      if (stored === "0" || stored === "false") setPinnedOpen(false);
      else if (stored === "1" || stored === "true") setPinnedOpen(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* ignore */
    }
  }, []);

  const persistPinnedOpen = useCallback((next: boolean) => {
    setPinnedOpen(next);
    if (!next) setHoverOpen(false);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const wide = pinnedOpen || hoverOpen;

  const uiTheme: "light" | "dark" =
    (resolvedTheme ?? theme) === "dark" ? "dark" : "light";

  return (
    <aside
      className={`relative z-20 hidden shrink-0 flex-col border-r border-slate-200/90 bg-white shadow-[2px_0_12px_-4px_rgba(15,23,42,0.08)] transition-[width] duration-200 ease-out dark:border-slate-800 dark:bg-[#080c17] lg:flex ${
        wide ? "w-[260px]" : "w-[72px]"
      }`}
      aria-label="Main navigation"
      onMouseEnter={() => {
        if (!pinnedOpen) setHoverOpen(true);
      }}
      onMouseLeave={() => {
        setHoverOpen(false);
      }}
    >
      <div
        className={`flex h-[4.25rem] shrink-0 items-center border-b border-slate-100 dark:border-slate-800 ${
          wide ? "gap-3 px-4" : "justify-center px-2"
        }`}
      >
        <DocPadLogoMark className={wide ? "" : "h-9 w-9"} />
        {wide ? (
          <span className="truncate text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">DocPad</span>
        ) : null}
      </div>

      <nav
        id={`${baseId}-nav`}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-visible px-3 py-3"
        aria-labelledby={`${baseId}-nav-label`}
      >
        <span id={`${baseId}-nav-label`} className="sr-only">
          Primary navigation
        </span>
        {items.map((item) => {
          const active = isActiveHref(pathname, item.href);
          return (
            <SidebarNavLink key={item.href + item.label} href={item.href} label={item.label} active={active} expanded={wide} />
          );
        })}
      </nav>

      {showAdminConsoleLink ? (
        <div className={`shrink-0 border-t border-slate-100 dark:border-slate-800 ${wide ? "px-3 pb-2 pt-3" : "px-2 py-2"}`}>
          {wide ? (
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Workspace
            </p>
          ) : null}
          <div className="group/item relative">
            <Link
              href="/admin"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                onAdminPath
                  ? "bg-slate-900 text-white shadow-sm dark:bg-blue-600"
                  : "text-blue-700 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/50 dark:hover:text-blue-100"
              } ${wide ? "justify-start" : "justify-center px-0"}`}
            >
              <span className={onAdminPath ? "text-white" : "text-blue-600 dark:text-blue-400"}>{navIconForLabel("Admin")}</span>
              {wide ? <span className="min-w-0 truncate">Go to Admin Dashboard</span> : null}
            </Link>
            {!wide ? (
              <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-[100] -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/item:opacity-100 group-focus-within/item:opacity-100">
                Admin dashboard
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={`shrink-0 border-t border-slate-100 dark:border-slate-800 ${wide ? "p-3" : "p-2"}`}>
        {wide ? (
          <div
            data-theme-toggle-root=""
            className="flex w-full items-center rounded-full border border-slate-200/90 bg-slate-100/90 p-0.5 dark:border-slate-600 dark:bg-slate-900/80"
          >
            <button
              type="button"
              data-theme-toggle=""
              onClick={() => setTheme("light")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold transition-colors ${
                uiTheme === "light"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              aria-pressed={uiTheme === "light"}
            >
              <SunIcon className="h-4 w-4" />
              Light
            </button>
            <button
              type="button"
              data-theme-toggle=""
              onClick={() => setTheme("dark")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold transition-colors ${
                uiTheme === "dark"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              aria-pressed={uiTheme === "dark"}
            >
              <MoonIcon className="h-4 w-4" />
              Dark
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              data-theme-toggle-cycle=""
              onClick={() => setTheme(uiTheme === "dark" ? "light" : "dark")}
              className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-amber-600 shadow-md transition hover:bg-amber-50 dark:border-blue-500/45 dark:bg-slate-800 dark:text-amber-300 dark:shadow-[0_0_12px_rgba(59,130,246,0.25)] dark:hover:bg-slate-700"
              title={uiTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={uiTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {uiTheme === "dark" ? (
                <SunIcon className="h-5 w-5" aria-hidden />
              ) : (
                <MoonIcon className="h-5 w-5" aria-hidden />
              )}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => persistPinnedOpen(!pinnedOpen)}
        className="absolute right-0 top-1/2 z-30 flex h-7 w-7 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700 dark:hover:text-white"
        aria-expanded={wide}
        aria-label={pinnedOpen ? "Collapse sidebar" : "Pin sidebar open"}
      >
        {pinnedOpen ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
      </button>
    </aside>
  );
}
