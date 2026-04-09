/**
 * Compose a plain-text clinical summary from an `opd_encounters` row for preauth / referrals.
 * Mirrors how the encounter form persists chief complaint, vitals, exam, diagnosis, etc.
 */

type FhirCoding = { display?: string; code?: string; icd10?: string | null };

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

function strN(v: unknown): string | null {
  return v != null && v !== "" ? String(v) : null;
}

function parseJsonValue<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as T;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function linesFromFhirArray(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? (raw as FhirCoding[]) : parseJsonValue<FhirCoding[]>(raw);
  if (!arr?.length) return [];
  return arr.map((x) => {
    const d = x?.display?.trim();
    const c = x?.code?.trim();
    if (!d && !c) return "";
    if (d && c) return `${d} (SNOMED ${c})`;
    return d || `SNOMED ${c}`;
  }).filter(Boolean);
}

function section(title: string, body: string): string {
  const t = body.trim();
  if (!t) return "";
  return `${title}\n${t}`;
}

export function buildEncounterClinicalSummary(enc: Record<string, unknown>): string {
  const parts: string[] = [];

  const ccLines = linesFromFhirArray(enc.chief_complaints_fhir);
  const ccBlock =
    ccLines.length > 0
      ? ccLines.join("\n")
      : strN(enc.chief_complaint_term)?.trim() ||
        strN(enc.chief_complaint)?.trim() ||
        "";
  const cc = section("Chief complaint", ccBlock);
  if (cc) parts.push(cc);

  const vitals: string[] = [];
  if (enc.weight != null && String(enc.weight).trim()) vitals.push(`Weight: ${str(enc.weight)}`);
  if (strN(enc.blood_pressure)) vitals.push(`BP: ${str(enc.blood_pressure)}`);
  if (enc.pulse != null && String(enc.pulse).trim()) vitals.push(`Pulse: ${str(enc.pulse)}`);
  if (enc.temperature != null && String(enc.temperature).trim()) vitals.push(`Temp: ${str(enc.temperature)}`);
  if (enc.spo2 != null && String(enc.spo2).trim()) vitals.push(`SpO₂: ${str(enc.spo2)}`);
  const v = section("Vitals", vitals.join("\n"));
  if (v) parts.push(v);

  const exTerm = strN(enc.examination_term)?.trim();
  const rawExam = enc.quick_exam;
  const examLines: string[] = [];
  if (exTerm) examLines.push(exTerm);
  if (Array.isArray(rawExam)) {
    for (const line of rawExam as string[]) {
      const s = str(line).trim();
      if (s) examLines.push(s);
    }
  } else if (typeof rawExam === "string" && rawExam.trim()) {
    examLines.push(...rawExam.split(",").map((s) => s.trim()).filter(Boolean));
  }
  const ex = section("Examination / clinical findings", examLines.join("\n"));
  if (ex) parts.push(ex);

  const dxFhirRaw = enc.diagnosis_fhir;
  let dxBlock = "";
  const dxObj =
    dxFhirRaw != null && typeof dxFhirRaw === "object" && !Array.isArray(dxFhirRaw)
      ? (dxFhirRaw as FhirCoding)
      : parseJsonValue<FhirCoding>(dxFhirRaw);
  if (dxObj?.display?.trim()) {
    const icd = dxObj.icd10?.trim();
    dxBlock = icd ? `${dxObj.display.trim()} (ICD-10 ${icd})` : dxObj.display.trim();
  } else {
    const dt = strN(enc.diagnosis_term)?.trim() || strN(enc.diagnosis)?.trim();
    if (dt) {
      const icd = strN(enc.diagnosis_icd10);
      dxBlock = icd ? `${dt} (ICD-10 ${icd})` : dt;
    }
  }
  const dx = section("Diagnosis / working diagnosis", dxBlock);
  if (dx) parts.push(dx);

  const procLines = linesFromFhirArray(enc.procedures_fhir);
  const procStr =
    procLines.length > 0
      ? procLines.join("\n")
      : typeof enc.procedures === "string" && enc.procedures.trim()
        ? enc.procedures.trim()
        : "";
  const pr = section("Procedures discussed / ordered", procStr);
  if (pr) parts.push(pr);

  const allergyLines = linesFromFhirArray(enc.allergies_fhir);
  let alBlock = allergyLines.join("\n");
  if (!alBlock && enc.known_allergies) {
    const raw = enc.known_allergies;
    alBlock = Array.isArray(raw)
      ? (raw as unknown[]).map((x) => str(x).trim()).filter(Boolean).join(", ")
      : str(raw).trim();
  }
  const al = section("Allergies", alBlock);
  if (al) parts.push(al);

  const pd = enc.plan_details;
  const planBits: string[] = [];
  if (pd != null && typeof pd === "object" && !Array.isArray(pd)) {
    const p = pd as Record<string, unknown>;
    const advice = strN(p.advice_notes)?.trim();
    if (advice) planBits.push(`Advice: ${advice}`);
    const triage = strN(p.triage_notes)?.trim();
    if (triage) planBits.push(`Triage: ${triage}`);
    const surgery = strN(p.surgery_plan)?.trim();
    if (surgery) planBits.push(`Plan: ${surgery}`);
    const inv = p.investigations;
    if (Array.isArray(inv) && inv.length > 0) {
      planBits.push(`Investigations: ${inv.map((x) => str(x).trim()).filter(Boolean).join(", ")}`);
    }
  }
  const legAdvice = strN(enc.advice_notes)?.trim();
  if (legAdvice && !planBits.some((b) => b.includes(legAdvice))) planBits.push(`Advice: ${legAdvice}`);

  const pl = section("Plan / follow-up", planBits.join("\n"));
  if (pl) parts.push(pl);

  const fud = strN(enc.follow_up_date)?.trim();
  if (fud) parts.push(section("Follow-up", fud));

  return parts.filter(Boolean).join("\n\n").trim();
}

function strTrim(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Prefer CC / Findings / free-text clinical note when those columns exist;
 * otherwise use the full structured encounter summary (vitals, dx, plan, etc.).
 */
export function composePreauthClinicalSummary(data: Record<string, unknown>): string {
  let chief = strTrim(data.chief_complaint) || strTrim(data.chief_complaint_term) || "";
  if (!chief) {
    const ccFhir = data.chief_complaints_fhir;
    const arr = Array.isArray(ccFhir) ? ccFhir : parseJsonValue<unknown[]>(ccFhir);
    if (arr?.length) {
      const terms = arr
        .map((x) => (x && typeof x === "object" ? strTrim((x as FhirCoding).display) : ""))
        .filter(Boolean);
      if (terms.length) chief = terms.join("; ");
    }
  }
  let findings = strTrim(data.examination_findings);
  if (!findings) findings = strTrim(data.examination_term);
  if (!findings && data.quick_exam != null) {
    const qe = data.quick_exam;
    findings = Array.isArray(qe)
      ? (qe as unknown[]).map((x) => strTrim(x)).filter(Boolean).join("\n")
      : strTrim(qe);
  }
  const clinicalNote = strTrim(data.clinical_note) || strTrim(data.notes) || strTrim(data.hpi) || "";

  const parts: string[] = [];
  if (chief) parts.push(`CC: ${chief}`);
  if (findings) parts.push(`Findings: ${findings}`);
  if (clinicalNote) parts.push(clinicalNote);

  const quick = parts.join("\n\n");
  if (quick) return quick;
  return buildEncounterClinicalSummary(data);
}
