"use client";

import {
  isHardStopSeverity,
  type DuplicateWarning,
  type InteractionWarning,
} from "@/hooks/usePrescriptionSafety";

export type AllergyConflict = { medicine_name: string; allergy: string };

/**
 * SOW §2.2 and §3.2 — two alert tiers only. Severe or contraindicated interactions and allergy
 * matches are hard stops that block finalisation; everything else is a passive advisory.
 */
export default function PrescribingSafetyBanner({
  interactions,
  duplicates,
  allergyConflicts,
}: {
  interactions: InteractionWarning[];
  duplicates: DuplicateWarning[];
  allergyConflicts: AllergyConflict[];
}) {
  const hardStops = interactions.filter((i) => isHardStopSeverity(i.severity));
  const advisories = interactions.filter((i) => !isHardStopSeverity(i.severity));

  if (hardStops.length === 0 && advisories.length === 0 && duplicates.length === 0 && allergyConflicts.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {(hardStops.length > 0 || allergyConflicts.length > 0) && (
        <section className="rounded-xl border-2 border-red-300 bg-red-50 p-3" role="alert">
          <h3 className="text-xs font-bold uppercase tracking-wide text-red-800">
            Blocked — resolve before finalising
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {allergyConflicts.map((conflict) => (
              <li key={`allergy-${conflict.medicine_name}-${conflict.allergy}`} className="text-xs text-red-900">
                <span className="font-semibold">{conflict.medicine_name}</span> matches a recorded allergy:{" "}
                <span className="font-semibold">{conflict.allergy}</span>
              </li>
            ))}
            {hardStops.map((warning, index) => (
              <li key={`hard-${warning.drug_a}-${warning.drug_b}-${index}`} className="text-xs text-red-900">
                <span className="font-semibold capitalize">{warning.severity}</span>:{" "}
                <span className="font-semibold">{warning.drug_a}</span> +{" "}
                <span className="font-semibold">{warning.drug_b}</span>
                {warning.involves_active ? (
                  <span className="ml-1 rounded bg-red-200 px-1 text-[10px] font-bold uppercase text-red-900">
                    active medication
                  </span>
                ) : null}
                {warning.description ? <span className="block text-red-800">{warning.description}</span> : null}
                {warning.management ? (
                  <span className="block text-[11px] text-red-700">Management: {warning.management}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-red-700">
            Remove or replace the medication to continue. Nothing is written to the record until this clears.
          </p>
        </section>
      )}

      {(advisories.length > 0 || duplicates.length > 0) && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-amber-900">Check before continuing</h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {duplicates.map((dup, index) => (
              <li key={`dup-${dup.active_prescription_id}-${index}`} className="text-xs text-amber-900">
                <span className="font-semibold">{dup.medicine_name}</span> repeats an active medication:{" "}
                <span className="font-semibold">{dup.active_medicine_name}</span>
                {dup.generic_name ? <span className="text-amber-800"> ({dup.generic_name})</span> : null}
              </li>
            ))}
            {advisories.map((warning, index) => (
              <li key={`adv-${warning.drug_a}-${warning.drug_b}-${index}`} className="text-xs text-amber-900">
                <span className="font-semibold capitalize">{warning.severity}</span>: {warning.drug_a} +{" "}
                {warning.drug_b}
                {warning.involves_active ? (
                  <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] font-bold uppercase text-amber-900">
                    active medication
                  </span>
                ) : null}
                {warning.description ? <span className="block text-amber-800">{warning.description}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
