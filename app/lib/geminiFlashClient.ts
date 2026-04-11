import { GoogleGenerativeAI } from "@google/generative-ai";

/** Shared Gemini client for browser-side Flash calls (same API key as VoiceDictationButton). */
export const geminiFlashClient = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? "");
