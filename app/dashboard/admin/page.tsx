import Link from "next/link";
import {
  BarChart3,
  Building2,
  ClipboardList,
  FileCheck,
  Hospital,
  Pill,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type NavCardProps = {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
};

function NavCard({ href, title, description, icon }: NavCardProps) {
  return (
    <Link href={href} className="group block h-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl">
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

export default function AdminDashboardPage() {
  return (
    <div className="bg-background p-8 text-foreground">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Administration</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Organization tools, invitations, and staff onboarding.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
    </div>
  );
}
