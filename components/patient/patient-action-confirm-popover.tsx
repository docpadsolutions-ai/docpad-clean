"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { PatientAvatar } from "@/components/patient/patient-avatar";
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PatientActionConfirmPopoverProps = {
  patientId: string;
  patientName: string;
  ageYears?: number | null;
  sex?: string | null;
  docpadId?: string | null;
  /**
   * The number the patient is holding. Shown in preference to the DocPad ID because
   * confirming identity against an identifier only the system knows is not
   * confirming identity.
   */
  crNumber?: string | null;
  /** For `aria-label` on Confirm (e.g. "prescription"). */
  actionNoun: string;
  onConfirm: () => void | Promise<void>;
  children: ReactElement;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  confirmLabel?: string;
  /**
   * Runs immediately before `onConfirm` (e.g. silent draft save on OPD encounter).
   * Errors are logged; the primary action still runs unless `onConfirm` throws.
   */
  beforeConfirm?: () => void | Promise<void>;
};

/**
 * Patient safety: anchored confirmation before write actions (never skip for critical flows).
 */
export function PatientActionConfirmPopover({
  patientId,
  patientName,
  ageYears,
  sex,
  docpadId,
  crNumber,
  actionNoun,
  onConfirm,
  children,
  disabled,
  align = "center",
  side = "top",
  confirmLabel = "Confirm",
  beforeConfirm,
}: PatientActionConfirmPopoverProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pid = patientId?.trim();
  const safeName = patientName?.trim() || "Patient";

  const sexLabel =
    sex != null && String(sex).trim() !== ""
      ? String(sex).trim().charAt(0).toUpperCase() + String(sex).trim().slice(1).toLowerCase()
      : null;

  const ageSexLine =
    ageYears != null && Number.isFinite(Number(ageYears))
      ? `${Math.round(Number(ageYears))}Y${sexLabel ? ` ${sexLabel}` : ""}`
      : sexLabel;

  async function handleConfirm() {
    setBusy(true);
    try {
      if (beforeConfirm) {
        try {
          await beforeConfirm();
        } catch (e) {
          console.warn("PatientActionConfirmPopover beforeConfirm failed", e);
        }
      }
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled || !pid}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={8}
        className={cn(
          "z-[100] w-[280px] max-w-[280px] overflow-hidden border border-[#E5E7EB] bg-white p-0 text-[#374151] shadow-[0_4px_24px_rgba(0,0,0,0.10)] dark:border-[#E5E7EB] dark:bg-white dark:text-[#374151]",
          "rounded-[12px]",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <PopoverArrow
          className="fill-white stroke-[#E5E7EB] dark:fill-white"
          width={12}
          height={6}
        />
        <div className="p-4">
          <div className="flex gap-3">
            <PatientAvatar patientId={pid || "unknown"} patientName={safeName} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold leading-snug text-[#111827] dark:text-[#111827]">{safeName}</p>
              {ageSexLine ? (
                <p className="mt-0.5 text-sm text-[#6B7280] dark:text-[#6B7280]">{ageSexLine}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {crNumber?.trim() ? (
                  <span className="inline-block rounded-full bg-[#111827] px-2 py-0.5 text-xs font-bold tabular-nums text-white">
                    CR {crNumber.trim()}
                  </span>
                ) : null}
                {docpadId?.trim() ? (
                  <span className="inline-block rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs text-[#374151] dark:bg-[#F3F4F6] dark:text-[#374151]">
                    {docpadId.trim()}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="my-4 h-px bg-[#F3F4F6] dark:bg-[#F3F4F6]" aria-hidden />
          <p className="text-sm leading-snug text-[#374151] dark:text-[#374151]">Confirm action for this patient?</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-medium text-[#374151] transition hover:bg-[#F9FAFB] disabled:opacity-50 dark:border-[#E5E7EB] dark:bg-white dark:text-[#374151] dark:hover:bg-[#F9FAFB]"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#2563EB] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:opacity-50 dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8]"
              onClick={() => void handleConfirm()}
              disabled={busy}
              aria-label={`Confirm ${actionNoun} for this patient`}
            >
              {busy ? "…" : confirmLabel}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Product alias — same component as {@link PatientActionConfirmPopover}. */
export { PatientActionConfirmPopover as ConfirmationTooltip };
