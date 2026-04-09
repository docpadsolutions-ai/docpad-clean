import type { SnomedRow } from "./snomedBodySiteRank";

const CSIRO_BASE = "https://r4.ontoserver.csiro.au/fhir";

export function buildValueSetExpandUrl(ecl: string, filter: string, count: number): string {
  const vs = `http://snomed.info/sct?fhir_vs=ecl/${ecl}`;
  const params = new URLSearchParams({
    url: vs,
    filter,
    count: String(count),
  });
  return `${CSIRO_BASE}/ValueSet/$expand?${params.toString()}`;
}

export async function expandValueSetFromCsiro(
  ecl: string,
  filter: string,
  count: number,
  timeoutMs: number,
): Promise<SnomedRow[]> {
  const url = buildValueSetExpandUrl(ecl, filter, count);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      expansion?: { contains?: { code: string; display: string }[] };
    };
    return (data.expansion?.contains ?? []).map((item) => ({
      conceptId: item.code,
      term: item.display,
      icd10: null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function validateConceptInValueSet(
  ecl: string,
  conceptId: string,
  timeoutMs: number,
): Promise<{ ok: boolean; display?: string }> {
  const vsUrl = `http://snomed.info/sct?fhir_vs=ecl/${ecl}`;
  const params = new URLSearchParams({
    url: vsUrl,
    system: "http://snomed.info/sct",
    code: conceptId,
  });
  const url = `${CSIRO_BASE}/ValueSet/$validate-code?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    const bundle = (await response.json()) as {
      resourceType?: string;
      parameter?: { name: string; valueBoolean?: boolean; valueString?: string }[];
    };
    const paramsOut = bundle.parameter ?? [];
    let ok = false;
    let display: string | undefined;
    for (const p of paramsOut) {
      if (p.name === "result" && p.valueBoolean === true) ok = true;
      if (p.name === "display" && p.valueString) display = p.valueString;
    }
    return { ok, display };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
