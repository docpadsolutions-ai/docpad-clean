/** Shared vocabulary boost for clinical dictation (realtime + batch). */
export const ASSEMBLYAI_CLINICAL_WORD_BOOST: string[] = [
  "OPD",
  "IPD",
  "diagnosis",
  "prescription",
  "mg",
  "tablet",
  "injection",
  "fracture",
  "orthopaedic",
  "bilateral",
  "unilateral",
];

/**
 * v3 Universal Streaming defaults to `wss://streaming.assemblyai.com/v3/ws` (see `StreamingTranscriber` in the `assemblyai` package).
 * Do not use the legacy v2 `wss://api.assemblyai.com/v2/realtime/ws` URL with tokens from `/v3/token`.
 */
