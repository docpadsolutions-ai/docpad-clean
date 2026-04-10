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

const COMMON_MEDICAL = [
  "OPD",
  "IPD",
  "prescription",
  "diagnosis",
  "bilateral",
  "unilateral",
  "milligrams",
  "tablet",
  "injection",
  "twice daily",
  "once daily",
  "tenderness",
  "swelling",
  "discharge",
  "moderate",
  "severe",
];

const SPECIALTY_BOOST: Record<string, string[]> = {
  Orthopaedics: [
    "fracture",
    "dislocation",
    "crepitus",
    "effusion",
    "ROM",
    "varus",
    "valgus",
    "ACL",
    "PCL",
    "meniscus",
    "rotator cuff",
    "impingement",
    "avascular necrosis",
    "osteoarthritis",
    "osteomyelitis",
    "non-union",
    "malunion",
    "callus",
    "arthroplasty",
    "arthroscopy",
    "fixation",
    "K-wire",
    "plate",
    "nail",
    "Lachman",
    "McMurray",
    "drawer",
    "FABER",
    "straight leg raise",
    "cervical",
    "thoracic",
    "lumbar",
    "sacral",
    "intervertebral disc",
  ],
  "General Medicine": [
    "auscultation",
    "crepitations",
    "rhonchi",
    "wheeze",
    "murmur",
    "hepatomegaly",
    "splenomegaly",
    "ascites",
    "icterus",
    "pallor",
    "tachycardia",
    "bradycardia",
    "hypertension",
    "diabetes",
    "thyroid",
  ],
  "Obstetrics and Gynaecology": [
    "amenorrhea",
    "menorrhagia",
    "dysmenorrhea",
    "cervical dilation",
    "effacement",
    "fundal height",
    "fetal heart",
    "presentation",
    "breech",
    "cephalic",
    "episiotomy",
    "caesarean",
  ],
};

/** Top terms for AssemblyAI `keytermsPrompt` — merge with specialty-specific boost. */
export function getSpecialtyWordBoost(specialty: string): string[] {
  const spec = specialty?.trim() || "General Medicine";
  const extra = SPECIALTY_BOOST[spec] ?? SPECIALTY_BOOST["General Medicine"] ?? [];
  const merged = [...COMMON_MEDICAL, ...extra, ...ASSEMBLYAI_CLINICAL_WORD_BOOST];
  return [...new Set(merged)];
}

/**
 * v3 Universal Streaming defaults to `wss://streaming.assemblyai.com/v3/ws` (see `StreamingTranscriber` in the `assemblyai` package).
 * Do not use the legacy v2 `wss://api.assemblyai.com/v2/realtime/ws` URL with tokens from `/v3/token`.
 */
