/**
 * Hindi glosses for prescription dosage / frequency / timing / duration (OPD writer).
 * Pure functions — safe for client and server.
 */

const TIMING_PHRASES: { re: RegExp; key: string }[] = [
  { re: /\bafter\s+food\b/gi, key: "after food" },
  { re: /\bbefore\s+food\b/gi, key: "before food" },
  { re: /\bwith\s+food\b/gi, key: "with food" },
  { re: /\bempty\s+stomach\b/gi, key: "empty stomach" },
  { re: /\bat\s+bedtime\b/gi, key: "at bedtime" },
  { re: /\bafter\s+meals?\b/gi, key: "after food" },
];

/** Remove known timing phrases so 1-0-1-style tokens can be parsed from the remainder. */
function stripTimingPhrasesFromFrequency(raw: string): string {
  let s = raw;
  for (const { re } of TIMING_PHRASES) {
    s = s.replace(re, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function normalizeDashes(s: string): string {
  return s.replace(/[\u2013\u2014\u2212]/g, "-");
}

/** Pulls a-b-c triple from anywhere in the string (handles spaces, unicode dashes). */
function extractTripleToken(s: string): string | null {
  const norm = normalizeDashes(s).replace(/\s/g, "");
  const m = norm.match(/(\d)-(\d)-(\d)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Maps `frequency` field (e.g. 1-0-1, BD) + timing + duration to a Hindi summary line. */
export function translateDosageToHindi(dosageString: string, timing: string, duration: string): string {
  return translateDosageToHindiWithStrength(dosageString, timing, duration, "");
}

/**
 * Same as translateDosageToHindi, but if `frequency` is empty or doesn't parse,
 * tries to find a 1-0-1 pattern in `dosageStrength` (tablet line).
 */
export function translateDosageToHindiWithStrength(
  frequency: string,
  timing: string,
  duration: string,
  dosageStrength: string,
): string {
  const timingCombined = `${timing} ${frequency} ${dosageStrength}`.trim();

  const freqForTriple = stripTimingPhrasesFromFrequency(frequency);
  let freqHi = translateFrequencyToHindi(freqForTriple);
  if (!freqHi && dosageStrength.trim()) {
    const extracted = extractTripleToken(dosageStrength);
    if (extracted) freqHi = translateFrequencyToHindi(extracted);
  }
  if (!freqHi && frequency.trim()) {
    const extracted = extractTripleToken(frequency);
    if (extracted) freqHi = translateFrequencyToHindi(extracted);
  }

  const timeHi = translateTimingToHindi(timingCombined);
  const durHi = translateDurationToHindi(duration);

  const rawParts = [freqHi, timeHi, durHi].filter((p): p is string => p != null && String(p).trim() !== "");
  const parts: string[] = [];
  for (const p of rawParts) {
    if (parts[parts.length - 1] === p) continue;
    parts.push(p);
  }
  return parts.join(" · ");
}

function translateFrequencyToHindi(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  const u = t.toUpperCase().replace(/\s+/g, "");
  if (u === "SOS") return "जरूरत पड़ने पर";
  if (u === "BD" || u === "BID") return "दिन में 2 बार";
  if (u === "TDS") return "दिन में 3 बार";
  if (u === "OD") return "दिन में 1 बार";
  if (u === "QID") return "दिन में 4 बार";

  const compact = normalizeDashes(t).replace(/\s/g, "");
  const tri = compact.match(/^(\d)-(\d)-(\d)$/);
  if (tri) {
    const a = tri[1]!;
    const b = tri[2]!;
    const c = tri[3]!;
    if (a === "1" && b === "0" && c === "1") return "सुबह 1 · दोपहर 0 · रात 1";
    if (a === "1" && b === "1" && c === "1") return "सुबह 1 · दोपहर 1 · रात 1";
    if (a === "0" && b === "0" && c === "1") return "रात को 1";
    if (a === "1" && b === "0" && c === "0") return "सुबह 1";
    if (a === "0" && b === "1" && c === "0") return "दोपहर 1";
    if (a === "1" && b === "1" && c === "0") return "सुबह 1 · दोपहर 1";
    const parts: string[] = [];
    if (a !== "0") parts.push(`सुबह ${a}`);
    if (b !== "0") parts.push(`दोपहर ${b}`);
    if (c !== "0") {
      if (a === "0" && b === "0") parts.push(`रात को ${c}`);
      else parts.push(`रात ${c}`);
    }
    return parts.join(" · ");
  }

  return null;
}

function translateTimingToHindi(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const direct: Record<string, string> = {
    "after food": "खाने के बाद",
    "before food": "खाने से पहले",
    "with food": "खाने के साथ",
    "empty stomach": "खाली पेट",
    "at bedtime": "सोते समय",
  };
  if (direct[s]) return direct[s]!;

  if (s.includes("after food") || s.includes("after meals") || s.includes("after meal")) return "खाने के बाद";
  if (s.includes("before food")) return "खाने से पहले";
  if (s.includes("with food")) return "खाने के साथ";
  if (s.includes("empty stomach")) return "खाली पेट";
  if (s.includes("bedtime")) return "सोते समय";

  return null;
}

function translateDurationToHindi(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  if (s === "5 days") return "5 दिन";
  if (s === "7 days") return "7 दिन";
  if (s === "10 days") return "10 दिन";
  if (s === "14 days") return "14 दिन";
  if (s === "1 month") return "1 महीना";
  if (s === "3 months") return "3 महीने";
  if (s === "ongoing") return "जारी रखें";

  const dayM = s.match(/^(\d+)\s*days?$/i);
  if (dayM) return `${dayM[1]} दिन`;

  const monthM = s.match(/^(\d+)\s*months?$/i);
  if (monthM) {
    const n = monthM[1]!;
    return n === "1" ? "1 महीना" : `${n} महीने`;
  }

  return null;
}

/**
 * English line (strength · frequency · timing · duration) plus optional Hindi line
 * when `includeHindi` is true and at least one translatable segment exists.
 */
export function formatDosageBilingual(
  strength: string,
  frequency: string,
  timing: string,
  duration: string,
  includeHindi: boolean,
): string {
  const engParts = [strength, frequency, timing, duration].filter((x) => (x ?? "").trim() !== "");
  const englishLine = engParts.join(" · ");
  if (!includeHindi) return englishLine;

  const hindiLine = translateDosageToHindiWithStrength(frequency, timing, duration, strength).trim();
  if (!hindiLine) return englishLine;
  if (!englishLine.trim()) return hindiLine;
  return `${englishLine}\n${hindiLine}`;
}
