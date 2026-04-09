import { redirect } from "next/navigation";

/** Legacy URL → `/opd/[encounterId]/investigations/view`. */
export default async function EncounterInvestigationsViewRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const encId = typeof id === "string" ? id.trim() : "";
  if (!encId) redirect("/dashboard/opd");
  redirect(`/opd/${encId}/investigations/view`);
}
