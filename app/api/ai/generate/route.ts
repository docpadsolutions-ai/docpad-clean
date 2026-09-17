import { NextRequest, NextResponse } from "next/server";
import { getGeminiApiKey, requireStaff } from "@/app/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Models the browser is allowed to request through this proxy. */
const ALLOWED_MODELS = new Set(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]);
const MAX_BODY_BYTES = 20 * 1024 * 1024;

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };

type GenerateBody = {
  model?: string;
  systemInstruction?: string;
  generationConfig?: Record<string, unknown>;
  parts?: Part[];
};

/**
 * Authenticated server-side proxy for Gemini `generateContent`.
 * Keeps the API key off the browser; used by `app/lib/geminiFlashClient.ts`.
 */
export async function POST(req: NextRequest) {
  const gate = await requireStaff();
  if (!gate.ok) return gate.response;

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "AI service is not configured on the server." }, { status: 503 });
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const model = String(body.model ?? "").trim();
  if (!ALLOWED_MODELS.has(model)) {
    return NextResponse.json({ error: "Model not allowed." }, { status: 400 });
  }

  const parts = Array.isArray(body.parts) ? body.parts : [];
  const cleanParts = parts
    .map((p) => {
      if (typeof p?.text === "string") return { text: p.text };
      if (p?.inlineData && typeof p.inlineData.data === "string" && typeof p.inlineData.mimeType === "string") {
        return { inline_data: { mime_type: p.inlineData.mimeType, data: p.inlineData.data } };
      }
      return null;
    })
    .filter(Boolean);
  if (cleanParts.length === 0) {
    return NextResponse.json({ error: "Nothing to generate from." }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    contents: [{ role: "user", parts: cleanParts }],
  };
  if (body.systemInstruction && typeof body.systemInstruction === "string") {
    payload.systemInstruction = { parts: [{ text: body.systemInstruction }] };
  }
  if (body.generationConfig && typeof body.generationConfig === "object") {
    payload.generationConfig = body.generationConfig;
  }

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
      },
    );
  } catch (e) {
    console.error("[ai/generate] fetch:", e);
    return NextResponse.json({ error: "AI service unreachable." }, { status: 502 });
  }

  const json = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  } | null;

  if (!res.ok) {
    console.error("[ai/generate] Gemini error:", res.status, json?.error?.message);
    return NextResponse.json({ error: "AI request failed." }, { status: 502 });
  }

  const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return NextResponse.json({ text });
}
