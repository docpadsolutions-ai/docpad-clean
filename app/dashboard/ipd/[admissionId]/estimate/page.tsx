import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ admissionId: string }>;
};

/** Alias → `/ipd/[admissionId]/estimate` (same layout shell). */
export default async function DashboardIpdEstimateAliasPage({ params }: Props) {
  const { admissionId } = await params;
  const raw = (admissionId ?? "").trim();
  if (!raw) {
    redirect("/dashboard/ipd");
  }
  redirect(`/ipd/${encodeURIComponent(raw)}/estimate`);
}
