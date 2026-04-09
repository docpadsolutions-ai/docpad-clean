import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  abdmPostJson,
  corsHeaders,
  jsonResponse,
  readJsonBody,
  requireUserJwt,
} from "../_shared/abdm-utils.ts";

/**
 * abha-link-init — Start patient ↔ ABHA linking at HIP
 *
 * Flow:
 * 1. Validate Supabase JWT.
 * 2. Map a thin client payload into HIP link/on-init shape (NDHM v3 style).
 * 3. POST to gateway (ABDM_LINK_INIT_PATH, default /hip/v3/patients/link/on-init).
 *
 * Request body (example):
 * {
 *   "abhaNumber": "14-xxxx-xxxx-xxxx",
 *   "patient": {
 *     "id": "hip-internal-patient-uuid",
 *     "name": "First Last",
 *     "gender": "M",
 *     "yearOfBirth": 1990
 *   },
 *   "purpose": { "text": "LINKING", "code": "LINK", "refUri": "https://www.abdm.gov.in" }
 * }
 *
 * You may instead pass `"payload": { ... }` to forward raw JSON without mapping.
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

    const path = Deno.env.get("ABDM_LINK_INIT_PATH") ?? "/hip/v3/patients/link/on-init";

    let gatewayBody: unknown;
    if (body.payload && typeof body.payload === "object") {
      gatewayBody = body.payload;
    } else {
      const abhaNumber = String(body.abhaNumber ?? "").trim();
      if (!abhaNumber) {
        return jsonResponse({ ok: false, error: "abhaNumber is required (or pass payload)" }, 400);
      }
      const patient = body.patient as Record<string, unknown> | undefined;
      if (!patient?.id || !patient?.name) {
        return jsonResponse({ ok: false, error: "patient.id and patient.name are required" }, 400);
      }

      const purpose = (body.purpose as Record<string, unknown> | undefined) ?? {
        text: "LINKING",
        code: "LINK",
        refUri: "https://www.abdm.gov.in",
      };

      const authMode = typeof body.authMode === "string" ? body.authMode.trim() : "";

      gatewayBody = {
        abhaNumber,
        patient: {
          id: String(patient.id),
          name: String(patient.name),
          gender: patient.gender ?? "M",
          yearOfBirth: patient.yearOfBirth ?? patient.year_of_birth,
        },
        purpose,
        ...(authMode ? { authMode } : {}),
      };
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
