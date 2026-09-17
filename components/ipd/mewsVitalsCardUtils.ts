import type { MewsComponentRow } from "./mewsTypes";
import { parseMewsComponents } from "./mewsTypes";

export type MewsColumnKey = "rr" | "spo2" | "temp" | "sbp" | "hr" | "avpu";

const COLUMN_ORDER: MewsColumnKey[] = ["rr", "spo2", "temp", "sbp", "hr", "avpu"];

const API_KEYS: Record<MewsColumnKey, string> = {
  rr: "respiratory_rate",
  spo2: "spo2",
  temp: "temperature",
  sbp: "systolic_bp",
  hr: "heart_rate",
  avpu: "avpu",
};

const PARAM_MATCH: Record<MewsColumnKey, (p: string) => boolean> = {
  rr: (p) => /respiratory\s*rate/i.test(p),
  spo2: (p) => p.includes("SpO") || /spo2/i.test(p),
  temp: (p) => /temperature/i.test(p),
  sbp: (p) => /systolic/i.test(p),
  hr: (p) => /heart\s*rate/i.test(p),
  avpu: (p) => /^avpu$/i.test(p.trim()) || p.toLowerCase().includes("avpu"),
};

function isKeyedMewsObject(raw: unknown): raw is Record<string, { value?: unknown; score?: unknown }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  return (
    "respiratory_rate" in o ||
    "heart_rate" in o ||
    "systolic_bp" in o ||
    "spo2" in o ||
    "temperature" in o ||
    "avpu" in o
  );
}

function pickScore(e: unknown): number {
  if (!e || typeof e !== "object" || Array.isArray(e)) return 0;
  const sc = (e as Record<string, unknown>).score;
  const n = typeof sc === "number" ? sc : Number(sc);
  return Number.isFinite(n) ? n : 0;
}

/** Map `mews_components` (keyed object or legacy array) into fixed columns with labels + units. */
export function componentsToColumnCells(raw: unknown): Record<
  MewsColumnKey,
  { label: string; value: string; score: number }
> {
  const labels: Record<MewsColumnKey, string> = {
    rr: "RR",
    spo2: "SpO₂",
    temp: "Temp",
    sbp: "SBP",
    hr: "HR",
    avpu: "AVPU",
  };

  if (isKeyedMewsObject(raw)) {
    const out = {} as Record<MewsColumnKey, { label: string; value: string; score: number }>;
    for (const key of COLUMN_ORDER) {
      const apiKey = API_KEYS[key];
      const entry = raw[apiKey];
      out[key] = {
        label: labels[key],
        value: formatKeyedCellValue(key, entry),
        score: pickScore(entry),
      };
    }
    return out;
  }

  const rows = parseMewsComponents(raw);
  const byKey: Partial<Record<MewsColumnKey, MewsComponentRow>> = {};
  for (const r of rows) {
    const p = r.parameter;
    for (const key of COLUMN_ORDER) {
      if (PARAM_MATCH[key](p)) {
        byKey[key] = r;
        break;
      }
    }
  }

  const legacy = {} as Record<MewsColumnKey, { label: string; value: string; score: number }>;
  for (const key of COLUMN_ORDER) {
    const row = byKey[key];
    const valueRaw = row?.value?.trim() ?? "—";
    legacy[key] = {
      label: labels[key],
      value: formatCellDisplay(key, valueRaw),
      score: row != null && Number.isFinite(row.score) ? row.score : 0,
    };
  }
  return legacy;
}

function formatKeyedCellValue(key: MewsColumnKey, entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "—";
  const v = (entry as Record<string, unknown>).value;
  if (v === null || v === undefined) return "—";
  if (key === "avpu") {
    const t = String(v).trim();
    if (!t) return "—";
    const low = t.toLowerCase();
    if (low.startsWith("alert")) return "A";
    if (low.startsWith("voice")) return "V";
    if (low.startsWith("pain")) return "P";
    if (low.startsWith("unresponsive")) return "U";
    return t.length <= 2 ? t.toUpperCase() : t;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  switch (key) {
    case "rr":
      return `${roundNum(n, 1)}/min`;
    case "spo2":
      return `${roundNum(n, 0)}%`;
    case "temp":
      return `${roundNum(n, 1)}°C`;
    case "sbp":
      return `${roundNum(n, 0)} mmHg`;
    case "hr":
      return `${roundNum(n, 0)} bpm`;
    default:
      return "—";
  }
}

function roundNum(n: number, frac: number): string {
  return frac === 0 ? String(Math.round(n)) : n.toFixed(frac);
}

function formatCellDisplay(key: MewsColumnKey, value: string): string {
  if (value === "—" || !value) return "—";
  switch (key) {
    case "rr":
      return value.includes("/") ? value : `${value}/min`;
    case "spo2":
      return value.includes("%") ? value : `${value}%`;
    case "temp":
      return value.includes("°") ? value : `${value}°C`;
    case "sbp":
      return value.includes("mmHg") ? value : `${value} mmHg`;
    case "hr":
      return value.includes("bpm") ? value : `${value} bpm`;
    case "avpu": {
      const t = value.toLowerCase();
      if (t.startsWith("alert")) return "A";
      if (t.startsWith("voice")) return "V";
      if (t.startsWith("pain")) return "P";
      if (t.startsWith("unresponsive")) return "U";
      return value.length <= 2 ? value.toUpperCase() : value;
    }
    default:
      return value;
  }
}

export function statusLabelFromScore(score: number): { title: string; band: "normal" | "escalate" | "critical" } {
  if (score >= 5) return { title: "Call RRT", band: "critical" };
  if (score >= 3) return { title: "Escalate", band: "escalate" };
  return { title: "Normal", band: "normal" };
}

/** Score chips — muted saturation for light UI. */
export function chipClassesForScore(score: number): string {
  if (score <= 0) return "bg-slate-600 text-white dark:bg-slate-600 dark:text-white";
  if (score === 1) return "bg-amber-600 text-white dark:bg-amber-600 dark:text-white";
  if (score === 2) return "bg-orange-700 text-white dark:bg-orange-700 dark:text-white";
  return "bg-rose-800 text-white dark:bg-rose-800 dark:text-white";
}

/** Accent high-parameter rows — amber left rule, no pastel fill. */
export function cellAccentForScore(score: number): string {
  if (score >= 2) return "border-l-4 border-amber-600 bg-white dark:border-amber-600 dark:bg-white";
  return "";
}
