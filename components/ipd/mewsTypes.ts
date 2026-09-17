export type MewsComponentRow = {
  parameter: string;
  value: string;
  score: number;
};

export type MewsSavedSnapshot = {
  score: number;
  alertLevel: string;
  components: MewsComponentRow[];
};

export function mewsLabelFromScore(score: number): "normal" | "escalate" | "critical" {
  if (score <= 2) return "normal";
  if (score <= 4) return "escalate";
  return "critical";
}

/** RPC / column may store legacy `[{ parameter, value, score }]` or keyed `{ respiratory_rate: { value, score }, ... }`. */
export function parseMewsComponents(raw: unknown): MewsComponentRow[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (
      "respiratory_rate" in o ||
      "heart_rate" in o ||
      "systolic_bp" in o ||
      "spo2" in o ||
      "temperature" in o ||
      "avpu" in o
    ) {
      return mewsKeyedObjectToRows(o);
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: MewsComponentRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const parameter = typeof o.parameter === "string" ? o.parameter : "";
    const value = typeof o.value === "string" ? o.value : String(o.value ?? "—");
    const sc = typeof o.score === "number" ? o.score : Number(o.score);
    if (!parameter) continue;
    out.push({
      parameter,
      value,
      score: Number.isFinite(sc) ? sc : 0,
    });
  }
  return out;
}

function pickEntry(o: Record<string, unknown>, key: string): { value: unknown; score: number } | null {
  const e = o[key];
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const x = e as Record<string, unknown>;
  const sc = typeof x.score === "number" ? x.score : Number(x.score);
  return { value: x.value, score: Number.isFinite(sc) ? sc : 0 };
}

function formatObjectValueForBadge(parameter: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  const p = parameter.toLowerCase();
  if (p.includes("avpu")) {
    const t = String(value).trim();
    if (!t) return "—";
    const low = t.toLowerCase();
    const u = t.toUpperCase();
    if (u === "A" || low.startsWith("alert")) return "Alert";
    if (u === "V" || low.startsWith("voice")) return "Voice";
    if (u === "P" || low.startsWith("pain")) return "Pain";
    if (u === "U" || low.startsWith("unresponsive")) return "Unresponsive";
    return t.length <= 2 ? u : t;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (p.includes("heart")) return `${roundN(n, 1)}`;
  if (p.includes("respiratory")) return `${roundN(n, 1)}`;
  if (p.includes("temperature")) return `${roundN(n, 1)}`;
  if (p.includes("systolic")) return `${roundN(n, 0)}`;
  if (p.includes("spo")) return `${roundN(n, 0)}`;
  return String(value);
}

function roundN(n: number, d: number): string {
  return d === 0 ? String(Math.round(n)) : n.toFixed(d);
}

function mewsKeyedObjectToRows(o: Record<string, unknown>): MewsComponentRow[] {
  const defs: Array<{ key: string; parameter: string }> = [
    { key: "heart_rate", parameter: "Heart rate (bpm)" },
    { key: "respiratory_rate", parameter: "Respiratory rate (/min)" },
    { key: "temperature", parameter: "Temperature (°C)" },
    { key: "systolic_bp", parameter: "Systolic BP (mmHg)" },
    { key: "spo2", parameter: "SpO₂ (%)" },
    { key: "avpu", parameter: "AVPU" },
  ];
  const out: MewsComponentRow[] = [];
  for (const { key, parameter } of defs) {
    const e = pickEntry(o, key);
    if (!e) {
      out.push({ parameter, value: "—", score: 0 });
      continue;
    }
    out.push({
      parameter,
      value: formatObjectValueForBadge(parameter, e.value),
      score: e.score,
    });
  }
  return out;
}
