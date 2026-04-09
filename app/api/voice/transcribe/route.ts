import { AssemblyAI } from "assemblyai";
import { NextRequest, NextResponse } from "next/server";
import orthoVocab from "../../../../lib/snomed-ortho-vocabulary.json";
import generalVocab from "../../../../lib/snomed-general-vocabulary.json";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const context = (formData.get("context") as string | null) ?? "unknown";

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No audio file received." }, { status: 400 });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("[voice/transcribe] ASSEMBLYAI_API_KEY is not set.");
    return NextResponse.json(
      { error: "Transcription service is not configured. Contact your admin." },
      { status: 503 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const wordBoost =
    req.nextUrl.searchParams.get("specialty") === "ortho" ? orthoVocab : generalVocab;

  try {
    const client = new AssemblyAI({ apiKey });
    const transcript = await client.transcripts.transcribe({
      audio: buffer,
      word_boost: wordBoost,
      language_code: "en_in",
      domain: "medical-v1",
    });

    if (transcript.status === "error") {
      const err = transcript.error ?? "Transcription failed.";
      console.error(`[voice/transcribe] AssemblyAI error: ${err}`);
      return NextResponse.json({ error: String(err) }, { status: 502 });
    }

    const text = transcript.text?.trim() ?? "";
    console.log(`[voice/transcribe] context=${context} extracted transcript length=${text.length}`);
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[voice/transcribe]", err);
    return NextResponse.json(
      { error: "Network error while reaching the transcription service." },
      { status: 502 },
    );
  }
}
