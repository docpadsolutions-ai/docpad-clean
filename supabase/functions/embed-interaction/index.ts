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

    // Callers may only write embeddings for their own hospital's encounters and practitioners.
    const caller = await authenticateCaller(req, supabaseUrl, serviceKey);
    if (!caller) {
      return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (caller.kind === "staff") {
      const scopeClient = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const [{ data: prac }, { data: enc }] = await Promise.all([
        scopeClient.from("practitioners").select("hospital_id").eq("id", practitioner_id).maybeSingle(),
        source_table === "opd_encounters"
          ? scopeClient.from("opd_encounters").select("hospital_id").eq("id", source_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const encHospital = (enc as { hospital_id?: string } | null)?.hospital_id;
      if (
        hospital_id !== caller.hospitalId ||
        (prac as { hospital_id?: string } | null)?.hospital_id !== caller.hospitalId ||
        source_table !== "opd_encounters" ||
        encHospital !== caller.hospitalId
      ) {
        return new Response(JSON.stringify({ success: false, error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
      return json200({ success: false, error: "upsert_failed" });
    }

    return json200({ success: true });
  } catch (e) {
    console.error("[embed-interaction] unhandled", e);
    return json200({ success: false, error: "unhandled" });
  }
});
