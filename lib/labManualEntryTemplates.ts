/**
 * Parameter names for manual lab entry in the OCR modal, keyed by investigation.test_name.
 */
export function parameterNamesForOcrManualEntry(testName: string | null | undefined): string[] {
  const n = (testName ?? "").trim().toLowerCase();
  if (!n) return [];

  if (n.includes("cbc") || n.includes("complete blood")) {
    return ["Hb", "WBC", "Platelets", "RBC", "HCT", "MCV", "MCH", "MCHC"];
  }
  if (n.includes("lft") || n.includes("liver function") || n.includes("liver profile")) {
    return ["SGOT", "SGPT", "ALP", "Bilirubin Total", "Bilirubin Direct", "Albumin"];
  }
  if (n.includes("kft") || n.includes("rft") || n.includes("renal") || n.includes("kidney function")) {
    return ["Creatinine", "Urea", "Uric Acid", "eGFR"];
  }
  if (
    n.includes("pt/inr") ||
    n.includes("pt inr") ||
    n.includes("prothrombin") ||
    (n.includes("inr") && (n.includes("pt") || n.includes("coag")))
  ) {
    return ["PT Patient Value", "PT Control", "ISI", "INR"];
  }

  return [];
}

/** When no template matches, use this many blank parameter rows. */
export const OCR_MANUAL_DEFAULT_EMPTY_ROWS = 3;
