"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { StreamingTranscriber } from "assemblyai";
import { geminiFlashClient } from "../lib/geminiFlashClient";
import type { TurnEvent } from "assemblyai";
import { getSpecialtyWordBoost } from "../lib/assemblyaiVoiceConfig";
import { scrubExaminationFindingsAgainstTranscript } from "../lib/examFindingTranscriptScrub";
import { buildGeminiSystemPrompt, mapVoiceContextToGeminiContext } from "../lib/geminiClinicalPrompt";
import {
  composeBodySiteLabel,
  fetchSnomedForEntity,
  type GeminiEntityRow,
  type SnomedClientHit,
} from "../lib/clinicalVoicePipeline";
import { buildExaminationChipDisplay } from "../lib/clinicalChipTypes";
import { supabase } from "../supabase";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClinicalFinding = {
  finding: string;
  duration: string | null;
  severity: string | null;
  location: string | null;
  qualifier: string | null;
  bodySite?: string | null;
  laterality?: string | null;
  negation?: boolean;
  rawText?: string | null;
  /** When set (e.g. merged ROM), shown as chip text; `finding` stays concise for SNOMED. */
  chipDisplay?: string | null;
  structuredValues?: Record<string, number> | null;
  /** Single numeric measure from voice (degrees, cm, …) when not encoded in structuredValues. */
  value?: number | null;
  unit?: string | null;
  /** Alias for `structuredValues` in some Gemini payloads. */
  romValues?: Record<string, number> | null;
  snomed?: SnomedClientHit | null;
  snomedAlternatives?: SnomedClientHit[];
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

/** AssemblyAI streaming + IPD-style base text merge (plain text, no Gemini). */
function isIpdStreamingVoiceContext(contextType: string): boolean {
  return contextType === "ipd_progress_note" || contextType === "ipd_consult_request";
}

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
  /** Logged-in practitioner specialty — drives Gemini + SNOMED tiering. */
  specialty?: string;
  /** `practitioners.id` for `search_snomed_cached` + frequency RPC. */
  doctorId?: string;
  /** Encounter id — optional persistence to `transcriptions` / `clinical_extractions`. */
  encounterId?: string;
  /** Optional India NRC refset key for SNOMED search (same as encounter env). */
  indiaRefset?: string;
  /**
   * Appended to the Gemini system instruction for `complaint` / `examination` only
   * (same entity schema + SNOMED pipeline as OPD).
   */
  geminiScreenContextAppend?: string;
  /**
   * When `contextType` is `ipd_progress_note` or `ipd_consult_request`, stream the full textarea value as:
   * this base (usually current field text) + newly spoken words. Same AssemblyAI pipeline as OPD.
   */
  ipdVoiceBaseText?: string;
  /**
   * Which IPD SOAP field — drives Gemini + SNOMED branch (complaint / examination / plan),
   * same pipelines as OPD. Persisted `context_type` for extractions is `ipd_progress_note`.
   */
  ipdVoiceField?: "subjective" | "assessment" | "plan";
  /** Idle/hover mic styling — use `slate` on dark clinical panels (IPD progress notes). */
  variant?: "default" | "slate";
  /** Fires when recording starts (true) or stops / resets (false). */
  onRecordingStateChange?: (recording: boolean) => void;
  /**
   * `lucide`: Mic (pulsing red while recording) / MicOff (idle) — e.g. IPD consult modal.
   * Default: built-in SVG mic.
   */
  micVisual?: "default" | "lucide";
  /** Hide the floating interim transcript chip; stream only via `onTranscriptUpdate` (e.g. textarea). */
  hideLiveTranscriptPill?: boolean;
};

// ─── Gemini extraction ────────────────────────────────────────────────────────

function parseJsonResponse(raw: string): unknown {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function parseStructuredValues(raw: unknown): Record<string, number> | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeGeminiEntities(parsed: unknown): GeminiEntityRow[] {
  if (!Array.isArray(parsed)) return [];
  const out: GeminiEntityRow[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const finding = String(o.finding ?? "").trim();
    if (!finding) continue;
    const chipRaw = o.chip_display ?? o.chipDisplay;
    const chip_display =
      chipRaw != null && String(chipRaw).trim() !== "" ? String(chipRaw).trim() : null;
    const fromRomObject = parseStructuredValues(o.rom);
    const fromRom = parseStructuredValues(o.rom_values);
    const fromStruct = parseStructuredValues(o.structured_values);
    let structured_values: Record<string, number> | null = null;
    if (fromRomObject || fromRom || fromStruct) {
      structured_values = {
        ...(fromRomObject ?? {}),
        ...(fromRom ?? {}),
        ...(fromStruct ?? {}),
      };
      if (Object.keys(structured_values).length === 0) structured_values = null;
    }
    let value: number | null = null;
    if (o.value != null) {
      const n = typeof o.value === "number" ? o.value : parseFloat(String(o.value));
      if (Number.isFinite(n)) value = n;
    }
    const unit =
      o.unit != null && String(o.unit).trim() !== "" ? String(o.unit).trim() : null;
    out.push({
      finding,
      bodySite: o.bodySite != null && String(o.bodySite).trim() !== "" ? String(o.bodySite) : null,
      laterality:
        o.laterality != null && String(o.laterality).trim() !== "" ? String(o.laterality) : null,
      negation: Boolean(o.negation),
      duration: o.duration != null ? String(o.duration) : null,
      severity: o.severity != null ? String(o.severity) : null,
      rawText: o.rawText != null ? String(o.rawText) : null,
      chip_display,
      structured_values,
      value,
      unit,
    });
  }
  return out;
}

async function extractStructuredClinicalEntities(
  transcript: string,
  contextType: "complaint" | "examination",
  specialty: string,
  screenContextAppend?: string,
): Promise<GeminiEntityRow[]> {
  const base = buildGeminiSystemPrompt(specialty, mapVoiceContextToGeminiContext(contextType));
  const extra = screenContextAppend?.trim();
  const systemInstruction =
    extra !== undefined && extra.length > 0
      ? `${base}\n\nADDITIONAL CONTEXT (screen-specific):\n${extra}`
      : base;
  const model = geminiFlashClient.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction,
    generationConfig: {
      temperature: 0.05,
      responseMimeType: "application/json",
    },
  });
  const result = await model.generateContent(transcript);
  const raw = result.response.text().trim();
  const parsed = parseJsonResponse(raw);
  return normalizeGeminiEntities(parsed);
}

function mergeIpdFieldText(base: string, sessionExtracted: string): string {
  const b = base.trim();
  const s = sessionExtracted.trim();
  if (!s) return b;
  if (!b) return s;
  return `${b}\n\n${s}`;
}

function formatPlanExtractionForIpdField(p: PlanExtractionResult): string {
  const lines: string[] = [];
  const meds = p.medications ?? [];
  if (meds.length > 0) {
    lines.push(
      "Medications: " +
        meds
          .map((m) =>
            [m.name, m.dosage, m.frequency, m.duration].map((x) => String(x ?? "").trim()).filter(Boolean).join(" "),
          )
          .join("; "),
    );
  }
  const inv = p.investigations ?? [];
  if (inv.length > 0) lines.push("Investigations: " + inv.map((x) => String(x).trim()).filter(Boolean).join("; "));
  const adv = p.advice ?? [];
  if (adv.length > 0) lines.push("Advice: " + adv.map((x) => String(x).trim()).filter(Boolean).join(" "));
  return lines.join("\n");
}

type MergedComplaintExamRow = GeminiEntityRow & {
  snomed: SnomedClientHit | null;
  snomedAlternatives: SnomedClientHit[];
};

async function runComplaintExaminationSnomedPipeline(
  fullText: string,
  voiceCtx: "complaint" | "examination",
  specialtyProp: string | undefined,
  geminiScreenContextAppendProp: string | undefined,
  doctorIdProp: string | null | undefined,
  indiaRefsetProp: string | null | undefined,
): Promise<{ merged: MergedComplaintExamRow[]; findings: ClinicalFinding[] }> {
  const specialty = specialtyProp?.trim() || "General Medicine";
  let entities = await extractStructuredClinicalEntities(
    fullText,
    voiceCtx,
    specialty,
    geminiScreenContextAppendProp,
  );
  if (voiceCtx === "examination") {
    entities = entities.map((row) => {
      const one = scrubExaminationFindingsAgainstTranscript(
        [
          {
            finding: row.finding,
            location: composeBodySiteLabel(row.laterality, row.bodySite) || null,
            qualifier: row.negation ? "Absent" : null,
            duration: row.duration ?? null,
            severity: row.severity ?? null,
          },
        ],
        fullText,
      )[0];
      // Preserve merged ROM chip label; scrub only applies to SNOMED-oriented `finding`.
      return { ...row, finding: one.finding };
    });
  }
  const hi = voiceCtx === "complaint" ? "complaint" : "finding";
  const snomedRuns = await Promise.all(
    entities.map((entity) => {
      const bodyLabel = composeBodySiteLabel(entity.laterality, entity.bodySite);
      return fetchSnomedForEntity({
        finding: entity.finding,
        bodySiteLabel: bodyLabel,
        hierarchy: hi,
        specialty,
        doctorId: doctorIdProp ?? null,
        indiaRefset: indiaRefsetProp ?? null,
      });
    }),
  );
  const merged = entities.map((entity, i) => ({
    ...entity,
    snomed: snomedRuns[i]?.top ?? null,
    snomedAlternatives: snomedRuns[i]?.alternatives ?? [],
  }));
  const findings = merged.map(toClinicalFinding);
  return { merged, findings };
}

function toClinicalFinding(
  e: GeminiEntityRow & {
    snomed?: SnomedClientHit | null;
    snomedAlternatives?: SnomedClientHit[];
  },
): ClinicalFinding {
  const chipDisplay =
    buildExaminationChipDisplay({
      chip_display: e.chip_display,
      laterality: e.laterality,
      bodySite: e.bodySite,
      finding: e.finding,
      structured_values: e.structured_values ?? null,
      value: e.value ?? null,
      unit: e.unit ?? null,
    }) ?? null;
  return {
    finding: e.finding,
    duration: e.duration ?? null,
    severity: e.severity ?? null,
    location: composeBodySiteLabel(e.laterality, e.bodySite) || null,
    qualifier: e.negation ? "Absent" : null,
    bodySite: e.bodySite ?? null,
    laterality: e.laterality ?? null,
    negation: Boolean(e.negation),
    rawText: e.rawText ?? null,
    chipDisplay,
    structuredValues: e.structured_values ?? null,
    value: e.value ?? null,
    unit: e.unit ?? null,
    snomed: e.snomed ?? null,
    snomedAlternatives: e.snomedAlternatives ?? [],
  };
}

async function saveClinicalExtractionSafe(
  encounterId: string | undefined,
  doctorId: string | undefined,
  contextType: string,
  rawTranscript: string,
  entities: unknown[],
) {
  if (!encounterId?.trim()) return;
  const standardizedText = (entities as { rawText?: string | null }[])
    .map((x) => x.rawText)
    .filter(Boolean)
    .join("; ");
  try {
    const { data: txn, error: txErr } = await supabase
      .from("transcriptions")
      .insert({
        session_id: null,
        encounter_id: encounterId.trim(),
        doctor_id: doctorId?.trim() || null,
        context_type: contextType,
        raw_transcript: rawTranscript,
        standardized_text: standardizedText,
      })
      .select("id")
      .single();
    if (txErr || !txn?.id) return;
    await supabase.from("clinical_extractions").insert({
      transcription_id: txn.id,
      encounter_id: encounterId.trim(),
      doctor_id: doctorId?.trim() || null,
      context_type: contextType,
      extraction_json: entities,
      doctor_confirmed: false,
    });
  } catch (e) {
    console.warn("STT→ saveClinicalExtraction:", e);
  }
}

/** Diagnosis / plan / advice — legacy prompts (not the structured chief_complaint schema). */
async function extractClinicalDataLegacy(text: string, contextType: string): Promise<unknown> {
  const model = geminiFlashClient.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  let prompt: string;

  if (contextType === "diagnosis") {
    prompt = `Extract the definitive working diagnoses from this transcript. Return a flat JSON array of objects with the key: "diagnosis". Transcript: "${text}"`;
  } else if (contextType === "plan") {
    prompt = `Extract the treatment plan from this transcript. Return a single JSON object with three distinct arrays:
1. "medications" (array of objects with keys: "name", "dosage", "frequency", "duration")
2. "investigations" (array of strings, e.g. "X-ray Right Knee AP/Lat", "MRI Lumbar Spine")
3. "advice" (array of strings for general instructions, e.g. "Physiotherapy for 2 weeks", "Strict bed rest")

Use empty arrays when a section has no items. Transcript: "${text}"`;
  } else {
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
  const raw = result.response.text().trim();
  const parsed = parseJsonResponse(raw);

  if (contextType === "plan") {
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      return {
        medications: Array.isArray(o.medications) ? o.medications : [],
        investigations: Array.isArray(o.investigations) ? o.investigations : [],
        advice: Array.isArray(o.advice) ? o.advice : [],
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
  specialty: specialtyProp,
  doctorId: doctorIdProp,
  encounterId: encounterIdProp,
  indiaRefset: indiaRefsetProp,
  geminiScreenContextAppend: geminiScreenContextAppendProp,
  ipdVoiceBaseText,
  ipdVoiceField,
  variant = "default",
  onRecordingStateChange,
  micVisual = "default",
  hideLiveTranscriptPill = false,
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
  const ipdBaseSnapshotRef = useRef<string>("");

  const micIdleClass =
    variant === "slate"
      ? "text-slate-400 hover:bg-slate-700/80 hover:text-slate-100"
      : "text-gray-400 hover:bg-gray-100 hover:text-gray-600";
  const micRecordingClass =
    variant === "slate"
      ? "text-red-500 hover:bg-red-950/40"
      : "text-red-500 hover:bg-red-50";
  const micErrorClass =
    variant === "slate" ? "text-red-400 hover:bg-red-950/30 hover:text-red-300" : "text-red-400 hover:bg-red-50 hover:text-red-600";

  const lucideIdleClass =
    variant === "slate"
      ? "text-slate-400 hover:bg-slate-700/80 hover:text-slate-100"
      : "text-gray-400 hover:bg-gray-100 hover:text-gray-600";

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
    if (isIpdStreamingVoiceContext(contextType)) {
      ipdBaseSnapshotRef.current = (ipdVoiceBaseText ?? "").trim();
    }

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
        keytermsPrompt: getSpecialtyWordBoost(specialtyProp ?? "General Medicine"),
      });
      transcriberRef.current = transcriber;

      transcriber.on("turn", (msg: TurnEvent) => {
        const text = msg.transcript?.trim() ?? "";
        if (!text) return;
        const isFinal = Boolean(msg.end_of_turn);
        setLiveText(text);
        if (isIpdStreamingVoiceContext(contextType)) {
          const base = ipdBaseSnapshotRef.current;
          const acc = finalTranscriptRef.current;
          const combined = [base, acc, text].filter((p) => p && String(p).trim() !== "").join(" ").replace(/\s+/g, " ").trim();
          /** Plain append (no `ipdVoiceField`): only the final merge at stop should use isFinal=true — not each utterance end. */
          const emitFinal = ipdVoiceField ? isFinal : false;
          onTranscriptUpdate(combined, emitFinal);
          if (isFinal) {
            finalTranscriptRef.current = (finalTranscriptRef.current + " " + text).trim();
          }
        } else {
          onTranscriptUpdate(text, isFinal);
          if (isFinal) {
            finalTranscriptRef.current = (finalTranscriptRef.current + " " + text).trim();
          }
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
      onRecordingStateChange?.(true);
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
      onRecordingStateChange?.(false);
    }
  }

  async function stopRecordingAndExtract() {
    setStatus("idle");
    onRecordingStateChange?.(false);
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

    if (!fullText) {
      return;
    }

    if (contextType === "ipd_progress_note" || contextType === "ipd_consult_request") {
      setIsExtracting(true);
      void (async () => {
        const base = ipdBaseSnapshotRef.current;
        try {
          if (!ipdVoiceField || contextType === "ipd_consult_request") {
            onTranscriptUpdate(mergeIpdFieldText(base, fullText), true);
            return;
          }
          if (ipdVoiceField === "subjective" || ipdVoiceField === "assessment") {
            const voiceCtx = ipdVoiceField === "subjective" ? "complaint" : "examination";
            const { merged, findings } = await runComplaintExaminationSnomedPipeline(
              fullText,
              voiceCtx,
              specialtyProp,
              geminiScreenContextAppendProp,
              doctorIdProp,
              indiaRefsetProp,
            );
            void saveClinicalExtractionSafe(encounterIdProp, doctorIdProp, "ipd_progress_note", fullText, merged);
            const displayNew =
              findings.map((f) => f.finding).filter(Boolean).join(". ").trim() || fullText;
            onTranscriptUpdate(mergeIpdFieldText(base, displayNew), true);
          } else {
            const result = await extractClinicalDataLegacy(fullText, "plan");
            const p = result as PlanExtractionResult;
            void saveClinicalExtractionSafe(encounterIdProp, doctorIdProp, "ipd_progress_note", fullText, [p]);
            const displayNew = formatPlanExtractionForIpdField(p).trim() || fullText;
            onTranscriptUpdate(mergeIpdFieldText(base, displayNew), true);
          }
        } catch (err) {
          console.error("IPD voice extraction failed:", err);
          onTranscriptUpdate(mergeIpdFieldText(ipdBaseSnapshotRef.current, fullText), true);
        } finally {
          setIsExtracting(false);
        }
      })();
      return;
    }

    if (onExtractionComplete) {
      setIsExtracting(true);
      void (async () => {
        const start = Date.now();
        console.log("STT→ [1/4] Raw transcript:", fullText);
        try {
          if (contextType === "complaint" || contextType === "examination") {
            const { merged, findings } = await runComplaintExaminationSnomedPipeline(
              fullText,
              contextType,
              specialtyProp,
              geminiScreenContextAppendProp,
              doctorIdProp,
              indiaRefsetProp,
            );
            console.log("STT→ [2/4] Gemini+SNOMED merged:", JSON.stringify(merged, null, 2));
            console.log(`STT→ [4/4] Results (${Date.now() - start}ms):`, merged);

            void saveClinicalExtractionSafe(encounterIdProp, doctorIdProp, contextType, fullText, merged);

            const output = findings;
            if (output.length > 0) {
              onExtractionComplete(output);
            }
            return;
          }

          const result = await extractClinicalDataLegacy(fullText, contextType);
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
            onExtractionComplete(result as ClinicalFinding[] | DiagnosisExtractionRow[]);
          }
        } catch (err) {
          console.error("Gemini extraction failed:", err);
        } finally {
          setIsExtracting(false);
        }
      })();
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
    onRecordingStateChange?.(false);
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
          className={cn("inline-flex items-center justify-center rounded-lg p-1.5 transition", micErrorClass)}
        >
          {micVisual === "lucide" ? <MicOff className="h-4 w-4" aria-hidden /> : <MicIcon className="h-4 w-4" />}
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
        {liveText && !hideLiveTranscriptPill && (
          <div
            aria-live="polite"
            className="absolute bottom-full mb-1.5 right-0 z-20 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-gray-800/90 px-2.5 py-1 text-[11px] leading-tight text-white shadow-lg dark:bg-slate-800/95"
          >
            {liveText}
          </div>
        )}
        <button
          type="button"
          onClick={handleMicClick}
          title="Click to stop recording"
          aria-label="Stop recording"
          className={cn(
            "relative inline-flex items-center justify-center rounded-lg p-1.5 transition",
            micVisual === "lucide" ? "text-red-500 hover:bg-red-950/30 dark:hover:bg-red-950/40" : micRecordingClass,
          )}
        >
          {micVisual === "lucide" ? (
            <Mic className="relative h-4 w-4 animate-pulse text-red-500" aria-hidden />
          ) : (
            <>
              <span className="absolute inset-0 animate-ping rounded-lg bg-red-400 opacity-30" aria-hidden />
              <MicIcon className="relative h-4 w-4" />
            </>
          )}
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
        className={cn(
          "inline-flex items-center justify-center rounded-lg p-1.5 transition",
          micVisual === "lucide" ? lucideIdleClass : micIdleClass,
        )}
      >
        {micVisual === "lucide" ? <MicOff className="h-4 w-4" aria-hidden /> : <MicIcon className="h-4 w-4" />}
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
