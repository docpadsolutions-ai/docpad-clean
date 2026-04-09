"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PrescriptionLine } from "../lib/prescriptionLine";
import {
  calculateTotalQuantity,
  clampPrescriptionQuantity,
  formatTotalQuantityLabel,
  isAsNeededFrequency,
} from "../lib/medicationUtils";

export type InlineDosageSelectorProps = {
  line: PrescriptionLine;
  isNew: boolean;
  /** Units available for this SKU after other Rx lines on the same encounter (before this line’s quantity). */
  catalogStock: number;
  onConfirm: (updated: Partial<PrescriptionLine>) => void;
  onCancel: () => void;
  /** When set, mousedown outside this element (but still in the modal) dismisses — use for the compose row that includes manual name + selector. */
  outsideDismissBoundsRef?: RefObject<HTMLElement | null>;
  /** e.g. the prescription chip wrapper — clicks here should not count as “outside” when editing. */
  isTargetInsideProtectedTargets?: (target: Node) => boolean;
};

const inputCls =
  "min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100";

const chipBase =
  "rounded-md border px-2 py-0.5 text-[10px] font-semibold transition shrink-0";
const chipIdle = `${chipBase} border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50`;
const chipActive = `${chipBase} border-blue-600 bg-blue-600 text-white`;

type FreqRow = "standard" | "meal" | "special";

const STANDARD_CHIPS: { label: string; value: string; row: FreqRow }[] = [
  { label: "OD", value: "1-0-0", row: "standard" },
  { label: "BD", value: "1-0-1", row: "standard" },
  { label: "TDS", value: "1-1-1", row: "standard" },
  { label: "QID", value: "1-1-1-1", row: "standard" },
];

const MEAL_CHIPS: { label: string; append: string; row: FreqRow }[] = [
  { label: "Before food", append: "before food", row: "meal" },
  { label: "After food", append: "after food", row: "meal" },
  { label: "With food", append: "with food", row: "meal" },
  { label: "Empty stomach", append: "empty stomach", row: "meal" },
];

const SPECIAL_CHIPS: { label: string; value: string; row: FreqRow }[] = [
  { label: "SOS / PRN", value: "SOS", row: "special" },
  { label: "Stat (Immediate)", value: "Stat (immediate)", row: "special" },
  { label: "Night only (HS)", value: "HS (night only)", row: "special" },
  { label: "Weekly", value: "Weekly", row: "special" },
];

const DURATION_CHIPS = [
  "3 days",
  "5 days",
  "7 days",
  "10 days",
  "2 weeks",
  "1 month",
  "Ongoing",
] as const;

const INSTRUCTION_CHIPS = [
  "After food",
  "Before food",
  "With warm water",
  "Crush and mix",
  "Do not crush",
  "Take at bedtime",
  "Avoid alcohol",
  "Avoid driving",
  "Complete the course",
  "If needed (SOS)",
  "Apply topically",
  "Dissolve under tongue",
  "With plenty of water",
] as const;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function isOngoingDuration(d: string): boolean {
  return /\bongoing\b/i.test(d.trim());
}

type ParsedDuration = { value: number; unit: "day" | "week" | "month"; labelPlural: string };

function parseDurationString(raw: string): ParsedDuration | null {
  const t = raw.trim().toLowerCase();
  if (!t || /\bongoing\b/.test(t)) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(day|days|d\b|week|weeks|wk|wks|month|months|mo|mos)\b/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  const u = m[2].toLowerCase();
  if (u === "day" || u === "days" || u === "d")
    return { value: Math.round(n), unit: "day", labelPlural: "days" };
  if (u === "week" || u === "weeks" || u === "wk" || u === "wks")
    return { value: Math.round(n), unit: "week", labelPlural: "weeks" };
  return { value: Math.round(n), unit: "month", labelPlural: "months" };
}

function formatDuration(p: ParsedDuration): string {
  const v = p.value;
  const sing =
    p.unit === "day" ? "day" : p.unit === "week" ? "week" : "month";
  const word = v === 1 ? sing : p.labelPlural;
  return `${v} ${word}`;
}

function doubleDurationString(raw: string): string {
  const p = parseDurationString(raw);
  if (!p) return raw;
  return formatDuration({ ...p, value: p.value * 2 });
}

function stepDuration(raw: string, delta: 1 | -1): string {
  const p = parseDurationString(raw);
  if (!p) {
    if (delta > 0) return "1 day";
    return raw;
  }
  const next = Math.max(1, p.value + delta);
  return formatDuration({ ...p, value: next });
}

function freqChipActive(
  frequency: string,
  kind: FreqRow,
  standardValue?: string,
  mealAppend?: string,
  specialValue?: string,
): boolean {
  const f = norm(frequency);
  if (kind === "standard" && standardValue) return f === norm(standardValue);
  if (kind === "meal" && mealAppend) {
    const a = norm(mealAppend);
    return f.includes(a) || frequency.toLowerCase().includes(mealAppend);
  }
  if (kind === "special" && specialValue) return f === norm(specialValue);
  return false;
}

export default function InlineDosageSelector({
  line,
  isNew,
  catalogStock,
  onConfirm,
  onCancel,
  outsideDismissBoundsRef,
  isTargetInsideProtectedTargets,
}: InlineDosageSelectorProps) {
  const baseId = useId();
  const rootRef = useRef<HTMLFormElement>(null);
  const [frequency, setFrequency] = useState(() => line.frequency);
  const [duration, setDuration] = useState(() => line.duration);
  const [instructions, setInstructions] = useState(() => line.instructions);
  const [asNeededQty, setAsNeededQty] = useState(() =>
    isAsNeededFrequency(line.frequency) ? clampPrescriptionQuantity(line.total_quantity || 1) : 1,
  );
  const [showDurTip, setShowDurTip] = useState(true);

  useEffect(() => {
    setFrequency(line.frequency);
    setDuration(line.duration);
    setInstructions(line.instructions);
    setAsNeededQty(
      isAsNeededFrequency(line.frequency) ? clampPrescriptionQuantity(line.total_quantity || 1) : 1,
    );
    setShowDurTip(true);
  }, [line.id, line.frequency, line.duration, line.instructions, line.total_quantity]);

  useEffect(() => {
    const el = document.getElementById(`${baseId}-freq`);
    queueMicrotask(() => el?.focus());
  }, [baseId, line.id]);

  useEffect(() => {
    function handleOutsideMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (isTargetInsideProtectedTargets?.(t)) return;
      const bounds = outsideDismissBoundsRef?.current ?? rootRef.current;
      if (bounds?.contains(t)) return;
      onCancel();
    }
    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () => document.removeEventListener("mousedown", handleOutsideMouseDown);
  }, [onCancel, outsideDismissBoundsRef, isTargetInsideProtectedTargets]);

  const previewTotal = useMemo(() => {
    if (isOngoingDuration(duration)) return calculateTotalQuantity(frequency, "30 days");
    if (isAsNeededFrequency(frequency)) return clampPrescriptionQuantity(asNeededQty);
    return calculateTotalQuantity(frequency, duration);
  }, [frequency, duration, asNeededQty]);

  const shelfBase = typeof line.catalog.stock === "number" && Number.isFinite(line.catalog.stock)
    ? Math.max(0, line.catalog.stock)
    : 0;

  const stockAfter = Math.max(0, catalogStock - previewTotal);
  const insufficient = previewTotal > catalogStock;

  const totalDisplay = useMemo(() => {
    if (isOngoingDuration(duration)) {
      return insufficient ? (
        <span className="flex flex-wrap items-center gap-1 font-semibold text-red-600">
          <span aria-hidden>⚠</span>
          <span>30-day supply est. exceeds available — Insufficient stock</span>
        </span>
      ) : (
        <span className="text-gray-500">Total: 30-day supply est.</span>
      );
    }
    if (isAsNeededFrequency(frequency)) {
      return insufficient ? (
        <span className="flex flex-wrap items-center gap-1 font-semibold text-red-600">
          <span aria-hidden>⚠</span>
          <span>
            Total: variable (SOS) — requested {previewTotal} exceeds available — Insufficient stock
          </span>
        </span>
      ) : (
        <span className="text-gray-500">Total: variable (SOS)</span>
      );
    }
    if (insufficient) {
      return (
        <span className="flex flex-wrap items-center gap-1 font-semibold text-red-600">
          <span aria-hidden>⚠</span>
          <span>
            {formatTotalQuantityLabel(previewTotal, line.catalog.form_name)} — Insufficient stock
          </span>
        </span>
      );
    }
    return (
      <span className="font-medium text-gray-700">
        Total: {formatTotalQuantityLabel(previewTotal, line.catalog.form_name)}
      </span>
    );
  }, [duration, frequency, insufficient, line.catalog.form_name, previewTotal]);

  const applyFrequencyStandard = (value: string) => {
    setFrequency(value);
    if (isAsNeededFrequency(value)) setAsNeededQty(1);
  };

  const appendMeal = (append: string) => {
    setFrequency((prev) => {
      const p = prev.trim();
      const a = append.trim();
      if (!p) return a;
      if (norm(p).includes(norm(a))) return prev;
      return `${p} ${a}`.trim();
    });
  };

  const applyFrequencySpecial = (value: string) => {
    setFrequency(value);
    if (isAsNeededFrequency(value)) setAsNeededQty(1);
  };

  const onDurDoubleClick = useCallback(() => {
    setDuration((d) => doubleDurationString(d));
  }, []);

  const onDurChipDoubleClick = (chip: string) => {
    setDuration(doubleDurationString(chip));
  };

  const stepDur = (delta: 1 | -1) => {
    setDuration((d) => {
      if (isOngoingDuration(d)) return d;
      return stepDuration(d, delta);
    });
  };

  const appendInstruction = (text: string) => {
    setInstructions((prev) => {
      const p = prev.trim();
      const t = text.trim();
      if (!p) return t;
      if (norm(p).includes(norm(t))) return prev;
      return `${p}; ${t}`;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fq = frequency.trim();
    const dur = duration.trim();
    const tq = isAsNeededFrequency(fq)
      ? clampPrescriptionQuantity(asNeededQty)
      : isOngoingDuration(dur)
        ? calculateTotalQuantity(fq, "30 days")
        : calculateTotalQuantity(fq, dur);
    onConfirm({
      frequency: fq,
      duration: dur,
      instructions: instructions.trim(),
      total_quantity: tq,
    });
  };

  return (
    <form
      ref={rootRef}
      className="rounded-xl border-2 border-blue-400 bg-blue-50/90 p-3 shadow-lg backdrop-blur-[2px]"
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-gray-600">
        <span className="rounded-md bg-white px-2 py-0.5 ring-1 ring-gray-200">
          Strength:{" "}
          <span className="text-gray-900">{(line.catalog.defaultDose ?? "").trim() || "—"}</span>
        </span>
        <span className="rounded-md bg-white px-2 py-0.5 ring-1 ring-gray-200">
          Form: <span className="text-gray-900">{(line.catalog.form_name ?? "").trim() || "—"}</span>
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-500" htmlFor={`${baseId}-freq`}>
            Frequency
          </label>
          <input
            id={`${baseId}-freq`}
            value={frequency}
            onChange={(e) => {
              const v = e.target.value;
              setFrequency(v);
              if (isAsNeededFrequency(v)) setAsNeededQty((q) => (q < 1 ? 1 : q));
            }}
            placeholder="e.g. 1-0-1, SOS"
            className={`${inputCls} w-full`}
            autoComplete="off"
          />

          <div className="mt-2 space-y-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Standard</p>
            <div className="flex flex-wrap gap-1">
              {STANDARD_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => applyFrequencyStandard(c.value)}
                  className={freqChipActive(frequency, "standard", c.value) ? chipActive : chipIdle}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Meal-based</p>
            <div className="flex flex-wrap gap-1">
              {MEAL_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => appendMeal(c.append)}
                  className={freqChipActive(frequency, "meal", undefined, c.append) ? chipActive : chipIdle}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Special</p>
            <div className="flex flex-wrap gap-1">
              {SPECIAL_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => applyFrequencySpecial(c.value)}
                  className={freqChipActive(frequency, "special", undefined, undefined, c.value) ? chipActive : chipIdle}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-500" htmlFor={`${baseId}-dur`}>
            Duration
          </label>
          <div className="flex items-stretch gap-1">
            <button
              type="button"
              aria-label="Decrease duration"
              onClick={() => stepDur(-1)}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              −
            </button>
            <div className="relative min-w-0 flex-1">
              <input
                id={`${baseId}-dur`}
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value);
                  setShowDurTip(false);
                }}
                onFocus={() => setShowDurTip(false)}
                onDoubleClick={onDurDoubleClick}
                placeholder="7 days"
                className={`${inputCls} w-full`}
                autoComplete="off"
                title="Double-click to double duration"
              />
              {showDurTip ? (
                <span className="pointer-events-none absolute -top-0.5 right-1 max-w-[min(100%,11rem)] translate-y-[-100%] rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-white shadow">
                  Double-click to double duration
                </span>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Increase duration"
              onClick={() => stepDur(1)}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              +
            </button>
          </div>
          <div className="mt-1.5 flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {DURATION_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  setDuration(chip);
                  setShowDurTip(false);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  onDurChipDoubleClick(chip);
                }}
                className={norm(duration) === norm(chip) ? chipActive : chipIdle}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-500" htmlFor={`${baseId}-inst`}>
            Instructions
          </label>
          <input
            id={`${baseId}-inst`}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Optional"
            className={`${inputCls} w-full`}
            autoComplete="off"
          />
          <div className="mt-1.5 flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {INSTRUCTION_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => appendInstruction(chip)}
                className={chipIdle}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        {isAsNeededFrequency(frequency) ? (
          <div className="w-28">
            <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-500" htmlFor={`${baseId}-sos`}>
              SOS qty
            </label>
            <input
              id={`${baseId}-sos`}
              type="number"
              min={1}
              max={99999}
              value={asNeededQty}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                setAsNeededQty(Number.isFinite(v) ? clampPrescriptionQuantity(v) : 1);
              }}
              className={`${inputCls} w-full tabular-nums`}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-blue-200/60 pt-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11px]">
          <div className="rounded-md bg-white px-2 py-0.5 ring-1 ring-gray-200">{totalDisplay}</div>
          {shelfBase > 0 || line.catalog.medication_source === "stock" || line.catalog.medication_source === "registry" ? (
            <span
              className={`rounded-md px-2 py-0.5 font-semibold tabular-nums ring-1 ${
                insufficient ? "bg-red-50 text-red-800 ring-red-200" : "bg-emerald-50 text-emerald-900 ring-emerald-200"
              }`}
            >
              Stock: {shelfBase.toLocaleString("en-IN")} → {stockAfter.toLocaleString("en-IN")}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            {isNew ? "Add" : "Update"}
          </button>
        </div>
      </div>
    </form>
  );
}
