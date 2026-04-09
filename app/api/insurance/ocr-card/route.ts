import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const INSURANCE_CARD_PROMPT = `You are an expert at reading health insurance ID cards (India and international).
Analyze the image(s). One image may be the front and another the back — combine information from both.

Return ONLY a single JSON object (no markdown, no code fence) with exactly these keys:
{
  "policy_number": "string or empty",
  "member_id": "subscriber/member id or empty",
  "insurance_name": "payer/insurer company name as printed on the card or empty",
  "valid_until": "YYYY-MM-DD if an expiry/valid-through date is visible, else empty string"
}

Use ISO date for valid_until. If unsure, use empty string for any field.`;

type OcrBody = {
  front_image_base64?: string;
  back_image_base64?: string;
  mime_type?: string;
};

function geminiMimeForInlineData(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  const allowed = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]);
  if (allowed.has(m)) return m === "image/jpg" ? "image/jpeg" : m;
  return "image/jpeg";
}

function extractJsonObject(text: string): Record<string, unknown> {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const parsed = JSON.parse(t) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 503 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: OcrBody;
  try {
    body = (await req.json()) as OcrBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const front = (body.front_image_base64 ?? "").replace(/\s/g, "");
  const back = (body.back_image_base64 ?? "").replace(/\s/g, "");
  if (!front && !back) {
    return NextResponse.json({ error: "Provide at least one of front_image_base64 or back_image_base64." }, { status: 400 });
  }

  const maxB64 = 12 * 1024 * 1024;
  if (front.length > maxB64 || back.length > maxB64) {
    return NextResponse.json({ error: "Image payload too large." }, { status: 413 });
  }

  const mimeRaw = (body.mime_type ?? "image/jpeg").trim() || "image/jpeg";
  const inlineMime = geminiMimeForInlineData(mimeRaw);

  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "OCR is not configured (Gemini API key missing)." }, { status: 503 });
  }

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
    { text: INSURANCE_CARD_PROMPT },
  ];
  if (front) {
    parts.push({ inline_data: { mime_type: inlineMime, data: front } });
  }
  if (back) {
    parts.push({ inline_data: { mime_type: inlineMime, data: back } });
  }

  const modelId = process.env.GEMINI_OCR_MODEL?.trim() || "gemini-2.5-flash";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let geminiRes: Response;
  try {
    geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
      }),
    });
  } catch {
    return NextResponse.json({ error: "OCR provider unreachable." }, { status: 502 });
  }

  const geminiJson = (await geminiRes.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  if (!geminiRes.ok) {
    const msg = geminiJson.error?.message ?? `Gemini ${geminiRes.status}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const text =
    geminiJson.candidates?.[0]?.content?.parts
      ?.map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("") ?? "";

  if (!text.trim()) {
    return NextResponse.json({ error: "Empty model response." }, { status: 502 });
  }

  let obj: Record<string, unknown>;
  try {
    obj = extractJsonObject(text);
  } catch {
    return NextResponse.json(
      { error: "Could not parse insurance fields from model output.", raw_preview: text.slice(0, 400) },
      { status: 502 },
    );
  }

  const policy_number = String(obj.policy_number ?? "").trim();
  const member_id = String(obj.member_id ?? "").trim();
  const insurance_name = String(obj.insurance_name ?? "").trim();
  let valid_until = String(obj.valid_until ?? "").trim();
  if (valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(valid_until)) {
    valid_until = "";
  }

  return NextResponse.json({
    policy_number,
    member_id,
    insurance_name,
    valid_until: valid_until || null,
  });
}
