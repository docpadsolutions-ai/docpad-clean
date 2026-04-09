import { redirect } from "next/navigation";

/** Legacy URL → canonical investigation plan at `/opd/[encounterId]/investigations`. */
export default async function EncounterInvestigationsRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const encId = typeof id === "string" ? id.trim() : "";
  if (!encId) redirect("/dashboard/opd");
  redirect(`/opd/${encId}/investigations`);
}
