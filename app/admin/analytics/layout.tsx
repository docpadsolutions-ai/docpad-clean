"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin/analytics", label: "Dashboard" },
  { href: "/admin/analytics/operational", label: "Operational" },
  { href: "/admin/analytics/clinical", label: "Clinical" },
  { href: "/admin/analytics/compliance", label: "Compliance" },
  { href: "/admin/analytics/financial", label: "Financial" },
] as const;

export default function AdminAnalyticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-background text-foreground">
      <div className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6 lg:px-8">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Hospital analytics</h1>
            <p className="text-xs text-muted-foreground">
              Admin — NABH-oriented operational, clinical, compliance, and financial views.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {links.map(({ href, label }) => {
              const active =
                href === "/admin/analytics"
                  ? pathname === "/admin/analytics" || pathname === "/admin/analytics/"
                  : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    active
                      ? "bg-blue-600 text-white shadow-sm dark:bg-blue-600"
                      : "border border-border bg-background text-foreground hover:bg-muted dark:bg-muted/30 dark:hover:bg-muted/50"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
