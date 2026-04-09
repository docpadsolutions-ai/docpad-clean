/**
 * Shared ABDM / NDHM gateway helpers for Edge Functions.
 *
 * Secrets (set per environment):
 *   ABDM_GATEWAY_URL       — e.g. https://dev.abdm.gov.in (no trailing slash)
 *   ABDM_CLIENT_ID         — gateway client id
 *   ABDM_CLIENT_SECRET     — gateway client secret
 *   ABDM_CM_ID             — X-CM-ID header (sandbox often "sbx")
 *   ABDM_HIP_ID            — optional default X-HIP-ID
 *   ABDM_HIU_ID            — optional default X-HIU-ID
 *
 * Optional path overrides (defaults are common v3-style paths; adjust for your bridge):
 *   ABDM_SESSIONS_PATH, ABDM_LINK_INIT_PATH, ABDM_LINK_CONFIRM_PATH,
 *   ABDM_CONSENT_APPROVE_PATH, ABDM_HI_DATA_PUSH_PATH
 */

import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-abdm-webhook-secret, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

let tokenCache: { token: string; expMs: number } | null = null;

export type GatewaySession = {
  accessToken: string;
  expiresIn: number;
  tokenType?: string;
};

/**
 * Fetch (and cache) gateway access token — client_credentials.
 */
export async function getGatewayAccessToken(forceRefresh = false): Promise<GatewaySession> {
  const now = Date.now();
  if (!forceRefresh && tokenCache && tokenCache.expMs > now + 60_000) {
    return {
      accessToken: tokenCache.token,
      expiresIn: Math.max(0, Math.floor((tokenCache.expMs - now) / 1000)),
      tokenType: "Bearer",
    };
  }

  const base = requireEnv("ABDM_GATEWAY_URL").replace(/\/$/, "");
  const path = Deno.env.get("ABDM_SESSIONS_PATH") ?? "/gateway/v3/sessions";
  const clientId = requireEnv("ABDM_CLIENT_ID");
  const clientSecret = requireEnv("ABDM_CLIENT_SECRET");

  const body = {
    clientId,
    clientSecret,
    grantType: "client_credentials",
  };

  const res = await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`ABDM sessions: non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }

  if (!res.ok) {
    throw new Error(`ABDM sessions ${res.status}: ${text.slice(0, 2000)}`);
  }

  const nested = parsed.data as Record<string, unknown> | undefined;
  const accessToken =
    (parsed.accessToken as string) ??
    (parsed.access_token as string) ??
    (nested?.accessToken as string) ??
    (nested?.access_token as string);
  if (!accessToken) {
    throw new Error("ABDM sessions: no accessToken in response");
  }

  const expiresIn = Number(
    parsed.expiresIn ?? parsed.expires_in ?? nested?.expiresIn ?? nested?.expires_in ?? 3600,
  );
  tokenCache = { token: accessToken, expMs: now + Math.max(60, expiresIn) * 1000 };

  return {
    accessToken,
    expiresIn,
    tokenType: (parsed.tokenType as string) ?? (parsed.token_type as string) ?? "Bearer",
  };
}

export function abdmStandardHeaders(overrides?: Record<string, string>): Record<string, string> {
  const hip = Deno.env.get("ABDM_HIP_ID")?.trim();
  const hiu = Deno.env.get("ABDM_HIU_ID")?.trim();
  const cm = Deno.env.get("ABDM_CM_ID")?.trim() ?? "sbx";

  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "REQUEST-ID": crypto.randomUUID(),
    TIMESTAMP: new Date().toISOString(),
    "X-CM-ID": cm,
    ...(hip ? { "X-HIP-ID": hip } : {}),
    ...(hiu ? { "X-HIU-ID": hiu } : {}),
    ...overrides,
  };
  return h;
}

/**
 * POST JSON to ABDM gateway with bearer from getGatewayAccessToken().
 */
export async function abdmPostJson(
  pathOrUrl: string,
  body: unknown,
  opts?: { accessToken?: string; headerOverrides?: Record<string, string> },
): Promise<{ status: number; json: unknown; raw: string }> {
  const base = requireEnv("ABDM_GATEWAY_URL").replace(/\/$/, "");
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${base}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  const session = opts?.accessToken
    ? { accessToken: opts.accessToken, expiresIn: 0 }
    : await getGatewayAccessToken();

  const headers = abdmStandardHeaders({
    Authorization: `Bearer ${session.accessToken}`,
    ...opts?.headerOverrides,
  });

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = { _parseError: true, raw: raw.slice(0, 8000) };
  }
  return { status: res.status, json, raw };
}

export async function requireUserJwt(req: Request): Promise<User> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Missing Authorization bearer token");
  }
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not configured");

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Invalid or expired session");
  return user;
}

export async function getServiceSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Optional webhook shared secret (header X-ABDM-Webhook-Secret or Authorization Bearer). */
export function assertWebhookSecret(req: Request): void {
  const secret = Deno.env.get("ABDM_WEBHOOK_SECRET")?.trim();
  if (!secret) return;

  const h = req.headers.get("x-abdm-webhook-secret")?.trim();
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (h === secret || bearer === secret) return;
  throw new Error("Webhook authentication failed");
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Encrypt UTF-8 plaintext with AES-256-GCM; wrap AES key with RSA-OAEP-SHA256 (HIU public key PEM).
 */
export async function encryptForHiuTransfer(
  plaintextUtf8: string,
  recipientPublicKeyPem: string,
): Promise<{
  ivB64: string;
  ciphertextB64: string;
  wrappedKeyB64: string;
}> {
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(plaintextUtf8),
  );

  const rawAes = await crypto.subtle.exportKey("raw", aesKey);

  const spki = pemToDer(recipientPublicKeyPem);
  const rsaPub = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaPub, rawAes);

  const b64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  return {
    ivB64: b64(iv.buffer),
    ciphertextB64: b64(ct),
    wrappedKeyB64: b64(wrapped),
  };
}
