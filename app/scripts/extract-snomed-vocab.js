const fs = require("fs");
const path = require("path");

const FILE = path.join(
  __dirname,
  "..",
  "snomed/SnomedCT_InternationalRF2_PRODUCTION_20260401T120000Z/Snapshot/Terminology/sct2_Description_Snapshot-en_INT_20260401.txt",
);

const SYNONYM_TYPE = "900000000000013009";

const KEYWORDS = [
  "fever",
  "cough",
  "pain",
  "breathless",
  "dyspnea",
  "fatigue",
  "weakness",
  "nausea",
  "vomiting",
  "diarrhea",
  "constipation",
  "headache",
  "dizziness",
  "syncope",
  "palpitation",
  "chest",
  "abdomen",
  "hypertension",
  "diabetes",
  "asthma",
  "pneumonia",
  "tuberculosis",
  "infection",
  "inflammation",
  "anemia",
  "thyroid",
  "cardiac",
  "renal",
  "hepatic",
  "gastric",
  "bowel",
  "bladder",
  "stroke",
  "seizure",
  "epilepsy",
  "migraine",
  "depression",
  "anxiety",
  "obesity",
  "malnutrition",
  "dehydration",
  "sepsis",
  "shock",
  "edema",
  "jaundice",
  "pallor",
  "cyanosis",
  "clubbing",
  "lymph",
  "gland",
  "rash",
  "ulcer",
  "wound",
  "bleeding",
  "hemorrhage",
  "hypo",
  "hyper",
  "acute",
  "chronic",
];

const lines = fs.readFileSync(FILE, "utf8").split("\n");
const vocab = new Set();

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split("\t");
  if (cols.length < 8) continue;
  if (cols[2] !== "1") continue;
  if (cols[6] !== SYNONYM_TYPE) continue;

  const raw = cols[7].trim();
  const term = raw.toLowerCase();
  if (term.split(/\s+/).filter(Boolean).length > 6) continue;

  for (const kw of KEYWORDS) {
    if (term.includes(kw)) {
      vocab.add(raw);
      break;
    }
  }
  if (vocab.size >= 1000) break;
}

const result = Array.from(vocab);
const outDir = path.join(__dirname, "..", "..", "lib");
const outFile = path.join(outDir, "snomed-general-vocabulary.json");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(`Extracted ${result.length} terms → ${outFile}`);
