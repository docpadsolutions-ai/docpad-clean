import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  getGatewayAccessToken,
  jsonResponse,
  readJsonBody,
  requireUserJwt,
} from "../_shared/abdm-utils.ts";

/**
 * abdm-auth — Gateway session token management
 *
 * Flow:
 * 1. Validates Supabase user JWT (caller must be signed in).
 * 2. Calls NDHM gateway `/sessions` (path override: ABDM_SESSIONS_PATH).
 * 3. Returns access token + expiry (cached in isolate until near expiry).
 *
 * POST body (optional): `{ "forceRefresh": boolean }`
 *
 * Response: `{ ok, accessToken, tokenType, expiresIn, expiresAtIso }`
 *
 * Security: Prefer not exposing raw gateway tokens to browsers in production;
 * use a BFF or restrict to service role. This matches typical “token management”
 * Edge entrypoints for trusted clients.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    await requireUserJwt(req);
    const body = await readJsonBody(req);
    const forceRefresh = Boolean(body.forceRefresh);

    const session = await getGatewayAccessToken(forceRefresh);
    const expiresAtIso = new Date(Date.now() + session.expiresIn * 1000).toISOString();

    return jsonResponse({
      ok: true,
      accessToken: session.accessToken,
      tokenType: session.tokenType ?? "Bearer",
      expiresIn: session.expiresIn,
      expiresAtIso,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unauthorized =
      msg.includes("Missing Authorization") ||
      msg.includes("Invalid or expired session");
    return jsonResponse({ ok: false, error: msg }, unauthorized ? 401 : 400);
  }
});
