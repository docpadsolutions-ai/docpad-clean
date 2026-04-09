"use client";

import { useEffect, useRef, useState } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { StreamingTranscriber } from "assemblyai";
import type { TurnEvent } from "assemblyai";
import { ASSEMBLYAI_CLINICAL_WORD_BOOST } from "../lib/assemblyaiVoiceConfig";
import { scrubExaminationFindingsAgainstTranscript } from "../lib/examFindingTranscriptScrub";

// ─── Gemini client — initialised once at module level ─────────────────────────

const genAI = new GoogleGenerativeAI(
  process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? ""
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClinicalFinding = {
  finding:   string;
  // Complaint context
  duration:  string | null;
  severity:  string | null;
  // Examination context
  location:  string | null;
  qualifier: string | null;
};

/** Gemini output when `contextType === "diagnosis"` */
export type DiagnosisExtractionRow = { diagnosis: string };

/** Gemini output when `contextType === "plan"` */
export type PlanMedicationRow = {
  name:      string;
  dosage:    string;
  frequency: string;
  duration:  string;
};
export type PlanExtractionResult = {
  medications:     PlanMedicationRow[];
  investigations:  string[];
  advice:          string[];
};

type Status = "idle" | "recording" | "error";

type Props = {
  contextType: string;
  /**
   * Called on every streaming transcript update.
   * isFinal=false → interim hypothesis (stream into UI live).
   * isFinal=true  → confirmed utterance (commit to state).
   */
  onTranscriptUpdate: (text: string, isFinal: boolean) => void;
  /**
   * Optional. Fired once after recording stops and Gemini has extracted data.
   * Shape depends on `contextType`: ClinicalFinding[] | DiagnosisExtractionRow[] | PlanExtractionResult
   */
  onExtractionComplete?: (payload: unknown) => void;
  className?: string;
};

// ─── Gemini extraction ────────────────────────────────────────────────────────

function parseJsonResponse(raw: string): unknown {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

async function extractClinicalData(text: string, contextType: string): Promise<unknown> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  let prompt: string;

  if (contextType === "examination") {
    prompt = `You are a clinical AI assisting a doctor. Extract physical examination findings from this transcript. Return a flat JSON array of objects. Keys: 'finding', 'location' (anatomical site or null), 'qualifier' (e.g., 'Positive', 'Mild', or null).

STRICT:
- Every substantive word in 'finding' MUST appear in the transcript (case-insensitive). Do NOT add anatomy or adjectives the doctor did not say (e.g. do not say "nipple", "conjunctival", "nasal", "rectal" unless those words appear in the transcript).
- You may only normalize spelling for phrases that ARE said (e.g. "Crepitations" for "crepitus", "Wheezing" for "wheeze", "Erythema" for "redness").
- Put the body site ONLY in 'location', never in 'finding'.

Transcript: "${text}"`;
  } else if (contextType === "diagnosis") {
    prompt = `Extract the definitive working diagnoses from this transcript. Return a flat JSON array of objects with the key: "diagnosis". Transcript: "${text}"`;
  } else if (contextType === "plan") {
    prompt = `Extract the treatment plan from this transcript. Return a single JSON object with three distinct arrays:
1. "medications" (array of objects with keys: "name", "dosage", "frequency", "duration")
2. "investigations" (array of strings, e.g. "X-ray Right Knee AP/Lat", "MRI Lumbar Spine")
3. "advice" (array of strings for general instructions, e.g. "Physiotherapy for 2 weeks", "Strict bed rest")

Use empty arrays when a section has no items. Transcript: "${text}"`;
  } else {
    // complaint (default) and any other context that expects symptom extraction
    prompt = `Extract every distinct medical finding mentioned in the transcript below.
Return a JSON array where each element has exactly these keys:
  "finding"   – the symptom / complaint in plain English (string, required)
  "duration"  – how long the patient has had it, e.g. "3 days" (string or null)
  "severity"  – mild / moderate / severe if mentioned (string or null)
  "location"  – always null
  "qualifier" – always null

If no findings are present return [].
Transcript: "${text}"`;
  }

  const result = await model.generateContent(prompt);
  const raw    = result.response.text().trim();
  const parsed = parseJsonResponse(raw);

  if (contextType === "plan") {
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      return {
        medications:    Array.isArray(o.medications)    ? o.medications    : [],
        investigations: Array.isArray(o.investigations) ? o.investigations : [],
        advice:         Array.isArray(o.advice)         ? o.advice         : [],
      } satisfies PlanExtractionResult;
    }
    return { medications: [], investigations: [], advice: [] } satisfies PlanExtractionResult;
  }

  if (Array.isArray(parsed)) return parsed as ClinicalFinding[] | DiagnosisExtractionRow[];
  return [];
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VoiceDictationButton({
  contextType,
  onTranscriptUpdate,
  onExtractionComplete,
  className = "",
}: Props) {
  const [status, setStatus]         = useState<Status>("idle");
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [liveText, setLiveText]     = useState("");
  const [isExtracting, setIsExtracting] = useState(false);

  const streamRef           = useRef<MediaStream | null>(null);
  const transcriberRef      = useRef<StreamingTranscriber | null>(null);
  const audioContextRef     = useRef<AudioContext | null>(null);
  const processorRef        = useRef<ScriptProcessorNode | null>(null);
  const sourceRef           = useRef<MediaStreamAudioSourceNode | null>(null);
  const muteGainRef         = useRef<GainNode | null>(null);
  const errorPopoverRef     = useRef<HTMLDivElement>(null);
  const finalTranscriptRef  = useRef<string>("");

  useEffect(() => {
    if (status === "idle" || status === "error") {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
  }, [status]);

  useEffect(() => {
    if (status !== "error") return;
    function onClickOutside(e: MouseEvent) {
      if (errorPopoverRef.current && !errorPopoverRef.current.contains(e.target as Node)) {
        reset();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function disconnectAudioPipeline() {
    try {
      processorRef.current?.disconnect();
      muteGainRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    processorRef.current = null;
    muteGainRef.current = null;
    sourceRef.current = null;

    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") {
      void ctx.close();
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    setErrorMsg(null);
    setLiveText("");
    finalTranscriptRef.current = "";

    try {
      const tokenRes = await fetch("/api/voice/assemblyai-token");
      if (!tokenRes.ok) {
        const body = (await tokenRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not start transcription session.");
      }
      const { token } = (await tokenRes.json()) as { token?: string };
      if (!token?.trim()) {
        throw new Error("Invalid transcription token.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Web Audio API is not available in this browser.");
      }

      const audioContext = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const sampleRate = audioContext.sampleRate;

      const transcriber = new StreamingTranscriber({
        token: token.trim(),
        sampleRate,
        encoding: "pcm_s16le",
        speechModel: "u3-rt-pro",
        domain: "medical-v1",
        keytermsPrompt: [...ASSEMBLYAI_CLINICAL_WORD_BOOST],
      });
      transcriberRef.current = transcriber;

      transcriber.on("turn", (msg: TurnEvent) => {
        const text = msg.transcript?.trim() ?? "";
        if (!text) return;
        const isFinal = Boolean(msg.end_of_turn);
        setLiveText(text);
        onTranscriptUpdate(text, isFinal);
        if (isFinal) {
          finalTranscriptRef.current = (finalTranscriptRef.current + " " + text).trim();
        }
      });

      transcriber.on("error", (err) => {
        setErrorMsg(err.message || "Connection to transcription service failed.");
        setStatus("error");
      });

      await transcriber.connect();

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const bufferSize = 2048;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
        }
        try {
          transcriber.sendAudio(pcm.buffer);
        } catch {
          /* socket may be closing */
        }
      };

      const mute = audioContext.createGain();
      mute.gain.value = 0;
      muteGainRef.current = mute;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(audioContext.destination);

      setStatus("recording");
    } catch (err) {
      disconnectAudioPipeline();
      transcriberRef.current = null;
      const message =
        err instanceof Error
          ? err.message
          : "Could not access the microphone. Please check your device.";
      const friendly =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was denied. Please allow it in your browser settings."
          : message;
      setErrorMsg(friendly);
      setStatus("error");
    }
  }

  async function stopRecordingAndExtract() {
    setStatus("idle");
    setLiveText("");

    const transcriber = transcriberRef.current;
    transcriberRef.current = null;

    disconnectAudioPipeline();

    if (transcriber) {
      try {
        await transcriber.close(true);
      } catch (e) {
        console.error("[VoiceDictation] AssemblyAI close:", e);
      }
    }

    const fullText = finalTranscriptRef.current.trim();
    finalTranscriptRef.current = "";

    if (fullText && onExtractionComplete) {
      setIsExtracting(true);
      extractClinicalData(fullText, contextType)
        .then((result) => {
          if (contextType === "plan") {
            const p = result as PlanExtractionResult;
            const hasData =
              (p.medications?.length ?? 0) > 0 ||
              (p.investigations?.length ?? 0) > 0 ||
              (p.advice?.length ?? 0) > 0;
            if (hasData) {
              onExtractionComplete(result);
            }
          } else if (Array.isArray(result) && result.length > 0) {
            let rows = result as ClinicalFinding[];
            if (contextType === "examination") {
              rows = scrubExaminationFindingsAgainstTranscript(rows, fullText) as ClinicalFinding[];
            }
            onExtractionComplete(rows);
          }
        })
        .catch((err) => console.error("Gemini extraction failed:", err))
        .finally(() => setIsExtracting(false));
    }
  }

  function handleMicClick() {
    if (status === "idle" || status === "error") {
      void startRecording();
    } else if (status === "recording") {
      void stopRecordingAndExtract();
    }
  }

  function reset() {
    const t = transcriberRef.current;
    transcriberRef.current = null;
    disconnectAudioPipeline();
    if (t) {
      void t.close(false).catch(() => {});
    }
    setStatus("idle");
    setLiveText("");
    setErrorMsg(null);
    finalTranscriptRef.current = "";
  }

  if (status === "error") {
    return (
      <div ref={errorPopoverRef} className={`relative z-20 ${className}`}>
        <button
          type="button"
          onClick={handleMicClick}
          title="Retry voice dictation"
          aria-label="Retry voice dictation"
          className="inline-flex items-center justify-center rounded-lg p-1.5 text-red-400 transition hover:bg-red-50 hover:text-red-600"
        >
          <MicIcon className="h-4 w-4" />
        </button>
        {errorMsg && (
          <div className="absolute left-0 top-8 z-20 w-64 rounded-xl border border-red-200 bg-red-50 p-3 shadow-xl">
            <p className="text-[11px] font-semibold text-red-700">{errorMsg}</p>
            <button
              type="button"
              onClick={reset}
              className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:underline"
            >
              <XIcon className="h-3 w-3" /> Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status === "recording") {
    return (
      <div className={`relative inline-flex flex-col items-end ${className}`}>
        {liveText && (
          <div
            aria-live="polite"
            className="absolute bottom-full mb-1.5 right-0 z-20 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-gray-800/90 px-2.5 py-1 text-[11px] leading-tight text-white shadow-lg"
          >
            {liveText}
          </div>
        )}
        <button
          type="button"
          onClick={handleMicClick}
          title="Click to stop recording"
          aria-label="Stop recording"
          className="relative inline-flex items-center justify-center rounded-lg p-1.5 text-red-500 transition hover:bg-red-50"
        >
          <span className="absolute inset-0 animate-ping rounded-lg bg-red-400 opacity-30" aria-hidden />
          <MicIcon className="relative h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-0.5 ${className}`}>
      <button
        type="button"
        onClick={handleMicClick}
        title={`Voice dictation — ${contextType}`}
        aria-label={`Start voice dictation for ${contextType}`}
        className="inline-flex items-center justify-center rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
      >
        <MicIcon className="h-4 w-4" />
      </button>
      {isExtracting && (
        <span
          title="Extracting clinical findings…"
          className="animate-pulse text-[13px] text-purple-500"
        >
          ✨
        </span>
      )}
    </div>
  );
}
