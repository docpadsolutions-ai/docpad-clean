"use server";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getGeminiApiKey, requireStaff } from "@/lib/supabase/server";

export type SuggestedPrescription = {
  id: string;
  source_id: string | null;
  content_text: string;
  similarity: number;
  interaction_type: string;
  /** "mine" = this doctor prescribed it. "clinic" = a colleague at the same hospital did. */
  scope: "mine" | "clinic";
  author_name: string | null;
};

/**
 * Every failure used to come back as an empty array, so a broken embedding call, a
 * missing key and "this doctor has no similar case" all looked identical: the panel
 * flashed its skeletons and vanished. The reason now travels with the result.
 */
export type SuggestedPrescriptionsResult = {
  suggestions: SuggestedPrescription[];
  /** Short, user-facing reason the lookup could not run. null when it ran. */
  error: string | null;
  /**
   * True when this hospital has no prescription history embedded at all, so there
   * is nothing to match against yet. Distinguishes "not set up" from "no similar
   * case", which is the difference between a feature that looks broken and one
   * that is simply new.
   */
  corpusEmpty: boolean;
};

/**
 * Cosine floor. Measured on this corpus with gemini-embedding-001 at 768
 * dimensions, two unrelated notes still score about 0.56 ("Cough" against
 * "1-1-1 before food"), while genuinely related knee notes score 0.75 to 0.82.
 * 0.65 sits above the noise band without demanding a near-identical note.
 */
const MATCH_THRESHOLD = 0.65;

const ok = (
  suggestions: SuggestedPrescription[],
  corpusEmpty = false,
): SuggestedPrescriptionsResult => ({ suggestions, error: null, corpusEmpty });

const fail = (error: string): SuggestedPrescriptionsResult => ({
  suggestions: [],
  error,
  corpusEmpty: false,
});

export async function getSuggestedPrescriptions(
  text: string,
  practitionerId: string,
): Promise<SuggestedPrescriptionsResult> {
  if (!text.trim() || !practitionerId.trim()) return ok([]);

  const geminiKey = getGeminiApiKey();
  if (!geminiKey) return fail("AI key is not configured on the server");

  // Server actions are public endpoints: caller must be staff, and may only query
  // practitioners in their own hospital.
  if (!/^[0-9a-f-]{36}$/i.test(practitionerId.trim())) return ok([]);
  const gate = await requireStaff();
  if (!gate.ok) return fail("you are not signed in as active staff");

  const { data: target } = await createSupabaseAdmin()
    .from("practitioners")
    .select("hospital_id")
    .or(`id.eq.${practitionerId.trim()},user_id.eq.${practitionerId.trim()}`)
    .limit(1)
    .maybeSingle();
  if (!target || (target as { hospital_id: string | null }).hospital_id !== gate.staff.hospitalId) {
    return ok([]);
  }

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
    return fail("could not reach the embedding service");
  }

  if (!embedRes.ok) {
    return fail(
      embedRes.status === 400 || embedRes.status === 403
        ? "the AI key was rejected"
        : `the embedding service returned ${embedRes.status}`,
    );
  }

  const embedJson = (await embedRes.json().catch(() => null)) as Record<string, unknown> | null;
  const values = (embedJson?.embedding as Record<string, unknown> | undefined)?.values;
  if (!Array.isArray(values) || values.length === 0) {
    return fail("the embedding service returned nothing usable");
  }

  const nums = (values as unknown[]).map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return fail("the embedding came back malformed");

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.rpc("match_interactions", {
    query_embedding: nums,
    match_threshold: MATCH_THRESHOLD,
    match_count: 5,
    p_practitioner_id: practitionerId,
  });

  if (error) return fail(error.message);

  const rows = Array.isArray(data)
    ? (data as SuggestedPrescription[]).filter((r) => r.interaction_type === "prescription")
    : [];
  if (rows.length > 0) return ok(rows);

  // Nothing matched. Say whether that is because there is no history to match
  // against yet, which is what a new clinic will always see.
  const { count } = await supabase
    .from("doctor_interaction_embeddings")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", gate.staff.hospitalId)
    .eq("interaction_type", "prescription");

  return ok([], (count ?? 0) === 0);
}
