"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { supabase } from "../supabase";
import type { ClinicalChip, ClinicalLaterality, ClinicalSeverity } from "../lib/clinicalChipTypes";
import { clinicalChipVoiceDisplayLabel } from "../lib/clinicalChipTypes";
import { incrementDoctorConceptUsage } from "../lib/incrementDoctorConcept";
import { resnomedAfterClinicalChipEdit } from "../lib/resnomedClinicalChip";

export type ClinicalEntityChipPopoverProps = {
  chip: ClinicalChip;
  open: boolean;
  onClose: () => void;
  onSaved: (next: ClinicalChip) => void;
  hierarchy: "complaint" | "finding";
  contextType: "chief_complaint" | "examination";
  doctorSpecialty: string | null;
  doctorId: string | null;
  indiaRefset: string | null;
};

const LAT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bilateral", label: "Bilateral" },
];

const SEV_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
];

export default function ClinicalEntityChipPopover({
  chip,
  open,
  onClose,
  onSaved,
  hierarchy,
  contextType,
  doctorSpecialty,
  doctorId,
  indiaRefset,
}: ClinicalEntityChipPopoverProps) {
  const panelRef = useRef<HTMLFormElement>(null);
  const formId = useId();

  const [finding, setFinding] = useState(chip.finding);
  const [bodySite, setBodySite] = useState(chip.bodySite ?? "");
  const [laterality, setLaterality] = useState<string>(() =>
    chip.laterality ? chip.laterality : "",
  );
  const [duration, setDuration] = useState(chip.duration ?? "");
  const [severity, setSeverity] = useState<string>(() =>
    chip.severity ? chip.severity : "",
  );
  /** Doctor picked an alternative before Save — takes precedence over fresh lookup top hit. */
  const [manualPick, setManualPick] = useState<{ sctid: string; term: string } | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ sctid: string; term: string }>>(
    chip.snomedAlternatives ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFinding(chip.finding);
    setBodySite(chip.bodySite ?? "");
    setLaterality(chip.laterality ? chip.laterality : "");
    setDuration(chip.duration ?? "");
    setSeverity(chip.severity ? chip.severity : "");
    setManualPick(null);
    setSuggestions(chip.snomedAlternatives ?? []);
    setError(null);
  }, [open, chip]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      const anchor = document.querySelector(`[data-clinical-chip-anchor="${chip.id}"]`);
      if (anchor?.contains(t)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose, chip.id]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const lat: ClinicalLaterality =
        laterality === "left" || laterality === "right" || laterality === "bilateral"
          ? laterality
          : null;
      const sev: ClinicalSeverity =
        severity === "mild" || severity === "moderate" || severity === "severe" ? severity : null;
      const site = bodySite.trim() || null;

      const { top, alternatives } = await resnomedAfterClinicalChipEdit(supabase, {
        finding: finding.trim(),
        bodySite: site,
        laterality: lat,
        specialty: doctorSpecialty,
        doctorId,
        indiaRefset,
        hierarchy,
      });

      const pick = manualPick;
      let finalCode: string | null = null;
      let finalTerm: string;
      if (pick?.sctid?.trim()) {
        finalCode = pick.sctid.trim();
        finalTerm = pick.term.trim() || finding.trim();
      } else if (top?.conceptId?.trim()) {
        finalCode = top.conceptId.trim();
        finalTerm = top.term.trim();
      } else {
        finalTerm = finding.trim();
      }

      const altMapped = alternatives.map((a) => ({ sctid: a.conceptId.trim(), term: a.term.trim() }));
      const mergedSuggestions = altMapped.filter((a) => a.sctid && a.sctid !== finalCode).slice(0, 3);

      const next: ClinicalChip = {
        ...chip,
        finding: finding.trim(),
        bodySite: site,
        laterality: lat,
        duration: duration.trim() || null,
        severity: sev,
        snomedCode: finalCode,
        snomedTerm: finalTerm,
        snomedAlternatives: mergedSuggestions,
        isEdited: true,
        isConfirmed: Boolean(finalCode),
        snomedLowConfidence: !finalCode || Boolean(top?.lowConfidence && !pick),
      };

      if (doctorId?.trim() && finalCode) {
        await incrementDoctorConceptUsage(supabase, {
          doctorId: doctorId.trim(),
          sctid: finalCode,
          displayTerm: finding.trim() || finalTerm,
          contextType,
        });
      }

      onSaved(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    chip,
    finding,
    bodySite,
    laterality,
    duration,
    severity,
    manualPick,
    doctorSpecialty,
    doctorId,
    indiaRefset,
    hierarchy,
    contextType,
    onSaved,
    onClose,
  ]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function selectSuggestion(sctid: string, sterm: string) {
    setManualPick({ sctid, term: sterm });
  }

  const previewChip = useMemo((): ClinicalChip => {
    const lat: ClinicalLaterality =
      laterality === "left" || laterality === "right" || laterality === "bilateral"
        ? laterality
        : null;
    return {
      ...chip,
      finding: finding.trim(),
      bodySite: bodySite.trim() || null,
      laterality: lat,
    };
  }, [chip, finding, bodySite, laterality]);

  if (!open) return null;

  const displayCode = manualPick?.sctid ?? chip.snomedCode ?? "";
  /** Prefer doctor wording; manual SNOMED pick shows that concept's term next to the code. */
  const displayTerm = manualPick?.term ?? clinicalChipVoiceDisplayLabel(previewChip);

  return (
    <form
      ref={panelRef}
      role="dialog"
      aria-labelledby={`${formId}-title`}
      className="absolute left-0 top-full z-[60] mt-1 w-[min(100vw-1.5rem,320px)] rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <p id={`${formId}-title`} className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        Edit clinical entity
      </p>
      {error && (
        <p className="mb-2 text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="grid max-h-[min(70vh,420px)] gap-2 overflow-y-auto pr-0.5">
        <label className="block">
          <span className="text-[10px] font-semibold text-gray-500">Finding</span>
          <input
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1.5 text-[12px] text-gray-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-gray-500">Body site</span>
          <input
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1.5 text-[12px] text-gray-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            value={bodySite}
            onChange={(e) => setBodySite(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-gray-500">Laterality</span>
          <select
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1.5 text-[12px] text-gray-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            value={laterality}
            onChange={(e) => setLaterality(e.target.value)}
          >
            {LAT_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-gray-500">Duration</span>
          <input
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1.5 text-[12px] text-gray-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold text-gray-500">Severity</span>
          <select
            className="mt-0.5 w-full rounded border border-gray-200 px-2 py-1.5 text-[12px] text-gray-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            {SEV_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded border border-gray-100 bg-gray-50/80 px-2 py-1.5">
          <p className="text-[10px] font-semibold text-gray-500">Current</p>
          <p className="mt-0.5 text-[11px] text-gray-800">
            {displayCode ? (
              <>
                {displayTerm} <span className="font-mono text-[10px] text-gray-600">(SCTID: {displayCode})</span>{" "}
                <span className="text-emerald-600">✓</span>
              </>
            ) : (
              <span className="text-amber-700">No code — Save runs SNOMED lookup</span>
            )}
          </p>
        </div>

        {suggestions.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-gray-500">Alternatives</p>
            <ul className="mt-1 space-y-0.5">
              {suggestions.slice(0, 3).map((s) => {
                const active = manualPick?.sctid === s.sctid;
                return (
                  <li key={s.sctid}>
                    <button
                      type="button"
                      className={`w-full rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-emerald-50 ${
                        active ? "bg-emerald-50 ring-1 ring-emerald-200" : "text-gray-800"
                      }`}
                      onClick={() => selectSuggestion(s.sctid, s.term)}
                    >
                      <span className="text-emerald-600">→</span> {s.term}{" "}
                      <span className="font-mono text-[10px] text-gray-500">(SCTID: {s.sctid})</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2 border-t border-gray-100 pt-2">
        <button
          type="button"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          disabled={saving || !finding.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

export function ClinicalChipEditedMarker({ className }: { className?: string }) {
  return <Pencil className={className ?? "h-3 w-3 shrink-0 text-sky-600"} strokeWidth={2} aria-hidden />;
}
