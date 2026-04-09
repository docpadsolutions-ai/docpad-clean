import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Alias for `/dashboard/opd/encounter/[id]`; query string is preserved (e.g. `?mode=readonly`). */
export default async function OpdEncounterAliasPage({ params, searchParams }: Props) {
  const { id } = await params;
  const raw = (id ?? "").trim();
  if (!raw) {
    redirect("/dashboard/opd");
  }
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      for (const item of val) q.append(key, item);
    } else {
      q.set(key, val);
    }
  }
  const qs = q.toString();
  redirect(`/dashboard/opd/encounter/${encodeURIComponent(raw)}${qs ? `?${qs}` : ""}`);
}
