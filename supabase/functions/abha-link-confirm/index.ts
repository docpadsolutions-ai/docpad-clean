import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  abdmPostJson,
  corsHeaders,
  jsonResponse,
  readJsonBody,
  requireUserJwt,
} from "../_shared/abdm-utils.ts";

/**
 * abha-link-confirm — Complete ABHA linking with OTP / txn from init step
 *
 * Flow:
 * 1. Validate Supabase JWT.
 * 2. POST OTP + transaction id to gateway (ABDM_LINK_CONFIRM_PATH,
 *    default /hip/v3/patients/link/on-confirm).
 *
 * Request body:
 * {
 *   "otp": "123456",
 *   "txnId": "<transaction id from init response>"
 * }
 *
 * Or `"payload": { ... }` for raw forward.
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
    const path = Deno.env.get("ABDM_LINK_CONFIRM_PATH") ?? "/hip/v3/patients/link/on-confirm";

    let gatewayBody: unknown;
    if (body.payload && typeof body.payload === "object") {
      gatewayBody = body.payload;
    } else {
      const otp = String(body.otp ?? "").trim();
      const txnId = String(body.txnId ?? body.transactionId ?? "").trim();
      if (!otp || !txnId) {
        return jsonResponse({ ok: false, error: "otp and txnId (or transactionId) required" }, 400);
      }
      gatewayBody = { otp, txnId };
    }

    const { status, json } = await abdmPostJson(path, gatewayBody);

    if (status < 200 || status >= 300) {
      return jsonResponse({ ok: false, abdmStatus: status, abdm: json }, 502);
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
