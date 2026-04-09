export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Sørensen–Dice coefficient on bigrams; robust for short payer names. */
export function diceCoefficient(a: string, b: string): number {
  const x = normalizeForMatch(a);
  const y = normalizeForMatch(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) {
    return x.includes(y) || y.includes(x) ? 0.85 : 0;
  }
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const mx = bigrams(x);
  const my = bigrams(y);
  let intersection = 0;
  for (const [k, vx] of mx) {
    const vy = my.get(k) ?? 0;
    intersection += Math.min(vx, vy);
  }
  return (2 * intersection) / (x.length - 1 + (y.length - 1));
}

export type InsuranceCompanyRow = { id: string; name: string };

export function bestInsuranceCompanyMatch(
  rawName: string,
  companies: InsuranceCompanyRow[],
  minScore = 0.32,
): { row: InsuranceCompanyRow; score: number } | null {
  const t = rawName.trim();
  if (!t || companies.length === 0) return null;
  let best: { row: InsuranceCompanyRow; score: number } | null = null;
  for (const row of companies) {
    const score = diceCoefficient(t, row.name);
    if (!best || score > best.score) {
      best = { row, score };
    }
  }
  if (!best || best.score < minScore) return null;
  return best;
}
