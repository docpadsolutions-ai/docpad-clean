import { redirect } from "next/navigation";

/** Canonical OPD hub lives under `/dashboard/opd`; `/opd` is the role default entry. */
export default function OpdEntryRedirectPage() {
  redirect("/dashboard/opd");
}
