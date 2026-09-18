"use client";

import {
  isHardStopSeverity,
  type AllergyMatch,
  type DuplicateWarning,
  type InteractionWarning,
} from "@/hooks/usePrescriptionSafety";

/** How a cross-reactive match is explained to the prescriber. */
function allergyLine(m: AllergyMatch): string {
  if (m.match === "direct") return `matches a recorded allergy: ${m.allergen}`;
  return `cross-reacts with a recorded allergy to ${m.allergen}`;
}

/**
 * SOW §2.2 and §3.2 — two alert tiers only. Severe or contraindicated interactions and allergy
 * matches are hard stops that block finalisation; everything else is a passive advisory.
 */
export default function PrescribingSafetyBanner({
  interactions,
  duplicates,
  allergyMatches,
}: {
  interactions: InteractionWarning[];
  duplicates: DuplicateWarning[];
  allergyMatches: AllergyMatch[];
}) {
  const hardStops = interactions.filter((i) => isHardStopSeverity(i.severity));
  const advisories = interactions.filter((i) => !isHardStopSeverity(i.severity));
  // The blocking decision is the database's, not this component's, so a cephalosporin
  // after a penicillin allergy reads as a caution rather than a refusal.
  const allergyBlocks = allergyMatches.filter((m) => m.blocking);
  const allergyAdvisories = allergyMatches.filter((m) => !m.blocking);

  if (
    hardStops.length === 0 &&
    advisories.length === 0 &&
    duplicates.length === 0 &&
    allergyMatches.length === 0
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {(hardStops.length > 0 || allergyBlocks.length > 0) && (
        <section className="rounded-xl border-2 border-red-300 bg-red-50 p-3" role="alert">
          <h3 className="text-xs font-bold uppercase tracking-wide text-red-800">
            Blocked — resolve before finalising
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {allergyBlocks.map((m) => (
              <li key={`allergy-${m.drug}-${m.allergen}`} className="text-xs text-red-900">
                <span className="font-semibold capitalize">{m.drug}</span> {allergyLine(m)}
                {m.severity !== "unknown" ? (
                  <span className="ml-1 rounded bg-red-200 px-1 text-[10px] font-bold uppercase text-red-900">
                    {m.severity}
                  </span>
                ) : (
                  <span className="ml-1 text-[11px] text-red-700">(severity not recorded)</span>
                )}
                {m.note ? <span className="block text-[11px] text-red-700">{m.note}</span> : null}
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

      {(advisories.length > 0 || duplicates.length > 0 || allergyAdvisories.length > 0) && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-amber-900">Check before continuing</h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {allergyAdvisories.map((m) => (
              <li key={`allergy-adv-${m.drug}-${m.allergen}`} className="text-xs text-amber-900">
                <span className="font-semibold capitalize">{m.drug}</span> {allergyLine(m)}
                {m.note ? <span className="block text-[11px] text-amber-800">{m.note}</span> : null}
              </li>
            ))}
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
