import { ensureJpegForOcrUpload } from "@/app/lib/ocrImageConvert";
import { geminiFlashClient } from "@/app/lib/geminiFlashClient";

const CONSENT_EXTRACTION_PROMPT = `This is a hospital consent form. Extract the full text exactly as written, preserving paragraph structure and headings. Replace any patient-specific details like names, dates, MRN numbers with these placeholders: {patient_name}, {doctor_name}, {procedure_name}, {hospital_name}, {date}. Return only the cleaned consent text, nothing else.`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function normalizeGeminiImageMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  if (m === "image/jpg") return "image/jpeg";
  if (m === "image/png" || m === "image/jpeg" || m === "image/webp" || m === "image/gif") return m;
  return "image/jpeg";
}

/**
 * Prepares a file for Gemini vision: raster images as JPEG/PNG base64; PDF as application/pdf base64 (first doc sent whole — Gemini parses pages).
 */
export async function fileToGeminiInlinePart(file: File): Promise<{ data: string; mimeType: string }> {
  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  if (isPdf) {
    const buf = await file.arrayBuffer();
    return { data: arrayBufferToBase64(buf), mimeType: "application/pdf" };
  }
  const prepared = await ensureJpegForOcrUpload(file);
  const buf = await prepared.arrayBuffer();
  const mimeType = normalizeGeminiImageMime(prepared.type || file.type || "image/jpeg");
  return { data: arrayBufferToBase64(buf), mimeType };
}

export async function extractConsentFormTextFromFile(file: File): Promise<string> {
  if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim()) {
    throw new Error("Gemini API key is not configured.");
  }
  const { data, mimeType } = await fileToGeminiInlinePart(file);
  const model = geminiFlashClient.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.1 },
  });
  const result = await model.generateContent([
    { text: CONSENT_EXTRACTION_PROMPT },
    { inlineData: { mimeType, data } },
  ]);
  const raw = result.response.text()?.trim() ?? "";
  if (!raw) throw new Error("Empty response from extraction.");
  return raw;
}

/** First line / heading as display name for consent template. */
export function inferConsentDisplayNameFromText(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  let title = lines[0]!.replace(/^#+\s*/, "").trim();
  if (!title) return null;
  if (title.length > 180) title = `${title.slice(0, 177)}…`;
  return title;
}

/**
 * Maps extracted text to `ipd_consent_types.category` when keywords match; otherwise returns null (leave existing).
 */
export function inferConsentCategoryFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("anaesthesia") || t.includes("anesthesia")) return "anaesthesia";
  if (t.includes("blood") || t.includes("transfusion")) return "blood_transfusion";
  if (t.includes("surgery") || t.includes("procedure")) return "surgical";
  if (t.includes("admission")) return "admission";
  return null;
}

export function isAllowedConsentOcrFile(file: File): boolean {
  const n = file.name.toLowerCase();
  const t = file.type.toLowerCase();
  if (t === "application/pdf" || n.endsWith(".pdf")) return true;
  if (t === "image/jpeg" || t === "image/jpg" || t === "image/png") return true;
  return /\.(jpe?g|png|pdf)$/i.test(n);
}
