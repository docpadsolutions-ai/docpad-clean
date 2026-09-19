"use client";

import { Droplet } from "lucide-react";
import { PatientAvatar } from "@/components/patient/patient-avatar";
import { usePatientIdentity, type PatientIdentity } from "@/hooks/usePatientIdentity";

/**
 * The compact form of the patient banner, for clinical screens that are not the
 * encounter chart.
 *
 * Proposal v1.0 2.3 asks for this on every clinical screen. It was on exactly one:
 * the OPD encounter page, via PatientEncounterBanner, which is a page header with an
 * h1 and is the wrong shape for a sub-page. IPD rolled its own strip with different
 * fields in different markup. The investigations screens, where a result is read and
 * acted on, showed no patient identity at all.
 *
 * Both the CR number and the DocPad ID are shown, and the CR number is given the
 * prominence, because it is the one the patient is holding on a card and can read
 * back to you. Verifying identity against a number only the system knows is not
 * verification.
 */
export default function PatientIdentityBar({
  patientId,
  identity: given,
  context,
  rightSlot,
  sticky = true,
}: {
  patientId?: string | null;
  /** Pass this when the page already has the row and does not need a second fetch. */
  identity?: PatientIdentity | null;
  /** Where the user is, e.g. "Investigations" or "Ward 3 · Bed 12". */
  context?: string | null;
  rightSlot?: React.ReactNode;
  sticky?: boolean;
}) {
  const { identity: fetched, loading } = usePatientIdentity(given ? null : patientId);
  const p = given ?? fetched;

  if (!p && !loading) return null;

  const sexLabel =
    p?.sex && String(p.sex).trim() !== ""
      ? String(p.sex).trim().charAt(0).toUpperCase() + String(p.sex).trim().slice(1).toLowerCase()
      : null;

  const meta = [
    p?.ageYears != null ? `${p.ageYears} years` : null,
    sexLabel,
    context?.trim() || null,
  ].filter(Boolean);

  return (
    <div
      className={`${sticky ? "sticky top-0 z-40" : ""} border-b border-slate-200 bg-white/95 backdrop-blur`}
      aria-label="Patient"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
        {p ? (
          <>
            <PatientAvatar patientId={p.id} patientName={p.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-bold text-slate-900">{p.name}</span>
                {p.bloodGroup?.trim() ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700">
                    <Droplet className="h-3 w-3" aria-hidden />
                    {p.bloodGroup.trim()}
                  </span>
                ) : null}
              </div>
              {meta.length > 0 ? (
                <p className="truncate text-xs text-slate-600">{meta.join(" · ")}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              {p.crNumber?.trim() ? (
                <span className="rounded-md bg-slate-900 px-2 py-1 font-bold tabular-nums text-white">
                  CR {p.crNumber.trim()}
                </span>
              ) : null}
              {p.docpadId?.trim() ? (
                <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                  {p.docpadId.trim()}
                </span>
              ) : null}
            </div>
            {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
          </>
        ) : (
          <div className="h-9 w-full animate-pulse rounded bg-slate-100" aria-hidden />
        )}
      </div>
    </div>
  );
}
