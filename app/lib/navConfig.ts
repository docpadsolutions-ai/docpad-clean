import type { AppRole } from "./userRole";

export type NavItem = { href: string; label: string };

const doctorNav: NavItem[] = [
  { href: "/dashboard/opd", label: "Home" },
  { href: "/dashboard/opd", label: "OPD" },
  { href: "/dashboard/ipd", label: "IPD" },
  { href: "/dashboard/opd/patients", label: "Patients" },
  { href: "/dashboard/opd/new", label: "New visit" },
  { href: "/dashboard/settings", label: "Settings" },
];

const pharmacistNav: NavItem[] = [
  { href: "/dashboard/pharmacy", label: "Pharmacy" },
  { href: "/dashboard/pharmacy/inventory", label: "Inventory" },
];

const nurseNav: NavItem[] = [
  { href: "/reception", label: "Reception" },
  { href: "/dashboard/settings", label: "Settings" },
];

const receptionNav: NavItem[] = [
  { href: "/reception", label: "Reception" },
  { href: "/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
];

const adminNav: NavItem[] = [
  { href: "/dashboard/admin", label: "Home" },
  { href: "/admin", label: "Admin" },
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
    default:
      return doctorNav;
  }
}

export function isActiveHref(pathname: string, href: string): boolean {
  const p = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  const h = href.endsWith("/") && href !== "/" ? href.slice(0, -1) : href;
  if (h === "/dashboard/opd") return p === "/dashboard/opd" || p === "/dashboard";
  if (h === "/dashboard/ipd") return p === "/dashboard/ipd" || p.startsWith("/dashboard/ipd/");
  return p === h || p.startsWith(h + "/");
}
