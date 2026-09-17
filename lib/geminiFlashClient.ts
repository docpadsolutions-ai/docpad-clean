/**
 * Browser-safe Gemini client.
 *
 * Mirrors the small part of the `@google/generative-ai` API the app uses
 * (`getGenerativeModel(...).generateContent(...)` → `result.response.text()`),
 * but sends the request to our authenticated `/api/ai/generate` route so the
 * Gemini API key never reaches the browser.
 */

type InlinePart = { inlineData: { mimeType: string; data: string } };
type TextPart = { text: string };
type Part = TextPart | InlinePart;

type ModelParams = {
  model: string;
  systemInstruction?: string;
  generationConfig?: Record<string, unknown>;
};

type GenerateResult = { response: { text: () => string } };

function toParts(input: string | Part | (string | Part)[]): Part[] {
  const arr = Array.isArray(input) ? input : [input];
  return arr.map((p) => (typeof p === "string" ? { text: p } : p));
}

class ProxiedGenerativeModel {
  constructor(private readonly params: ModelParams) {}

  async generateContent(input: string | Part | (string | Part)[]): Promise<GenerateResult> {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        model: this.params.model,
        systemInstruction: this.params.systemInstruction,
        generationConfig: this.params.generationConfig,
        parts: toParts(input),
      }),
    });
    const json = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
    if (!res.ok || typeof json?.text !== "string") {
      throw new Error(json?.error || `AI request failed (${res.status})`);
    }
    const text = json.text;
    return { response: { text: () => text } };
  }
}

export const geminiFlashClient = {
  getGenerativeModel(params: ModelParams) {
    return new ProxiedGenerativeModel(params);
  },
};
