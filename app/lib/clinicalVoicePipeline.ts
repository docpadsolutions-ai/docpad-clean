/** Build a single body-site string for SNOMED post-filtering (laterality + site). */
export function composeBodySiteLabel(
  laterality: string | null | undefined,
  bodySite: string | null | undefined,
): string {
  const lat = laterality?.trim() ?? "";
  const site = bodySite?.trim() ?? "";
  return [lat, site].filter(Boolean).join(" ").trim();
}

export type GeminiEntityRow = {
  finding: string;
  bodySite?: string | null;
  laterality?: string | null;
  negation?: boolean;
  duration?: string | null;
  severity?: string | null;
  rawText?: string | null;
  /**
   * Full chip label for merged ROM rows (degrees, joint, laterality). SNOMED lookup uses `finding`.
   */
  chip_display?: string | null;
  /** Numeric ROM planes in degrees (e.g. flexion, abduction) for trending / graphing. */
  structured_values?: Record<string, number> | null;
  /** Single measured value when spoken with units (non-ROM or one number). */
  value?: number | null;
  unit?: string | null;
};

export type SnomedClientHit = {
  conceptId: string;
  term: string;
  lowConfidence?: boolean;
};

/** Parallel SNOMED lookup via existing GET /api/snomed/search (finding term only + body site param). */
export async function fetchSnomedForEntity(opts: {
  finding: string;
  bodySiteLabel: string;
  hierarchy: "complaint" | "finding";
  specialty?: string | null;
  doctorId?: string | null;
  indiaRefset?: string | null;
}): Promise<{ top: SnomedClientHit | null; alternatives: SnomedClientHit[] }> {
  const { finding, bodySiteLabel, hierarchy, specialty, doctorId, indiaRefset } = opts;
  const q = finding.trim();
  if (q.length < 2) {
    return { top: null, alternatives: [] };
  }

  const params = new URLSearchParams();
  params.set("q", q);
  params.set("hierarchy", hierarchy);
  if (bodySiteLabel.trim()) {
    params.set("bodySite", bodySiteLabel.trim());
  }
  if (specialty?.trim()) {
    params.set("specialty", specialty.trim());
  }
  if (doctorId?.trim()) {
    params.set("doctorId", doctorId.trim());
  }
  if (indiaRefset?.trim()) {
    params.set("indiaRefset", indiaRefset.trim());
  }

  const res = await fetch(`/api/snomed/search?${params.toString()}`);
  const data = (await res.json()) as {
    results?: Array<{ conceptId: string; term: string; lowConfidence?: boolean }>;
  };
  const list = Array.isArray(data.results) ? data.results : [];
  const mapped: SnomedClientHit[] = list
    .map((r) => ({
      conceptId: String(r.conceptId ?? "").trim(),
      term: String(r.term ?? "").trim(),
      lowConfidence: r.lowConfidence,
    }))
    .filter((r) => r.conceptId && r.term);

  return {
    top: mapped[0] ?? null,
    alternatives: mapped.slice(1, 4),
  };
}
