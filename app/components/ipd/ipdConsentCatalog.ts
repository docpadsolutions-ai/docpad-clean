/** Static catalog for pre-admission modal; DB rows may use matching `consent_key` or `code`. */
export type IpdConsentCatalogRow = {
  key: string;
  name: string;
  description: string;
  mandatory: boolean;
};

export const IPD_ADMISSION_CONSENT_CATALOG: IpdConsentCatalogRow[] = [
  {
    key: "general_admission",
    name: "General Admission & Treatment Consent",
    description: "Patient rights, treatment authorization",
    mandatory: true,
  },
  {
    key: "dpdpa",
    name: "Digital Health Data Consent (DPDPA)",
    description: "Data collection, ABHA linking, privacy rights",
    mandatory: true,
  },
  {
    key: "financial",
    name: "Financial Responsibility Agreement",
    description: "Payment terms and billing authorization",
    mandatory: true,
  },
  {
    key: "anesthesia",
    name: "Anesthesia & Procedure Consent",
    description: "When applicable to planned interventions",
    mandatory: false,
  },
  {
    key: "blood_products",
    name: "Blood & Blood Products",
    description: "If transfusion may be required",
    mandatory: false,
  },
  {
    key: "photography_media",
    name: "Photography / Teaching / Media",
    description: "Optional use of images for care or education",
    mandatory: false,
  },
];
