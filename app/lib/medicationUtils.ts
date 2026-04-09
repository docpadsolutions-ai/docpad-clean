/**
 * Helpers for prescribed quantity from human-entered frequency & duration strings.
 */

const AS_NEEDED_RE = /\b(sos|prn|as\s*needed)\b/i;

export function isAsNeededFrequency(frequency: string): boolean {
  return AS_NEEDED_RE.test((frequency ?? "").trim());
}

/** Human-readable unit for the total-quantity badge (tablets / capsules / units). */
export function quantityDisplayUnit(formName: string | null | undefined): string {
  const n = (formName ?? "").toLowerCase();
  if (/\btab/.test(n)) return "tablets";
  if (/\bcap/.test(n)) return "capsules";
  return "units";
}

/** Singular/plural label e.g. "14 tablets" vs "1 tablet". */
export function formatTotalQuantityLabel(count: number, formName: string | null | undefined): string {
  const n = (formName ?? "").toLowerCase();
  const c = count === 1;
  let word: string;
  if (/\btab/.test(n)) word = c ? "tablet" : "tablets";
  else if (/\bcap/.test(n)) word = c ? "capsule" : "capsules";
  else word = c ? "unit" : "units";
  return `${count} ${word}`;
}

function pillsPerDayFromFrequency(freq: string): number {
  const f = (freq ?? "").trim();
  if (!f) return 1;

  if (f.includes("-")) {
    const parts = f.split("-");
    if (parts.length >= 2) {
      let sum = 0;
      for (const p of parts) {
        const digits = p.trim().replace(/[^\d]/g, "");
        if (!digits) continue;
        const n = Number.parseInt(digits, 10);
        if (Number.isFinite(n)) sum += n;
      }
      if (sum > 0) return Math.max(1, sum);
    }
  }

  if (/\bqid\b|\b4\s*x\b|\b4\s*times\b/i.test(f)) return 4;
  if (/\btid\b|\btds\b|\bthrice\b|\b3\s*x\b|\b3\s*times\b/i.test(f)) return 3;
  if (/\bbid\b|\bbd\b|\bb\.d\b|\btwice\b|\b2\s*x\b|\b2\s*times\b/i.test(f)) return 2;
  if (/\bod\b|\bo\.d\b|\bonce\b|\bqd\b|\b1\s*x\b|\b1\s*time\b/i.test(f)) return 1;

  return 1;
}

function daysFromDuration(duration: string): number {
  const d = (duration ?? "").trim().toLowerCase();
  if (!d) return 1;

  const weekMatch = d.match(/(\d+(?:\.\d+)?)\s*weeks?/);
  if (weekMatch) {
    const w = Number.parseFloat(weekMatch[1]);
    return Math.max(1, Math.ceil(Number.isFinite(w) ? w * 7 : 7));
  }
  if (/\b1\s*week\b/.test(d)) return 7;

  const dayMatch = d.match(/(\d+(?:\.\d+)?)\s*days?/);
  if (dayMatch) {
    const n = Number.parseFloat(dayMatch[1]);
    return Math.max(1, Math.ceil(Number.isFinite(n) ? n : 1));
  }

  const monthMatch = d.match(/(\d+(?:\.\d+)?)\s*months?/);
  if (monthMatch) {
    const m = Number.parseFloat(monthMatch[1]);
    return Math.max(1, Math.ceil(Number.isFinite(m) ? m * 30 : 30));
  }

  const lead = d.match(/^(\d+(?:\.\d+)?)/);
  if (lead) {
    const n = Number.parseFloat(lead[1]);
    if (Number.isFinite(n)) return Math.max(1, Math.ceil(n));
  }

  return 1;
}

/**
 * Estimated total units (e.g. tablets) from frequency + duration.
 * SOS / PRN / as-needed → 1 (use UI override when applicable).
 * Never throws; returns a positive integer ≤ 99999.
 */
export function clampPrescriptionQuantity(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(99999, Math.max(1, Math.round(n)));
}

export function calculateTotalQuantity(frequency: string, duration: string): number {
  const freq = (frequency ?? "").trim();
  const dur = (duration ?? "").trim();

  if (isAsNeededFrequency(freq)) {
    return 1;
  }

  const perDay = pillsPerDayFromFrequency(freq);
  const days = daysFromDuration(dur);
  const raw = perDay * days;
  if (!Number.isFinite(raw)) return 1;
  return clampPrescriptionQuantity(Math.ceil(raw));
}
