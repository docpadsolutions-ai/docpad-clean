import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INTERACTION_TYPES = new Set([
  "prescription",
  "investigation",
  "diagnosis",
  "followup",
  "admission_order",
  "nurse_instruction",
  "procedure",
  "referral",
]);

function json200(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json200({ success: false, error: "method_not_allowed" });
  }

  try {
    const geminiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      console.error("[embed-interaction] invalid JSON body");
      return json200({ success: false, error: "invalid_json" });
    }

    const practitioner_id = String(body.practitioner_id ?? "").trim();
    const hospital_id = String(body.hospital_id ?? "").trim();
    const interaction_type = String(body.interaction_type ?? "").trim();
    const source_table = String(body.source_table ?? "").trim();
    const source_id = String(body.source_id ?? "").trim();
    const content_text = String(body.content_text ?? "").trim();
    const metadata = body.metadata;

    if (
      !practitioner_id ||
      !hospital_id ||
      !interaction_type ||
      !source_table ||
      !source_id ||
      !content_text
    ) {
      console.error("[embed-interaction] missing required fields", {
        hasPractitioner: Boolean(practitioner_id),
        hasHospital: Boolean(hospital_id),
        hasType: Boolean(interaction_type),
        hasSourceTable: Boolean(source_table),
        hasSourceId: Boolean(source_id),
        hasContent: Boolean(content_text),
      });
      return json200({ success: false, error: "validation" });
    }

    if (!INTERACTION_TYPES.has(interaction_type)) {
      console.error("[embed-interaction] bad interaction_type", interaction_type);
      return json200({ success: false, error: "bad_interaction_type" });
    }

    if (metadata != null && typeof metadata !== "object") {
      console.error("[embed-interaction] metadata must be object");
      return json200({ success: false, error: "bad_metadata" });
    }

    if (!geminiKey) {
      console.error("[embed-interaction] GEMINI_API_KEY not set");
      return json200({ success: false, error: "missing_gemini_key" });
    }
    if (!supabaseUrl || !serviceKey) {
      console.error("[embed-interaction] Supabase env not set");
      return json200({ success: false, error: "missing_supabase_env" });
    }

    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: String(content_text).slice(0, 2048) }] },
          outputDimensionality: 768 // <--- This forces the model to match your DB size
        })
      }
    );

    const embedJson = (await embedRes.json().catch(() => null)) as Record<string, unknown> | null;
    if (!embedRes.ok) {
      console.error("[embed-interaction] Gemini HTTP", embedRes.status, embedJson);
      return json200({ success: false, error: "gemini_http" });
    }

    const values = (embedJson?.embedding as Record<string, unknown> | undefined)?.values;

    if (!Array.isArray(values) || values.length === 0) {
      console.error("[embed-interaction] unexpected embedding shape", typeof values);
      return json200({ success: false, error: "gemini_embedding_shape" });
    }

    const nums = (values as unknown[]).map((v) => Number(v));
    if (nums.some((n) => !Number.isFinite(n))) {
      console.error("[embed-interaction] non-numeric embedding values");
      return json200({ success: false, error: "gemini_embedding_nan" });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const metaObj =
      metadata != null && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};

    const { error: upErr } = await supabase.from("doctor_interaction_embeddings").upsert(
      {
        practitioner_id,
        hospital_id,
        interaction_type,
        source_table,
        source_id,
        content_text,
        embedding: nums,
        metadata: metaObj,
      },
      { onConflict: "source_table,source_id" },
    );

    if (upErr) {
      console.error("[embed-interaction] upsert error", upErr.message, upErr);
      return json200({ 
        success: false, 
        error: "upsert_failed",
        db_message: upErr.message,
        db_details: upErr.details,
        db_hint: upErr.hint
      });
    }

    return json200({ success: true });
  } catch (e) {
    console.error("[embed-interaction] unhandled", e);
    const errMsg = e instanceof Error ? e.message : String(e);
    return json200({ success: false, error: "unhandled", details: errMsg });
  }
});
