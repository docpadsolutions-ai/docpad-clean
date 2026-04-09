import { AssemblyAI } from "assemblyai";
import { NextResponse } from "next/server";

/**
 * Short-lived token for browser StreamingTranscriber (API keys must not run in the client).
 *
 * Uses `client.streaming.createTemporaryToken` (v3 Streaming STT). The legacy v2
 * `api.assemblyai.com/v2/realtime/token` flow is not used for current keys.
 * https://www.assemblyai.com/docs/api-reference/streaming-api/generate-streaming-token
 */
export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("[voice/assemblyai-token] ASSEMBLYAI_API_KEY is not set.");
    return NextResponse.json(
      { error: "Transcription service is not configured. Contact your admin." },
      { status: 503 },
    );
  }

  try {
    const client = new AssemblyAI({ apiKey });
    const token = await client.streaming.createTemporaryToken({
      expires_in_seconds: 480,
    });

    if (!token) {
      console.error("[voice/assemblyai-token] Missing token from streaming API");
      return NextResponse.json({ error: "Could not create streaming token." }, { status: 502 });
    }

    return NextResponse.json({ token });
  } catch (e) {
    console.error("[voice/assemblyai-token]", e);
    return NextResponse.json({ error: "Could not create streaming token." }, { status: 502 });
  }
}
