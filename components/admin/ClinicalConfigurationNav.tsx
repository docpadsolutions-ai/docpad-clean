"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin/wards", label: "Wards & Beds", match: (p: string) => p === "/admin/wards" || p.startsWith("/admin/wards/") },
  { href: "/admin/pricing", label: "Pricing", match: (p: string) => p === "/admin/pricing" || p.startsWith("/admin/pricing/") },
  { href: "/admin/dashboard/templates", label: "OPD Templates", match: (p: string) => p.startsWith("/admin/dashboard/templates") },
  {
    href: "/admin/dashboard/consent-templates",
    label: "Consent Library",
    match: (p: string) => p.startsWith("/admin/dashboard/consent-templates"),
  },
  {
    href: "/admin/dashboard/investigation-panels",
    label: "Investigation Panels",
    match: (p: string) => p.startsWith("/admin/dashboard/investigation-panels"),
  },
  {
    href: "/admin/tests",
    label: "Test catalogue",
    match: (p: string) => p === "/admin/tests" || p.startsWith("/admin/tests/"),
  },
] as const;

export default function ClinicalConfigurationNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Clinical configuration" className="rounded-lg border border-border bg-muted/30 p-1">
      <ul className="flex flex-wrap gap-1">
        {ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "inline-block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
