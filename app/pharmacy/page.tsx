import { redirect } from "next/navigation";

/** Pharmacist default entry; main workspace is `/dashboard/pharmacy`. */
export default function PharmacyEntryRedirectPage() {
  redirect("/dashboard/pharmacy");
}
