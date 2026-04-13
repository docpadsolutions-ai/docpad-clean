"use client";

import { useCallback, useEffect, useState } from "react";
import VoiceDictationButton, { type ClinicalFinding } from "../VoiceDictationButton";
import SnomedSearch, { buildSnomedSearchQueryString } from "../SnomedSearch";
import {
  SNOMED_ECL_CLINICAL_FINDING,
  SNOMED_ECL_MSK_FINDING,
  isOrthopedicsSpecialty,
} from "../../lib/ipdSnomedEcl";
import ClinicalEntityChipPopover, { ClinicalChipEditedMarker } from "../ClinicalEntityChipPopover";
import {
  clinicalChipFromVoiceFinding,
  clinicalChipPrimaryLabel,
  newClinicalChipId,
  type ClinicalChip,
} from "../../lib/clinicalChipTypes";
import type { IpdDiagnosisEntry } from "../../lib/ipdProgressNoteSnomed";
import { cn } from "@/lib/utils";

const IPD_CHIP_WRAP =
  "inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm text-blue-700 shadow-sm";
const IPD_CHIP_MAIN =
  "inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent py-0 text-left text-sm font-medium text-blue-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
const IPD_CHIP_REMOVE =
  "shrink-0 border-0 border-l border-blue-200 bg-transparent px-2 py-1 text-blue-400 transition hover:text-blue-600";

function DiagnosisEditOverlay({
  open,
  entry,
  index,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  entry: IpdDiagnosisEntry | null;
  index: number;
  onClose: () => void;
  onSave: (idx: number, next: IpdDiagnosisEntry) => void;
  onRemove: (idx: number) => void;
}) {
  const [term, setTerm] = useState(entry?.term ?? "");
  useEffect(() => {
    if (entry) setTerm(entry.term);
  }, [entry]);
  if (!open || !entry) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-gray-900">Edit diagnosis</h3>
        <label className="mt-3 block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">Display term</span>
          <input
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-sky-500"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-[10px] font-semibold text-gray-500">SNOMED CT</p>
          <p className="mt-0.5 font-mono text-[12px] text-gray-800">{entry.snomed?.trim() || "—"}</p>
        </div>
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-[10px] font-semibold text-gray-500">ICD-10</p>
          <p className="mt-0.5 text-[12px] text-gray-800">{entry.icd10?.trim() || "—"}</p>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-800 hover:bg-red-100"
            onClick={() => {
              onRemove(index);
              onClose();
            }}
          >
            Remove term
          </button>
          <button
            type="button"
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500"
            onClick={() => {
              const t = term.trim() || entry.term;
              onSave(index, { ...entry, term: t });
              onClose();
            }}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

export function IpdSubjectiveSnomedBlock({
  signed,
  specialty,
  practitionerId,
  indiaRefset,
  chips,
  onSetChips,
  complaintQuery,
  onComplaintQuery,
  freeText,
  onFreeText,
}: {
  signed: boolean;
  specialty: string;
  practitionerId: string | null;
  indiaRefset: string | null;
  chips: ClinicalChip[];
  onSetChips: (fn: (prev: ClinicalChip[]) => ClinicalChip[]) => void;
  complaintQuery: string;
  onComplaintQuery: (v: string) => void;
  freeText: string;
  onFreeText: (v: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [snomedLinking, setSnomedLinking] = useState(false);

  const handleComplaintSelect = (concept: { term: string; conceptId: string; icd10: string | null }) => {
    const newTerm = concept.term.trim();
    if (chips.some((c) => clinicalChipPrimaryLabel(c).toLowerCase() === newTerm.toLowerCase())) return;
    const row: ClinicalChip = {
      id: newClinicalChipId(),
      finding: newTerm,
      bodySite: null,
      laterality: null,
      duration: null,
      severity: null,
      negation: false,
      snomedCode: concept.conceptId.trim(),
      snomedTerm: newTerm,
      snomedAlternatives: [],
      isEdited: false,
      isConfirmed: true,
      rawText: "",
      snomedLowConfidence: false,
    };
    onSetChips((prev) => [...prev, row]);
    onComplaintQuery("");
  };

  const removeById = (id: string) => {
    onSetChips((prev) => prev.filter((c) => c.id !== id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Patient complaints</span>
        <div className={cn(signed && "pointer-events-none opacity-50")}>
          <VoiceDictationButton
            contextType="complaint"
            specialty={specialty}
            doctorId={practitionerId ?? undefined}
            indiaRefset={indiaRefset ?? undefined}
            variant="slate"
            onTranscriptUpdate={(text, isFinal) => {
              onComplaintQuery(text);
              if (isFinal) onComplaintQuery("");
            }}
            onExtractionComplete={(raw) => {
              const findings = raw as ClinicalFinding[];
              if (!Array.isArray(findings) || findings.length === 0) return;
              setSnomedLinking(true);
              try {
                const resolved = findings.map((f) => clinicalChipFromVoiceFinding(f));
                onSetChips((prev) => [...prev, ...resolved]);
                onComplaintQuery("");
              } finally {
                setSnomedLinking(false);
              }
            }}
            className="scale-90"
          />
        </div>
      </div>
      {(chips.length > 0 || snomedLinking) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const label = clinicalChipPrimaryLabel(c);
            return (
              <span key={c.id} data-clinical-chip-anchor={c.id} className="relative inline-flex max-w-full flex-col">
                <span className={cn(IPD_CHIP_WRAP)}>
                  <button
                    type="button"
                    className={IPD_CHIP_MAIN}
                    title={c.snomedCode?.trim() ? `SNOMED CT: ${c.snomedCode.trim()}` : "No SNOMED code — click to edit"}
                    disabled={signed}
                    onClick={() => {
                      if (signed) return;
                      setEditingId((x) => (x === c.id ? null : c.id));
                    }}
                  >
                    {c.isEdited ? <ClinicalChipEditedMarker className="h-3 w-3 shrink-0 text-blue-300" /> : null}
                    <span className="min-w-0">{label}</span>
                  </button>
                  <button
                    type="button"
                    disabled={signed}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (signed) return;
                      removeById(c.id);
                    }}
                    className={IPD_CHIP_REMOVE}
                    aria-label={`Remove ${label}`}
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
                <ClinicalEntityChipPopover
                  chip={c}
                  open={editingId === c.id}
                  onClose={() => setEditingId(null)}
                  onSaved={(next) => onSetChips((prev) => prev.map((row) => (row.id === next.id ? next : row)))}
                  hierarchy="complaint"
                  contextType="chief_complaint"
                  doctorSpecialty={specialty}
                  doctorId={practitionerId}
                  indiaRefset={indiaRefset}
                />
              </span>
            );
          })}
          {snomedLinking && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-medium text-purple-900">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              Linking SNOMED…
            </span>
          )}
        </div>
      )}
      <p className="mb-1 text-[10px] font-medium text-slate-500">+ Add complaint (SNOMED)</p>
      <div className={cn(signed && "pointer-events-none opacity-50")}>
        <SnomedSearch
          placeholder="Search complaint (e.g. knee pain)…"
          hierarchy="complaint"
          allowFreeTextNoCode
          ecl={SNOMED_ECL_CLINICAL_FINDING}
          cacheFilter="finding_diagnosis"
          conceptCacheType="finding"
          value={complaintQuery}
          onChange={onComplaintQuery}
          onSelect={handleComplaintSelect}
          indiaRefset={indiaRefset ?? undefined}
          specialty={specialty}
          doctorId={practitionerId ?? undefined}
        />
      </div>
      <textarea
        readOnly={signed}
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
        placeholder="Additional free-text complaints…"
        className={cn(
          "mt-3 min-h-[72px] w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500",
          signed && "cursor-default bg-slate-100 focus-visible:ring-0",
        )}
      />
    </div>
  );
}

export function IpdExaminationSnomedBlock({
  signed,
  specialty,
  practitionerId,
  indiaRefset,
  chips,
  onSetChips,
  examQuery,
  onExamQuery,
  freeText,
  onFreeText,
}: {
  signed: boolean;
  specialty: string;
  practitionerId: string | null;
  indiaRefset: string | null;
  chips: ClinicalChip[];
  onSetChips: (fn: (prev: ClinicalChip[]) => ClinicalChip[]) => void;
  examQuery: string;
  onExamQuery: (v: string) => void;
  freeText: string;
  onFreeText: (v: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [snomedLinking, setSnomedLinking] = useState(false);

  const examFindingEcl = isOrthopedicsSpecialty(specialty) ? SNOMED_ECL_MSK_FINDING : SNOMED_ECL_CLINICAL_FINDING;

  const handleExamSelect = (concept: { term: string; conceptId: string; icd10: string | null }) => {
    const newTerm = concept.term.trim();
    if (chips.some((c) => clinicalChipPrimaryLabel(c).toLowerCase() === newTerm.toLowerCase())) return;
    const row: ClinicalChip = {
      id: newClinicalChipId(),
      finding: newTerm,
      bodySite: null,
      laterality: null,
      duration: null,
      severity: null,
      negation: false,
      snomedCode: concept.conceptId.trim(),
      snomedTerm: newTerm,
      snomedAlternatives: [],
      isEdited: false,
      isConfirmed: true,
      rawText: "",
      snomedLowConfidence: false,
    };
    onSetChips((prev) => [...prev, row]);
    onExamQuery("");
  };

  const removeById = (id: string) => {
    onSetChips((prev) => prev.filter((c) => c.id !== id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Examination findings</span>
        <div className={cn(signed && "pointer-events-none opacity-50")}>
          <VoiceDictationButton
            contextType="examination"
            specialty={specialty}
            doctorId={practitionerId ?? undefined}
            indiaRefset={indiaRefset ?? undefined}
            variant="slate"
            onTranscriptUpdate={(text, isFinal) => {
              onExamQuery(text);
              if (isFinal) onExamQuery("");
            }}
            onExtractionComplete={(raw) => {
              const findings = raw as ClinicalFinding[];
              if (!Array.isArray(findings) || findings.length === 0) return;
              setSnomedLinking(true);
              try {
                const resolved = findings.map((f) => clinicalChipFromVoiceFinding(f));
                onSetChips((prev) => [...prev, ...resolved]);
                onExamQuery("");
              } finally {
                setSnomedLinking(false);
              }
            }}
            className="scale-90"
          />
        </div>
      </div>
      {(chips.length > 0 || snomedLinking) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const label = clinicalChipPrimaryLabel(c);
            return (
              <span key={c.id} data-clinical-chip-anchor={c.id} className="relative inline-flex max-w-full flex-col">
                <span className={cn(IPD_CHIP_WRAP)}>
                  <button
                    type="button"
                    className={IPD_CHIP_MAIN}
                    title={c.snomedCode?.trim() ? `SNOMED CT: ${c.snomedCode.trim()}` : "No SNOMED code — click to edit"}
                    disabled={signed}
                    onClick={() => {
                      if (signed) return;
                      setEditingId((x) => (x === c.id ? null : c.id));
                    }}
                  >
                    {c.isEdited ? <ClinicalChipEditedMarker className="h-3 w-3 shrink-0 text-blue-300" /> : null}
                    <span className="min-w-0">{label}</span>
                  </button>
                  <button
                    type="button"
                    disabled={signed}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (signed) return;
                      removeById(c.id);
                    }}
                    className={IPD_CHIP_REMOVE}
                    aria-label={`Remove ${label}`}
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
                <ClinicalEntityChipPopover
                  chip={c}
                  open={editingId === c.id}
                  onClose={() => setEditingId(null)}
                  onSaved={(next) => onSetChips((prev) => prev.map((row) => (row.id === next.id ? next : row)))}
                  hierarchy="finding"
                  contextType="examination"
                  doctorSpecialty={specialty}
                  doctorId={practitionerId}
                  indiaRefset={indiaRefset}
                />
              </span>
            );
          })}
          {snomedLinking && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-medium text-purple-900">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              Linking SNOMED…
            </span>
          )}
        </div>
      )}
      <p className="mb-1 text-[10px] font-medium text-slate-500">+ Add finding (SNOMED)</p>
      <div className={cn(signed && "pointer-events-none opacity-50")}>
        <SnomedSearch
          placeholder="Search examination finding…"
          hierarchy="finding"
          allowFreeTextNoCode
          ecl={examFindingEcl}
          cacheFilter="finding_diagnosis"
          conceptCacheType="finding"
          value={examQuery}
          onChange={onExamQuery}
          onSelect={handleExamSelect}
          indiaRefset={indiaRefset ?? undefined}
          specialty={specialty}
          doctorId={practitionerId ?? undefined}
        />
      </div>
      <textarea
        readOnly={signed}
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
        placeholder="Additional free-text examination notes…"
        className={cn(
          "mt-3 min-h-[72px] w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500",
          signed && "cursor-default bg-slate-100 focus-visible:ring-0",
        )}
      />
    </div>
  );
}

export function IpdAssessmentSnomedBlock({
  signed,
  specialty,
  practitionerId,
  indiaRefset,
  entries,
  onSetEntries,
  diagnosisQuery,
  onDiagnosisQuery,
  freeText,
  onFreeText,
}: {
  signed: boolean;
  specialty: string;
  practitionerId: string | null;
  indiaRefset: string | null;
  entries: IpdDiagnosisEntry[];
  onSetEntries: (fn: (prev: IpdDiagnosisEntry[]) => IpdDiagnosisEntry[]) => void;
  diagnosisQuery: string;
  onDiagnosisQuery: (v: string) => void;
  freeText: string;
  onFreeText: (v: string) => void;
}) {
  const [snomedLinkingDx, setSnomedLinkingDx] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const resolveVoiceDiagnoses = useCallback(
    async (rows: { diagnosis?: string }[]) => {
      const resolvedItems: IpdDiagnosisEntry[] = [];
      for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        const label = (r.diagnosis ?? "").trim();
        if (!label) continue;
        try {
          const qs = buildSnomedSearchQueryString({
            q: label,
            hierarchy: "diagnosis",
            ecl: SNOMED_ECL_CLINICAL_FINDING,
            cacheFilter: "finding_diagnosis",
            conceptCacheType: "finding",
            indiaRefset: indiaRefset ?? undefined,
            specialty,
            doctorId: practitionerId ?? undefined,
          });
          const res = await fetch(`/api/snomed/search?${qs}`);
          const data = (await res.json()) as {
            results?: Array<{ term: string; conceptId: string; icd10: string | null }>;
          };
          const top = data.results?.[0];
          resolvedItems.push({
            term: top?.term ?? label,
            snomed: top?.conceptId ?? "",
            icd10: top?.icd10 ?? null,
          });
        } catch {
          resolvedItems.push({ term: label, snomed: "", icd10: null });
        }
        if (idx < rows.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      onSetEntries((prev) => {
        const next = [...prev];
        for (const row of resolvedItems) {
          if (!row.term) continue;
          if (next.some((d) => d.term.toLowerCase() === row.term.toLowerCase())) continue;
          next.push(row);
        }
        return next;
      });
    },
    [indiaRefset, onSetEntries, practitionerId, specialty],
  );

  const handleDiagnosisSelect = (concept: { term: string; conceptId: string; icd10: string | null }) => {
    const newTerm = concept.term.trim();
    onSetEntries((prev) => {
      if (prev.some((d) => d.term.toLowerCase() === newTerm.toLowerCase())) return prev;
      return [...prev, { term: newTerm, snomed: concept.conceptId, icd10: concept.icd10 ?? null }];
    });
    onDiagnosisQuery("");
  };

  const removeAt = (index: number) => {
    onSetEntries((prev) => prev.filter((_, j) => j !== index));
    if (editIdx === index) setEditIdx(null);
  };

  const editingEntry = editIdx != null ? entries[editIdx] ?? null : null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Assessment</span>
        <div className={cn(signed && "pointer-events-none opacity-50")}>
          <VoiceDictationButton
            contextType="diagnosis"
            specialty={specialty}
            doctorId={practitionerId ?? undefined}
            indiaRefset={indiaRefset ?? undefined}
            variant="slate"
            onTranscriptUpdate={(text, isFinal) => {
              onDiagnosisQuery(text);
              if (isFinal) onDiagnosisQuery("");
            }}
            onExtractionComplete={async (payload) => {
              const rows = payload as { diagnosis?: string }[];
              if (!Array.isArray(rows) || rows.length === 0) return;
              setSnomedLinkingDx(true);
              try {
                await resolveVoiceDiagnoses(rows);
              } finally {
                setSnomedLinkingDx(false);
              }
            }}
            className="scale-90"
          />
        </div>
      </div>
      {(entries.length > 0 || snomedLinkingDx) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {entries.map((d, i) => (
            <span key={`dx-${d.term}-${i}`} className={cn(IPD_CHIP_WRAP, "items-center")}>
              <button
                type="button"
                className={IPD_CHIP_MAIN}
                title={d.snomed?.trim() ? `SNOMED CT: ${d.snomed.trim()}` : "No SNOMED code"}
                disabled={signed}
                onClick={() => {
                  if (signed) return;
                  setEditIdx((x) => (x === i ? null : i));
                }}
              >
                <span className="min-w-0 capitalize">{d.term}</span>
              </button>
              <button
                type="button"
                disabled={signed}
                onClick={(e) => {
                  e.stopPropagation();
                  if (signed) return;
                  removeAt(i);
                }}
                className={IPD_CHIP_REMOVE}
                aria-label={`Remove ${d.term}`}
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
          {snomedLinkingDx && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-medium text-purple-900">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              Linking SNOMED…
            </span>
          )}
        </div>
      )}
      <p className="mb-1 text-[10px] font-medium text-slate-500">+ Add diagnosis (SNOMED)</p>
      <div className={cn(signed && "pointer-events-none opacity-50")}>
        <SnomedSearch
          placeholder="Search diagnosis (e.g. osteoarthritis of knee)…"
          hierarchy="diagnosis"
          allowFreeTextNoCode
          ecl={SNOMED_ECL_CLINICAL_FINDING}
          cacheFilter="finding_diagnosis"
          conceptCacheType="finding"
          value={diagnosisQuery}
          onChange={onDiagnosisQuery}
          onSelect={handleDiagnosisSelect}
          indiaRefset={indiaRefset ?? undefined}
          specialty={specialty}
          doctorId={practitionerId ?? undefined}
        />
      </div>
      <textarea
        readOnly={signed}
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
        placeholder="Additional free-text assessment…"
        className={cn(
          "mt-3 min-h-[72px] w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500",
          signed && "cursor-default bg-slate-100 focus-visible:ring-0",
        )}
      />
      <DiagnosisEditOverlay
        open={editIdx != null && editingEntry != null}
        index={editIdx ?? -1}
        entry={editingEntry}
        onClose={() => setEditIdx(null)}
        onSave={(idx, next) => onSetEntries((prev) => prev.map((row, j) => (j === idx ? next : row)))}
        onRemove={(idx) => removeAt(idx)}
      />
    </div>
  );
}
