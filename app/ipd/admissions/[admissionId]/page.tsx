import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ admissionId: string }>;
};

/** Alias for `/dashboard/ipd/[admissionId]` — matches product URL `/ipd/admissions/{admission_id}`. */
export default async function IpdAdmissionAliasPage({ params }: Props) {
  const { admissionId } = await params;
  const raw = (admissionId ?? "").trim();
  if (!raw) {
    redirect("/dashboard/ipd");
  }
  redirect(`/dashboard/ipd/${encodeURIComponent(raw)}`);
}
