"use server";

import { createSupabaseAdmin } from "@/app/lib/supabase/admin";

export type SuggestedPrescription = {
  id: string;
  content_text: string;
  similarity: number;
  interaction_type: string;
};

export async function getSuggestedPrescriptions(
  text: string,
  practitionerId: string,
): Promise<SuggestedPrescription[]> {
  const geminiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  if (!geminiKey || !text.trim() || !practitionerId.trim()) return [];

  let embedRes: Response;
  try {
    embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 2048) }] },
          outputDimensionality: 768,
        }),
      },
    );
  } catch {
    return [];
  }

  if (!embedRes.ok) return [];

  const embedJson = (await embedRes.json().catch(() => null)) as Record<string, unknown> | null;
  const values = (embedJson?.embedding as Record<string, unknown> | undefined)?.values;
  if (!Array.isArray(values) || values.length === 0) return [];

  const nums = (values as unknown[]).map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return [];

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.rpc("match_interactions", {
    query_embedding: nums,
    match_threshold: 0.75,
    match_count: 5,
    p_practitioner_id: practitionerId,
  });

  if (error || !Array.isArray(data)) return [];

  return (data as SuggestedPrescription[]).filter(
    (r) => r.interaction_type === "prescription",
  );
}
