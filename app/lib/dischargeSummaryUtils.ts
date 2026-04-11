/** Client-side helpers for discharge summary compilation (investigations delta, hospital course). */

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export type Investigation = Record<string, unknown>;

export type DeltaRow = {
  testName: string;
  day1: string;
  changes: Array<{ date: string; value: string; flag: string }>;
  latest: string;
  flagLatest: string;
  amber: boolean;
};

/** Group by test_name; sort by date; keep first reading; keep later rows only when result_value differs from previous. */
export function buildDeltaTable(investigations: Investigation[]): DeltaRow[] {
  if (!Array.isArray(investigations) || investigations.length === 0) return [];

  const byName = new Map<string, Investigation[]>();
  for (const inv of investigations) {
    const name = str(inv.test_name ?? inv.name ?? "Unknown");
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(inv);
  }

  const out: DeltaRow[] = [];

  for (const [, rows] of byName) {
    const sorted = [...rows].sort((a, b) => {
      const da = Date.parse(str(a.ordered_at ?? a.ordered_date ?? a.created_at ?? 0));
      const db = Date.parse(str(b.ordered_at ?? b.ordered_date ?? b.created_at ?? 0));
      return (Number.isNaN(da) ? 0 : da) - (Number.isNaN(db) ? 0 : db);
    });
    if (sorted.length === 0) continue;

    const first = sorted[0];
    const day1 = str(first.result_value);
    const changes: DeltaRow["changes"] = [];
    let prevVal = day1;

    for (let i = 1; i < sorted.length; i++) {
      const val = str(sorted[i].result_value);
      if (val !== prevVal) {
        const dt = sorted[i].ordered_at ?? sorted[i].ordered_date ?? sorted[i].created_at;
        changes.push({
          date: fmtShortDate(dt),
          value: val,
          flag: str(sorted[i].result_flag ?? ""),
        });
        prevVal = val;
      }
    }

    const last = sorted[sorted.length - 1];
    const latest = str(last.result_value);
    const flagLatest = str(last.result_flag ?? "");
    const amber = sorted.some((r) => {
      const f = str(r.result_flag).toUpperCase();
      return f === "H" || f === "L";
    });

    out.push({
      testName: str(first.test_name ?? first.name ?? "Unknown"),
      day1,
      changes,
      latest,
      flagLatest,
      amber,
    });
  }

  return out.sort((a, b) => a.testName.localeCompare(b.testName));
}

function fmtShortDate(v: unknown): string {
  const t = str(v);
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t.slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Day 1: subjective + assessment. Later days: include only when assessment_text differs from previous day.
 */
export function buildHospitalCourseFromNotes(notes: Array<Record<string, unknown>>): string {
  if (!Array.isArray(notes) || notes.length === 0) return "";
  const sorted = [...notes].sort(
    (a, b) => Number(a.hospital_day_number ?? 0) - Number(b.hospital_day_number ?? 0),
  );

  const blocks: string[] = [];
  let prevAssessment = "";

  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i];
    const day = Math.max(1, Number(n.hospital_day_number) || i + 1);
    const subj = str(n.subjective_text);
    const assess = str(n.assessment_text);

    if (i === 0) {
      const lines: string[] = [`Day ${day}:`];
      if (subj) lines.push(`Subjective: ${subj}`);
      if (assess) lines.push(`Assessment: ${assess}`);
      blocks.push(lines.join("\n"));
      prevAssessment = assess;
    } else {
      if (assess !== prevAssessment && assess.length > 0) {
        blocks.push(`Day ${day}:\nAssessment: ${assess}`);
        prevAssessment = assess;
      }
    }
  }

  return blocks.join("\n\n");
}
