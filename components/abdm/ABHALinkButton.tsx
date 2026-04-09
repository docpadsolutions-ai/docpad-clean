"use client";

import { useState } from "react";
import { ABHALinkModal, type AbdmPatientForLink } from "./ABHALinkModal";

type Props = {
  patient: AbdmPatientForLink;
  abhaId?: string | null;
  onLinked?: (abha: string) => void;
  className?: string;
};

export type { AbdmPatientForLink };

/**
 * Standalone “Link ABHA” control — opens {@link ABHALinkModal}.
 */
export function ABHALinkButton({ patient, abhaId, onLinked, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const linked = Boolean(abhaId?.trim());

  return (
    <>
      <button
        type="button"
        disabled={linked}
        onClick={() => setOpen(true)}
        className={`rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        Link ABHA
      </button>
      <ABHALinkModal
        open={open}
        onClose={() => setOpen(false)}
        patient={patient}
        abhaId={abhaId}
        onLinked={(abha) => {
          onLinked?.(abha);
          setOpen(false);
        }}
      />
    </>
  );
}
