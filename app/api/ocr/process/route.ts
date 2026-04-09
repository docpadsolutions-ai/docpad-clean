import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "../../../lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

type ProcessBody = {
  storage_path?: string;
  investigation_ocr_upload_id?: string;
  mime_type?: string;
};

type OcrLine = { text: string; confidence: number };

type GeminiLabRow = {
  parameter_name?: string;
  result_value?: string;
  unit?: string;
  reference_range?: string;
  is_abnormal?: boolean;
};

const LAB_PARSER_PROMPT = `You are a medical lab report parser. Extract all test results from this lab report image. Return ONLY valid JSON array:
[
  {
    "parameter_name": "INR Value",
    "result_value": "1.56",
    "unit": "",
    "reference_range": "2.0-3.0",
    "is_abnormal": false
  }
]
Include every test parameter found. No explanation, no markdown.`;

function geminiMimeForInlineData(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  const allowed = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
  ]);
  if (allowed.has(m)) return m === "image/jpg" ? "image/jpeg" : m;
  return "image/jpeg";
}

function extractJsonArrayFromGeminiText(text: string): GeminiLabRow[] {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fence) t = fence[1]!.trim();

  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start >= 0 && end > start) {
    t = t.slice(start, end + 1);
  }

  const parsed = JSON.parse(t) as unknown;
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.filter((x) => x && typeof x === "object") as GeminiLabRow[];
}

export async function POST(req: NextRequest) {
  let body: ProcessBody;
  try {
    body = (await req.json()) as ProcessBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const storagePath = (body.storage_path ?? "").trim();
  const uploadId = (body.investigation_ocr_upload_id ?? "").trim();
  const mimeTypeRaw = (body.mime_type ?? "image/jpeg").trim() || "image/jpeg";

  if (!storagePath || !uploadId) {
    return NextResponse.json(
      { error: "storage_path and investigation_ocr_upload_id are required." },
      { status: 400 },
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error("[ocr/process] Missing NEXT_PUBLIC_GEMINI_API_KEY.");
    return NextResponse.json(
      { error: "OCR service is not configured on the server." },
      { status: 503 },
    );
  }

  let admin;
  try {
    admin = createSupabaseAdmin();
  } catch (e) {
    console.error("[ocr/process] Supabase admin:", e);
    return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  }

  const { data: uploadRow, error: upErr } = await admin
    .from("investigation_ocr_uploads")
    .select("id, storage_path, hospital_id")
    .eq("id", uploadId)
    .maybeSingle();

  if (upErr || !uploadRow) {
    return NextResponse.json({ error: "OCR upload record not found." }, { status: 404 });
  }
  const row = uploadRow as { id: string; storage_path: string; hospital_id?: string | null };
  if (row.storage_path !== storagePath) {
    return NextResponse.json({ error: "Storage path does not match upload record." }, { status: 400 });
  }

  const { data: fileBlob, error: dlErr } = await admin.storage.from("investigation-reports").download(storagePath);
  if (dlErr || !fileBlob) {
    console.error("[ocr/process] Storage download:", dlErr?.message);
    return NextResponse.json({ error: "Failed to load file from storage." }, { status: 502 });
  }

  const buf = Buffer.from(await fileBlob.arrayBuffer());
  const base64Image = buf.toString("base64");
  const inlineMime = geminiMimeForInlineData(mimeTypeRaw);

  const modelId =
    process.env.GEMINI_OCR_MODEL?.trim() || "gemini-2.5-flash";
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
              { text: LAB_PARSER_PROMPT },
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
    console.error("[ocr/process] Gemini fetch failed:", e);
    return NextResponse.json({ error: "OCR provider unreachable." }, { status: 502 });
  }

  const geminiJson = (await geminiRes.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string; code?: number };
  };

  if (!geminiRes.ok) {
    const msg = geminiJson.error?.message ?? `Gemini status ${geminiRes.status}`;
    console.error("[ocr/process] Gemini error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const text =
    geminiJson.candidates?.[0]?.content?.parts
      ?.map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("") ?? "";

  if (!text.trim()) {
    return NextResponse.json({ error: "Empty response from OCR model." }, { status: 502 });
  }

  let rows: GeminiLabRow[];
  try {
    rows = extractJsonArrayFromGeminiText(text);
  } catch (e) {
    console.error("[ocr/process] JSON parse failed:", e, text.slice(0, 500));
    return NextResponse.json(
      { error: "Could not parse lab results from model output. Try again or add rows manually." },
      { status: 502 },
    );
  }

  const fields = rows.map((r) => {
    const name = String(r.parameter_name ?? "").trim();
    const value = String(r.result_value ?? "").trim();
    const abnormal = Boolean(r.is_abnormal);
    const conf = abnormal ? 0.75 : 0.9;
    return {
      name: name || "Parameter",
      value,
      confidence: conf,
      unit: String(r.unit ?? "").trim(),
      reference_range: String(r.reference_range ?? "").trim(),
      is_abnormal: abnormal,
    };
  });

  const raw_text = fields.map((f) => `${f.name}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`).join("\n");
  const lines: OcrLine[] = fields.map((f) => ({
    text: `${f.name}: ${f.value}`,
    confidence: f.confidence,
  }));

  return NextResponse.json({
    raw_text,
    lines,
    fields: fields.map((f) => ({
      name: f.name,
      value: f.value,
      confidence: f.confidence,
      unit: f.unit,
      reference_range: f.reference_range,
      is_abnormal: f.is_abnormal,
    })),
  });
}
