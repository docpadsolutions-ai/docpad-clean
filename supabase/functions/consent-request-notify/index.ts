import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  assertWebhookSecret,
  corsHeaders,
  getServiceSupabase,
  jsonResponse,
} from "../_shared/abdm-utils.ts";

/**
 * consent-request-notify — Webhook: CM → HIU consent notifications
 *
 * Flow:
 * 1. Optional shared secret: ABDM_WEBHOOK_SECRET via header X-ABDM-Webhook-Secret or Bearer.
 * 2. Accept POST body as sent by NDHM (typically `{ notification: { ... } }`).
 * 3. Acknowledge 200 quickly; persist raw payload to `abdm_webhook_inbox` when service role is configured.
 *
 * Configure CM callback URL to this function’s public URL.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertWebhookSecret(req);
  } catch {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const raw = await req.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const sb = await getServiceSupabase();
  if (sb) {
    const { error } = await sb.from("abdm_webhook_inbox").insert({
      event_type: "CONSENT_REQUEST_NOTIFY",
      payload,
      processed: false,
    });
    if (error) {
      console.error("abdm_webhook_inbox insert failed:", error.message);
    }
  }

  return jsonResponse({
    ok: true,
    received: true,
    persisted: Boolean(sb),
  });
});
