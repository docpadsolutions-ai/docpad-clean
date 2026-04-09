"use client";

import { useState } from "react";
import { ABHALinkModal, type AbdmPatientForLink } from "./ABHALinkModal";

type Props = {
  abhaId: string | null;
  /** When set and `abhaId` is empty, show “Link ABHA” and open the link modal. */
  linkPatient?: AbdmPatientForLink | null;
  onLinked?: (abha: string) => void;
  className?: string;
};

/** Masked display: `XXXX-XXXX-1234` (last 4 digits from numeric id). */
function maskAbhaForDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const tail = digits.length >= 4 ? digits.slice(-4) : "????";
  return `XXXX-XXXX-${tail}`;
}

/**
 * ABHA link status beside patient name — green “ABHA Linked” or gray “No ABHA” + link action.
 */
export function ABHAStatusIndicator({ abhaId, linkPatient, onLinked, className = "" }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const linked = Boolean(abhaId?.trim());
  const canLink = Boolean(linkPatient?.id?.trim()) && !linked;

  return (
    <>
      <span className={`inline-flex max-w-full flex-wrap items-center gap-2 ${className}`}>
        {linked ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[12px] font-medium leading-tight text-emerald-900"
            title="ABHA linked"
          >
            <span className="font-semibold">ABHA Linked</span>
            <span className="font-mono text-[11px]">{maskAbhaForDisplay(abhaId!.trim())}</span>
          </span>
        ) : (
          <>
            <span
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[12px] font-medium leading-tight text-slate-600"
              title="No ABHA on file"
            >
              No ABHA
            </span>
            {canLink ? (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-0.5 text-[12px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                Link ABHA
              </button>
            ) : null}
          </>
        )}
      </span>

      {canLink && linkPatient ? (
        <ABHALinkModal
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          patient={linkPatient}
          abhaId={abhaId}
          onLinked={(abha) => {
            onLinked?.(abha);
            setLinkOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
