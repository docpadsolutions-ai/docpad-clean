"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  ClipboardList,
  FileCheck,
  Hospital,
  IndianRupee,
  Package,
  Pill,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";
import { practitionerRoleRawFromRow, practitionersOrFilterForAuthUid } from "../../lib/practitionerAuthLookup";
import { supabase } from "../../supabase";
import { WardInventoryManager } from "../../../components/admin/WardInventoryManager";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";

type NavCardProps = {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
};

function NavCard({ href, title, description, icon }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        className={cn(
          "h-full border-border bg-card shadow-sm transition-shadow transition-colors",
          "hover:border-blue-500/30 hover:shadow-md",
        )}
      >
        <CardHeader className="gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
            {icon}
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-lg group-hover:text-blue-700 dark:group-hover:text-blue-300">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}

const WARD_INVENTORY_TAB_ROLES = new Set(["admin", "charge_nurse", "store_incharge"]);

function normalizeRoleKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function canShowWardInventoryTab(roleRaw: string | null): boolean {
  return WARD_INVENTORY_TAB_ROLES.has(normalizeRoleKey(roleRaw));
}

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<"overview" | "ward-inventory">("overview");
  const [roleRaw, setRoleRaw] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const loadRole = useCallback(async () => {
    setRoleLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id;
    if (!uid) {
      setRoleRaw(null);
      setRoleLoading(false);
      return;
    }
    const { data: pr } = await supabase
      .from("practitioners")
      .select("role, user_role")
      .or(practitionersOrFilterForAuthUid(uid))
      .maybeSingle();
    const raw = pr ? practitionerRoleRawFromRow(pr as { role?: unknown; user_role?: unknown }) : null;
    setRoleRaw(raw);
    setRoleLoading(false);
  }, []);

  useEffect(() => {
    void loadRole();
  }, [loadRole]);

  const showWardInventoryTab = canShowWardInventoryTab(roleRaw);

  useEffect(() => {
    if (!showWardInventoryTab && tab === "ward-inventory") {
      setTab("overview");
    }
  }, [showWardInventoryTab, tab]);

  return (
    <div className="bg-background p-6 text-foreground sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Administration</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Organization tools, invitations, and staff onboarding.
      </p>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={cn(
            "inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors",
            tab === "overview"
              ? "border border-b-0 border-border bg-card text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Overview
        </button>
        {showWardInventoryTab ? (
          <button
            type="button"
            onClick={() => setTab("ward-inventory")}
            className={cn(
              "inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors",
              tab === "ward-inventory"
                ? "border border-b-0 border-border bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Package className="h-4 w-4 shrink-0" aria-hidden />
            Ward inventory
          </button>
        ) : null}
      </div>

      <div className="mt-6">
        {tab === "overview" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <NavCard
              href="/dashboard/admin/system-security"
              title="System security"
              description="Backups, authentication, sessions, and regulated exports."
              icon={<Shield className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/dashboard/pharmacy"
              title="Pharmacy"
              description="Drug master, vendors, pricing"
              icon={<Pill className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/pricing"
              title="Pricing"
              description="Charge master: room rates, registration fees, and service prices."
              icon={<IndianRupee className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/dashboard/templates"
              title="OPD templates"
              description="Department-scoped documentation templates (structure on detail only)."
              icon={<ClipboardList className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/dashboard/consent-templates"
              title="Consent library"
              description="IPD consent forms: system defaults, hospital PDFs, and template text."
              icon={<FileCheck className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/analytics"
              title="Analytics"
              description="Operational, clinical, compliance, and financial metrics"
              icon={<BarChart3 className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/dashboard/departments"
              title="Departments"
              description="OPD hours, slots, fees, and active status per department."
              icon={<Building2 className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/dashboard/hospital-profile"
              title="Hospital profile"
              description="Name, address, contact, NABH and registry details for your organization."
              icon={<Hospital className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin/dashboard/staff-directory"
              title="Staff directory"
              description="View everyone in your hospital, last login, and roles."
              icon={<Users className="h-5 w-5" aria-hidden />}
            />
            <NavCard
              href="/admin"
              title="Invite staff"
              description="Open the admin console to send invitations."
              icon={<UserPlus className="h-5 w-5" aria-hidden />}
            />
          </div>
        ) : roleLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <WardInventoryManager />
        )}
      </div>
    </div>
  );
}
