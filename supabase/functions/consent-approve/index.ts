import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  abdmPostJson,
  corsHeaders,
  jsonResponse,
  readJsonBody,
  requireUserJwt,
} from "../_shared/abdm-utils.ts";

/**
 * consent-approve — Clinician / HIU acknowledges or grants consent flow step
 *
 * Flow:
 * 1. Validate Supabase JWT (doctor app user).
 * 2. Build gateway payload and POST to ABDM_CONSENT_APPROVE_PATH
 *    (default `/hiu/v3/consent/request/on-init` is a placeholder — set env to your CM contract).
 *
 * Thin mapping when not using raw `payload`:
 * {
 *   "consentRequestId": "uuid",
 *   "status": "GRANTED" | "DENIED",
 *   "hiuId": "optional override (else ABDM_HIU_ID env)",
 *   "consentArtefacts": [ ... ]   // optional, when status GRANTED
 * }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const user = await requireUserJwt(req);
    const body = await readJsonBody(req);

    const path =
      Deno.env.get("ABDM_CONSENT_APPROVE_PATH") ?? "/hiu/v3/consent/request/on-init";

    let gatewayBody: unknown;
    if (body.payload && typeof body.payload === "object") {
      gatewayBody = body.payload;
    } else {
      const consentRequestId = String(body.consentRequestId ?? "").trim();
      const status = String(body.status ?? "GRANTED").trim().toUpperCase();
      if (!consentRequestId) {
        return jsonResponse({ ok: false, error: "consentRequestId required (or pass payload)" }, 400);
      }

      gatewayBody = {
        consentRequest: { id: consentRequestId },
        status,
        consentArtefacts: body.consentArtefacts ?? body.consent_artefacts ?? [],
        requester: {
          name: user.user_metadata?.full_name ?? user.email ?? user.id,
        },
      };
    }

    const hiuOverride = String(body.hiuId ?? "").trim();
    const headerOverrides = hiuOverride ? { "X-HIU-ID": hiuOverride } : undefined;

    const { status: httpStatus, json } = await abdmPostJson(path, gatewayBody, { headerOverrides });

    if (httpStatus < 200 || httpStatus >= 300) {
      return jsonResponse({ ok: false, abdmStatus: httpStatus, abdm: json }, 502);
    }

    return jsonResponse({ ok: true, abdm: json });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unauthorized =
      msg.includes("Missing Authorization") ||
      msg.includes("Invalid or expired session");
    return jsonResponse({ ok: false, error: msg }, unauthorized ? 401 : 400);
  }
});
