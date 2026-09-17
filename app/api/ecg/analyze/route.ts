import { NextRequest, NextResponse } from "next/server";
import { requireStaff, getGeminiApiKey } from "@/app/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const ECG_VISION_PROMPT = `You are analyzing a photograph of a standard 12-lead ECG printout.
Read all visible printed values and waveform interpretation text.
Return ONLY valid JSON (no markdown) with this exact shape:
{
  "heart_rate_bpm": number | null,
  "pr_interval_ms": number | null,
  "qrs_duration_ms": number | null,
  "qt_interval_ms": number | null,
  "qtc_interval_ms": number | null,
  "axis": string | null,
  "rhythm_interpretation": string | null,
  "footer": {
    "speed_mm_per_sec": string | null,
    "limb_gain_mm_per_mv": string | null,
    "chest_gain_mm_per_mv": string | null,
    "raw_footer_text": string | null
  }
}
Use null for any field you cannot read clearly. For footer strings, copy labels as printed (e.g. "25 mm/s", "10 mm/mV").`;

function geminiMimeForInlineData(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  const allowed = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
  ]);
  if (allowed.has(m)) return m === "image/jpg" ? "image/jpeg" : m;
  return "image/jpeg";
}

function extractJsonObject(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as unknown;
}

export type EcgVisionResult = {
  heart_rate_bpm: number | null;
  pr_interval_ms: number | null;
  qrs_duration_ms: number | null;
  qt_interval_ms: number | null;
  qtc_interval_ms: number | null;
  axis: string | null;
  rhythm_interpretation: string | null;
  footer: {
    speed_mm_per_sec: string | null;
    limb_gain_mm_per_mv: string | null;
    chest_gain_mm_per_mv: string | null;
    raw_footer_text: string | null;
  };
};

export async function POST(req: NextRequest) {
  const gate = await requireStaff();
  if (!gate.ok) return gate.response;
  let body: {
    imageUrl?: string;
    imageBase64?: string;
    mimeType?: string;
    investigationId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ECG vision is not configured (missing GEMINI_API_KEY)." },
      { status: 503 },
    );
  }

  let buf: Buffer;
  let inlineMime: string;

  const b64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
  if (b64.length > 0) {
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid imageBase64." }, { status: 400 });
    }
    if (buf.length < 64) {
      return NextResponse.json({ error: "Image payload too small." }, { status: 400 });
    }
    inlineMime = geminiMimeForInlineData(body.mimeType ?? "image/jpeg");
  } else {
    const imageUrl = (body.imageUrl ?? "").trim();
    // Only fetch images from this project's Supabase Storage (prevents the server being used to fetch arbitrary URLs).
    let allowedHost = "";
    try {
      allowedHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
    } catch {
      allowedHost = "";
    }
    let imageHostOk = false;
    try {
      const u = new URL(imageUrl);
      imageHostOk = u.protocol === "https:" && !!allowedHost && u.host === allowedHost;
    } catch {
      imageHostOk = false;
    }
    if (!imageHostOk) {
      return NextResponse.json({ error: "imageUrl must point to this project's storage." }, { status: 400 });
    }
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json(
        { error: "Provide a valid imageUrl or imageBase64." },
        { status: 400 },
      );
    }

    let imgRes: Response;
    try {
      imgRes = await fetch(imageUrl, { cache: "no-store", redirect: "error" });
    } catch (e) {
      console.error("[ecg/analyze] image fetch:", e);
      return NextResponse.json({ error: "Failed to download image." }, { status: 502 });
    }

    if (!imgRes.ok) {
      return NextResponse.json(
        { error: `Image download failed (${imgRes.status}).` },
        { status: 502 },
      );
    }

    buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length < 64) {
      return NextResponse.json({ error: "Image payload too small." }, { status: 400 });
    }

    const ct = imgRes.headers.get("content-type") ?? "image/jpeg";
    inlineMime = geminiMimeForInlineData(ct);
  }

  const base64Image = buf.toString("base64");

  const modelId = process.env.GEMINI_ECG_MODEL?.trim() || "gemini-2.5-flash";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let geminiRes: Response;
  try {
    geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: ECG_VISION_PROMPT },
              {
                inline_data: {
                  mime_type: inlineMime,
                  data: base64Image,
                },
              },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    console.error("[ecg/analyze] Gemini fetch failed:", e);
    return NextResponse.json({ error: "Gemini unreachable." }, { status: 502 });
  }

  const geminiJson = (await geminiRes.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  if (!geminiRes.ok) {
    const msg = geminiJson.error?.message ?? `Gemini status ${geminiRes.status}`;
    console.error("[ecg/analyze] Gemini error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const text =
    geminiJson.candidates?.[0]?.content?.parts
      ?.map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("") ?? "";

  if (!text.trim()) {
    return NextResponse.json({ error: "Empty response from model." }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch (e) {
    console.error("[ecg/analyze] JSON parse failed:", e, text.slice(0, 600));
    return NextResponse.json({ error: "Could not parse ECG analysis JSON." }, { status: 502 });
  }

  const o = parsed as Record<string, unknown>;
  const footer = (o.footer && typeof o.footer === "object" ? o.footer : {}) as Record<string, unknown>;

  const result: EcgVisionResult = {
    heart_rate_bpm: typeof o.heart_rate_bpm === "number" ? o.heart_rate_bpm : null,
    pr_interval_ms: typeof o.pr_interval_ms === "number" ? o.pr_interval_ms : null,
    qrs_duration_ms: typeof o.qrs_duration_ms === "number" ? o.qrs_duration_ms : null,
    qt_interval_ms: typeof o.qt_interval_ms === "number" ? o.qt_interval_ms : null,
    qtc_interval_ms: typeof o.qtc_interval_ms === "number" ? o.qtc_interval_ms : null,
    axis: typeof o.axis === "string" ? o.axis : null,
    rhythm_interpretation:
      typeof o.rhythm_interpretation === "string" ? o.rhythm_interpretation : null,
    footer: {
      speed_mm_per_sec:
        typeof footer.speed_mm_per_sec === "string" ? footer.speed_mm_per_sec : null,
      limb_gain_mm_per_mv:
        typeof footer.limb_gain_mm_per_mv === "string" ? footer.limb_gain_mm_per_mv : null,
      chest_gain_mm_per_mv:
        typeof footer.chest_gain_mm_per_mv === "string" ? footer.chest_gain_mm_per_mv : null,
      raw_footer_text:
        typeof footer.raw_footer_text === "string" ? footer.raw_footer_text : null,
    },
  };

  return NextResponse.json({ analysis: result, investigationId: body.investigationId ?? null });
}
