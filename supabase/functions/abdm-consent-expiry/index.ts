import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Daily job: mark `abdm_patient_consents` rows as `expired` when `expires_at` has passed.
 *
 * Schedule: 00:00 IST = 18:30 UTC → cron `30 18 * * *` (see `supabase/sql/abdm-consent-expiry-cron.example.sql`).
 *
 * Secrets:
 *   CRON_SECRET                  — required header `x-cron-secret`
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
      },
    });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, function: "abdm-consent-expiry" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("abdm_patient_consents")
    .update({ status: "expired", updated_at: nowIso })
    .eq("status", "active")
    .lte("expires_at", nowIso)
    .select("id");

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const expiredCount = data?.length ?? 0;

  return new Response(
    JSON.stringify({
      ok: true,
      expiredCount,
      processedAt: nowIso,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
