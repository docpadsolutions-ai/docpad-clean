import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  abdmPostJson,
  corsHeaders,
  encryptForHiuTransfer,
  jsonResponse,
  readJsonBody,
  requireUserJwt,
} from "../_shared/abdm-utils.ts";

/**
 * hi-data-transfer — Push encrypted FHIR Bundle to HIU / gateway data endpoint
 *
 * Flow:
 * 1. Validate Supabase JWT.
 * 2. Serialize `bundle` (FHIR R4) to canonical JSON string.
 * 3. AES-256-GCM encrypt; wrap AES key with HIU RSA public key (PEM).
 * 4. POST envelope to ABDM_HI_DATA_PUSH_PATH (or body.pushUrl one-off).
 *
 * Request body:
 * {
 *   "transactionId": "from consent / data request",
 *   "bundle": { "resourceType": "Bundle", ... },
 *   "recipientPublicKeyPem": "-----BEGIN PUBLIC KEY-----\\n...",
 *   "pushUrl": "optional full URL override",
 *   "hiuId": "optional X-HIU-ID override",
 *   "extras": { } // merged into POST body alongside encrypted fields
 * }
 *
 * Or `"payload": { ... }` to skip encryption and forward raw JSON (not recommended).
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

    const defaultPath = Deno.env.get("ABDM_HI_DATA_PUSH_PATH") ??
      "/hip/v3/health-information/request/on-request";

    if (body.payload && typeof body.payload === "object") {
      const pushUrl = typeof body.pushUrl === "string" ? body.pushUrl : "";
      const path = pushUrl || defaultPath;
      const hiuOverride = String(body.hiuId ?? "").trim();
      const { status, json } = await abdmPostJson(path, body.payload, {
        headerOverrides: hiuOverride ? { "X-HIU-ID": hiuOverride } : undefined,
      });
      if (status < 200 || status >= 300) {
        return jsonResponse({ ok: false, abdmStatus: status, abdm: json }, 502);
      }
      return jsonResponse({ ok: true, mode: "passthrough", abdm: json });
    }

    const transactionId = String(body.transactionId ?? "").trim();
    const bundle = body.bundle as Record<string, unknown> | undefined;
    const recipientPublicKeyPem = String(body.recipientPublicKeyPem ?? "").trim();

    if (!transactionId) {
      return jsonResponse({ ok: false, error: "transactionId required" }, 400);
    }
    if (!bundle || bundle.resourceType !== "Bundle") {
      return jsonResponse({ ok: false, error: "bundle.resourceType must be Bundle" }, 400);
    }
    if (!recipientPublicKeyPem.includes("BEGIN PUBLIC KEY")) {
      return jsonResponse({ ok: false, error: "recipientPublicKeyPem (RSA PEM) required" }, 400);
    }

    const canonical = JSON.stringify(bundle);
    const encrypted = await encryptForHiuTransfer(canonical, recipientPublicKeyPem);

    const extras = (body.extras as Record<string, unknown> | undefined) ?? {};

    const gatewayBody = {
      transactionId,
      keyMaterial: {
        cryptoAlg: "RSA-OAEP-256",
        curve: "NA",
        dhPublicKey: "",
        nonce: encrypted.ivB64,
        cipherText: encrypted.wrappedKeyB64,
      },
      encryptedFhirBundle: encrypted.ciphertextB64,
      ...extras,
    };

    const pushUrl = typeof body.pushUrl === "string" ? body.pushUrl.trim() : "";
    const path = pushUrl || defaultPath;
    const hiuOverride = String(body.hiuId ?? "").trim();

    const { status, json } = await abdmPostJson(path, gatewayBody, {
      headerOverrides: hiuOverride ? { "X-HIU-ID": hiuOverride } : undefined,
    });

    if (status < 200 || status >= 300) {
      return jsonResponse({ ok: false, abdmStatus: status, abdm: json }, 502);
    }

    return jsonResponse({
      ok: true,
      mode: "encrypted",
      abdm: json,
      meta: {
        transactionId,
        cipherBytes: encrypted.ciphertextB64.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unauthorized =
      msg.includes("Missing Authorization") ||
      msg.includes("Invalid or expired session");
    return jsonResponse({ ok: false, error: msg }, unauthorized ? 401 : 400);
  }
});
