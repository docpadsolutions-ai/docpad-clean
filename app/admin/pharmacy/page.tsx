import { PharmacyInventory } from "@/app/components/pharmacy/PharmacyInventory";

/** Alias route: same formulary as /admin/dashboard/pharmacy (admin role). */
export default function AdminPharmacyPage() {
  return <PharmacyInventory role="admin" />;
}
