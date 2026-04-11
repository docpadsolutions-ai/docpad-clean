import { geminiFlashClient } from "@/app/lib/geminiFlashClient";

function parseJsonResponse(raw: string): unknown {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export type DischargeNlpExtraction = {
  diagnoses: string[];
  procedures: string[];
  key_events: string[];
  discharge_condition: "stable" | "improved" | "lama" | "expired" | null;
  implants: string[];
};

const SYSTEM_PROMPT = `You are a clinical NLP assistant processing a hospital discharge note.
Extract from the following text:

Final diagnoses (primary first, then secondary) — return as array of strings
Procedures performed — return as array of strings
Key clinical events during admission (max 5 bullet points)
Discharge condition (one of: stable, improved, lama, expired)
Any implants or devices mentioned

Return JSON only:
{
"diagnoses": ["string"],
"procedures": ["string"],
"key_events": ["string"],
"discharge_condition": "stable|improved|lama|expired|null",
"implants": ["string"]
}`;

function normalizeExtraction(raw: unknown): DischargeNlpExtraction {
  const empty: DischargeNlpExtraction = {
    diagnoses: [],
    procedures: [],
    key_events: [],
    discharge_condition: null,
    implants: [],
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  const dcRaw = o.discharge_condition != null ? String(o.discharge_condition).toLowerCase().trim() : "";
  let discharge_condition: DischargeNlpExtraction["discharge_condition"] = null;
  if (dcRaw === "stable" || dcRaw === "improved" || dcRaw === "lama" || dcRaw === "expired") {
    discharge_condition = dcRaw;
  }
  return {
    diagnoses: strArr(o.diagnoses),
    procedures: strArr(o.procedures),
    key_events: strArr(o.key_events).slice(0, 5),
    discharge_condition,
    implants: strArr(o.implants),
  };
}

/** Gemini 2.5 Flash — same model pattern as VoiceDictationButton / IPD notes. */
export async function extractDischargeClinicalNlp(noteText: string): Promise<DischargeNlpExtraction> {
  const text = noteText.trim();
  if (!text) {
    return normalizeExtraction({});
  }
  const model = geminiFlashClient.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.05,
      responseMimeType: "application/json",
    },
  });
  const result = await model.generateContent(text);
  const raw = result.response.text().trim();
  const parsed = parseJsonResponse(raw);
  return normalizeExtraction(parsed);
}
