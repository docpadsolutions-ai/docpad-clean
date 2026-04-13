import type { AppRole } from "./userRole";

export type NavItem = {
  href: string;
  label: string;
  /** Sidebar badge: count of `requested` consults from `get_my_pending_consults` */
  consultPendingBadge?: boolean;
};

const doctorNav: NavItem[] = [
  { href: "/dashboard/opd", label: "Home" },
  { href: "/dashboard/opd", label: "OPD" },
  { href: "/dashboard/ipd", label: "IPD" },
  { href: "/ipd/consults", label: "Consult Inbox", consultPendingBadge: true },
  { href: "/dashboard/opd/patients", label: "Patients" },
  { href: "/dashboard/opd/new", label: "New visit" },
  { href: "/dashboard/settings", label: "Settings" },
];

const pharmacistNav: NavItem[] = [
  { href: "/dashboard/pharmacy", label: "Pharmacy" },
  { href: "/dashboard/pharmacy/inventory", label: "Inventory" },
];

/** Nurse: ward workflow + patient list only — no doctor encounter apps. */
const nurseNav: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/nursing", label: "Nursing" },
  { href: "/dashboard/opd/patients", label: "Patients" },
  { href: "/dashboard/settings", label: "Settings" },
];

const receptionNav: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/reception", label: "Reception" },
  { href: "/dashboard/opd/patients", label: "Patients" },
  { href: "/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
];

const labTechNav: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/lab", label: "Lab" },
  { href: "/dashboard/opd/patients", label: "Patients" },
  { href: "/dashboard/settings", label: "Settings" },
];

const adminNav: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/admin", label: "Admin" },
  { href: "/nursing", label: "Nursing" },
  { href: "/billing", label: "Billing" },
  ...doctorNav.filter((i) => i.label !== "Home"),
];

export function sidebarItemsForRole(role: AppRole): NavItem[] {
  switch (role) {
    case "pharmacist":
      return pharmacistNav;
    case "admin":
      return adminNav;
    case "nurse":
      return nurseNav;
    case "receptionist":
      return receptionNav;
    case "lab_technician":
      return labTechNav;
    default:
      return doctorNav;
  }
}

export function isActiveHref(pathname: string, href: string): boolean {
  const p = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  const h = href.endsWith("/") && href !== "/" ? href.slice(0, -1) : href;
  /** Main dashboard hub only — not /dashboard/admin, /dashboard/opd, etc. */
  if (h === "/dashboard") return p === "/dashboard";
  if (h === "/dashboard/admin") return p === "/dashboard/admin" || p.startsWith("/dashboard/admin/");
  if (h === "/dashboard/opd") return p === "/dashboard/opd" || p === "/dashboard";
  if (h === "/dashboard/ipd") {
    if (p === "/dashboard/ipd/consults" || p === "/ipd/consults") return false;
    return p === "/dashboard/ipd" || p.startsWith("/dashboard/ipd/");
  }
  if (h === "/ipd/consults") return p === "/ipd/consults";
  if (h === "/reception") return p === "/reception";
  if (h === "/reception/beds") return p === "/reception/beds" || p.startsWith("/reception/beds/");
  if (h === "/lab") return p === "/lab" || p.startsWith("/lab/");
  if (h === "/nursing") return p === "/nursing" || p.startsWith("/nursing/");
  if (h === "/billing") return p === "/billing" || p.startsWith("/billing/");
  return p === h || p.startsWith(h + "/");
}
