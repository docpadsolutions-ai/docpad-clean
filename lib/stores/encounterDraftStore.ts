import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ClinicalChip } from "@/lib/clinicalChipTypes";
import type { VoiceRxPrefillRow } from "@/lib/prescriptionLine";

/** Mirrors `PersistedSnomedPick` on the OPD encounter page. */
export type EncounterDraftSnomedPick = {
  term: string;
  conceptId: string;
};

export type EncounterDraftDiagnosisEntry = {
  term: string;
  snomed: string;
  icd10: string | null;
};

/**
 * Session draft for the OPD encounter chart — grouped like SOAP sections.
 * Fields align with `app/dashboard/opd/encounter/[id]/page.tsx` clinical state.
 */
export type EncounterDraft = {
  chiefComplaint: {
    chiefComplaintText: string;
    chiefComplaintSnomed: string | null;
    selectedComplaintLabel: string | null;
    durationText: string;
    voiceComplaints: ClinicalChip[];
    complaintQuery: string;
    selectedChiefComplaintConcept: EncounterDraftSnomedPick | null;
  };
  history: {
    allergiesText: string;
    allergiesSnomed: string;
    procedureText: string;
    procedureSnomed: string;
    department: string;
  };
  examination: {
    examQuery: string;
    selectedExaminationConcept: EncounterDraftSnomedPick | null;
    examFindings: ClinicalChip[];
  };
  diagnosis: {
    diagnosisEntries: EncounterDraftDiagnosisEntry[];
    diagnosisQuery: string;
    selectedDiagnosisConcept: EncounterDraftSnomedPick | null;
  };
  plan: {
    adviceText: string;
    adviceOpen: boolean;
    selectedAdviceTemplateId: string;
    includeAdviceOnPrescription: boolean;
    planInvestigations: string[];
    voiceRxPrefill: VoiceRxPrefillRow[];
    followUpDate: string;
  };
  vitals: {
    weight: string;
    bloodPressure: string;
    pulse: string;
    temperature: string;
    spo2: string;
    tempUnit: "C" | "F";
  };
  notes: {
    triageNotesText: string;
  };
};

export type EncounterDraftPartial = {
  chiefComplaint?: Partial<EncounterDraft["chiefComplaint"]>;
  history?: Partial<EncounterDraft["history"]>;
  examination?: Partial<EncounterDraft["examination"]>;
  diagnosis?: Partial<EncounterDraft["diagnosis"]>;
  plan?: Partial<EncounterDraft["plan"]>;
  vitals?: Partial<EncounterDraft["vitals"]>;
  notes?: Partial<EncounterDraft["notes"]>;
};

export function createEmptyEncounterDraft(): EncounterDraft {
  return {
    chiefComplaint: {
      chiefComplaintText: "",
      chiefComplaintSnomed: null,
      selectedComplaintLabel: null,
      durationText: "",
      voiceComplaints: [],
      complaintQuery: "",
      selectedChiefComplaintConcept: null,
    },
    history: {
      allergiesText: "",
      allergiesSnomed: "",
      procedureText: "",
      procedureSnomed: "",
      department: "General Medicine",
    },
    examination: {
      examQuery: "",
      selectedExaminationConcept: null,
      examFindings: [],
    },
    diagnosis: {
      diagnosisEntries: [],
      diagnosisQuery: "",
      selectedDiagnosisConcept: null,
    },
    plan: {
      adviceText: "",
      adviceOpen: true,
      selectedAdviceTemplateId: "",
      includeAdviceOnPrescription: true,
      planInvestigations: [],
      voiceRxPrefill: [],
      followUpDate: "",
    },
    vitals: {
      weight: "",
      bloodPressure: "",
      pulse: "",
      temperature: "",
      spo2: "",
      tempUnit: "C",
    },
    notes: {
      triageNotesText: "",
    },
  };
}

function mergeEncounterDraft(
  prev: EncounterDraft | undefined,
  partial: EncounterDraftPartial,
): EncounterDraft {
  const base = prev ?? createEmptyEncounterDraft();
  return {
    chiefComplaint: { ...base.chiefComplaint, ...partial.chiefComplaint },
    history: { ...base.history, ...partial.history },
    examination: { ...base.examination, ...partial.examination },
    diagnosis: { ...base.diagnosis, ...partial.diagnosis },
    plan: { ...base.plan, ...partial.plan },
    vitals: { ...base.vitals, ...partial.vitals },
    notes: { ...base.notes, ...partial.notes },
  };
}

type EncounterDraftStoreState = {
  draftsByEncounterId: Record<string, EncounterDraft>;
  getDraft: (encounterId: string) => EncounterDraft | undefined;
  setDraft: (encounterId: string, fields: EncounterDraftPartial) => void;
  clearDraft: (encounterId: string) => void;
};

export const useEncounterDraftStore = create<EncounterDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByEncounterId: {},

      getDraft: (encounterId) => get().draftsByEncounterId[encounterId],

      setDraft: (encounterId, fields) =>
        set((state) => {
          const prev = state.draftsByEncounterId[encounterId];
          const merged = mergeEncounterDraft(prev, fields);
          return {
            draftsByEncounterId: {
              ...state.draftsByEncounterId,
              [encounterId]: merged,
            },
          };
        }),

      clearDraft: (encounterId) =>
        set((state) => {
          if (!(encounterId in state.draftsByEncounterId)) return state;
          const next = { ...state.draftsByEncounterId };
          delete next[encounterId];
          return { draftsByEncounterId: next };
        }),
    }),
    {
      name: "encounter-drafts",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ draftsByEncounterId: state.draftsByEncounterId }),
    },
  ),
);
