import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


/** verify_jwt=true means the gateway already checked the signature, so the role claim can be trusted. */
function isServiceRoleJwt(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

type Caller =
  | { kind: "service" }
  | { kind: "staff"; userId: string; practitionerId: string; hospitalId: string };

/** Only the service role or an active, hospital-linked practitioner may call this function. */
async function authenticateCaller(
  req: Request,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Caller | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (token === serviceKey || isServiceRoleJwt(token)) return { kind: "service" };

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return null;

  const { data: prac } = await admin
    .from("practitioners")
    .select("id, hospital_id, is_active")
    .or(`user_id.eq.${user.id},id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();
  if (!prac?.hospital_id || prac.is_active === false) return null;
  return { kind: "staff", userId: user.id, practitionerId: String(prac.id), hospitalId: String(prac.hospital_id) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

    if (!geminiKey) return json({ success: false, error: "missing_gemini_key" }, 500);
    if (!supabaseUrl || !serviceKey) return json({ success: false, error: "missing_supabase_env" }, 500);

    if (!(await authenticateCaller(req, supabaseUrl, serviceKey))) {
      return json({ success: false, error: "unauthorized" }, 401);
    }

    let clinical_note: string;
    try {
      const body = await req.json();
      clinical_note = String(body.clinical_note ?? "").trim();
    } catch {
      return json({ success: false, error: "invalid_json" }, 400);
    }

    if (!clinical_note) return json({ success: false, error: "missing_clinical_note" }, 400);

    // 1. Embed the clinical note at 768 dimensions
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: clinical_note.slice(0, 2048) }] },
          outputDimensionality: 768,
        }),
      },
    );

    if (!embedRes.ok) {
      const err = await embedRes.json().catch(() => null);
      console.error("[suggest-icd10] embed error", embedRes.status, err);
      return json({ success: false, error: "embed_failed" }, 500);
    }

    const embedJson = await embedRes.json();
    const queryEmbedding = embedJson?.embedding?.values as number[] | undefined;
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return json({ success: false, error: "embed_shape" }, 500);
    }

    // 2. Vector search - top candidate ICD-10 codes
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: candidates, error: rpcErr } = await supabase.rpc("search_icd10", {
      query_embedding: queryEmbedding,
      match_count: 10,
    });

    if (rpcErr || !Array.isArray(candidates) || candidates.length === 0) {
      console.error("[suggest-icd10] RPC error", rpcErr?.message);
      return json({ success: false, error: "search_failed" }, 500);
    }

    // 3. Ask Gemini Flash to pick the single best billable code
    const prompt = `You are a medical billing expert. Given a clinical note and candidate ICD-10 codes, pick the single most specific BILLABLE code.

Rules:
- Prefer billable leaf codes (e.g. M17.11) over category codes (e.g. M17)
- Laterality matters: if the note says "Right" pick Right, never Unspecified
- If multiple conditions are mentioned, pick the most clinically significant one
- Return ONLY valid JSON, no markdown, no explanation outside the JSON

Clinical Note: "${clinical_note}"

Candidate ICD-10 codes:
${candidates.map((c: Record<string, unknown>) => `${c.code}: ${c.long_description} (Billable: ${c.is_billable})`).join("\n")}

Return JSON exactly like this:
{"code":"M17.11","description":"Primary osteoarthritis, right knee","reasoning":"The note specifies right knee pain with crepitus, matching laterality-specific billable code M17.11 over unspecified M17.9"}`;

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            // gemini-2.5-flash reasons before answering by default and that
            // reasoning is charged against maxOutputTokens, so a 256-token cap
            // was being spent on thinking and the answer came back truncated
            // (finishReason MAX_TOKENS, empty text) - which is what surfaced as
            // "the AI returned an unreadable answer". Turn thinking off for a
            // task that is a pick-one-from-a-list, and leave real headroom.
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 1024,
            // Ask for JSON directly rather than hoping the prose parses.
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                code: { type: "STRING" },
                description: { type: "STRING" },
                reasoning: { type: "STRING" },
              },
              required: ["code", "description"],
            },
          },
        }),
      },
    );

    if (!genRes.ok) {
      const err = await genRes.json().catch(() => null);
      console.error("[suggest-icd10] gemini error", genRes.status, err);
      return json({ success: false, error: "gemini_failed" }, 500);
    }

    const genJson = await genRes.json();
    const candidate = genJson?.candidates?.[0];

    // With thinking enabled the answer can arrive split across several parts, so
    // take all of them rather than only the first.
    const parts = (candidate?.content?.parts ?? []) as { text?: unknown }[];
    const rawText = parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();

    if (!rawText) {
      console.error(
        "[suggest-icd10] empty completion",
        candidate?.finishReason,
        JSON.stringify(genJson?.usageMetadata ?? null),
      );
      return json(
        {
          success: false,
          error: candidate?.finishReason === "MAX_TOKENS" ? "answer_truncated" : "empty_answer",
        },
        500,
      );
    }

    // Strip markdown fences in case the model ignores responseMimeType.
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let suggestion: { code: string; description: string; reasoning: string };
    try {
      suggestion = JSON.parse(cleaned);
    } catch {
      console.error("[suggest-icd10] JSON parse failed", candidate?.finishReason, cleaned.slice(0, 300));
      return json({ success: false, error: "parse_failed" }, 500);
    }

    if (!suggestion.code || !suggestion.description) {
      return json({ success: false, error: "incomplete_suggestion" }, 500);
    }

    return json({
      success: true,
      code: String(suggestion.code).trim(),
      description: String(suggestion.description).trim(),
      reasoning: String(suggestion.reasoning ?? "").trim(),
    });
  } catch (e) {
    console.error("[suggest-icd10] unhandled", e);
    return json({ success: false, error: "unhandled" }, 500);
  }
});
