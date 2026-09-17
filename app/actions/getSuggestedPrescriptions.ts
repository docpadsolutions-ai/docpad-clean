"use server";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getGeminiApiKey, requireStaff } from "@/lib/supabase/server";

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
  const geminiKey = getGeminiApiKey();
  if (!geminiKey || !text.trim() || !practitionerId.trim()) return [];

  // Server actions are public endpoints: caller must be staff, and may only query practitioners in their own hospital.
  if (!/^[0-9a-f-]{36}$/i.test(practitionerId.trim())) return [];
  const gate = await requireStaff();
  if (!gate.ok) return [];
  const { data: target } = await createSupabaseAdmin()
    .from("practitioners")
    .select("hospital_id")
    .or(`id.eq.${practitionerId.trim()},user_id.eq.${practitionerId.trim()}`)
    .limit(1)
    .maybeSingle();
  if (!target || (target as { hospital_id: string | null }).hospital_id !== gate.staff.hospitalId) return [];

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
