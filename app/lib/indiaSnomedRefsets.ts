/**
 * India NRC reference set SCTIDs (column `refsetId` from RF2 `der2_Refset_*Snapshot` files).
 * Used in ECL as: `(<< …) AND ^ <refsetId>` via Ontoserver `$expand`.
 */
export const INDIA_SNOMED_REFSET_IDS: Record<string, string> = {
  cardiology: "1131000189100",
  cardiothoracicAndVascularSurgery: "1141000189106",
  cataract: "1001000189107",
  cervicalCancer: "1011000189109",
  childhoodDiarrhea: "1021000189101",
  dengue: "1031000189104",
  dermatology: "1151000189109",
  emergency: "1161000189107",
  fetalMedicine: "1171000189103",
  gastroenterology: "1181000189101",
  generalSurgery: "1191000189104",
  geriatrics: "1201000189102",
  iodineDeficiency: "1041000189105",
  leprosy: "1051000189108",
  lymphaticFilariasis: "1061000189106",
  malaria: "1071000189102",
  nephrology: "1211000189100",
  neurology: "1221000189108",
  neurosurgery: "1231000189105",
  obstetricsAndGynecology: "1241000189104",
  oncology: "1251000189101",
  oralCancer: "1081000189100",
  orthopedics: "1261000189103",
  pediatrics: "1271000189107",
  pregnancyRelatedAnemia: "1091000189103",
  psychiatry: "1281000189109",
  radiology: "1291000189106",
  rheumatology: "1301000189105",
  stroke: "1101000189108",
  tuberculosis: "1111000189105",
};

export type IndiaSnomedRefsetKey = keyof typeof INDIA_SNOMED_REFSET_IDS;

export function resolveIndiaRefsetId(key: string | null | undefined): string | null {
  if (key == null || String(key).trim() === "") return null;
  const k = String(key).trim() as IndiaSnomedRefsetKey;
  const id = INDIA_SNOMED_REFSET_IDS[k];
  return id ?? null;
}
