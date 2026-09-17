"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

const ITEM_H = 44;
const VISIBLE = 5;
const PAD = ((VISIBLE - 1) / 2) * ITEM_H;

function buildValues(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const dec = (() => {
    const s = step.toString();
    const i = s.indexOf(".");
    return i >= 0 ? s.length - i - 1 : 0;
  })();
  const factor = 10 ** dec;
  let n = min;
  const maxPlus = max + step / 2;
  while (n <= maxPlus) {
    out.push(Math.round(n * factor) / factor);
    n = Math.round((n + step) * factor) / factor;
  }
  return out;
}

function indexForValue(values: number[], v: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < values.length; i++) {
    const d = Math.abs(values[i] - v);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

export type DrumPickerProps = {
  value: number;
  onChange: (v: number) => void;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Shown in small grey text under the label, e.g. "60–100" */
  normalHint?: string;
  /** Decimal places for display (e.g. 1 for temperature) */
  decimals?: number;
  className?: string;
};

export default function DrumPicker({
  value,
  onChange,
  label,
  unit,
  min,
  max,
  step,
  normalHint,
  decimals = 0,
  className,
}: DrumPickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const values = useMemo(() => buildValues(min, max, step), [min, max, step]);
  const format = useCallback(
    (v: number) => (decimals > 0 ? v.toFixed(decimals) : String(Math.round(v))),
    [decimals],
  );

  const syncingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = indexForValue(values, value);
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) < 0.5) return;
    syncingRef.current = true;
    el.style.scrollBehavior = "auto";
    el.scrollTop = target;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.scrollBehavior = "smooth";
        syncingRef.current = false;
      });
    });
  }, [values, value]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const commit = () => {
      if (syncingRef.current) return;
      const idx = Math.round(el.scrollTop / ITEM_H);
      const clamped = Math.max(0, Math.min(values.length - 1, idx));
      const next = values[clamped];
      if (next !== valueRef.current) onChangeRef.current(next);
    };

    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, 150);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [values]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        {normalHint ? <p className="text-[10px] text-gray-400">normal: {normalHint}</p> : null}
      </div>
      <div className="relative mt-1 min-h-[220px]">
        {/* Highlight sits BEHIND the scroller so list text paints on top (opaque bg on overlay was hiding the value). */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-11 -translate-y-1/2 rounded-md border-2 border-blue-400 bg-blue-50/40"
          aria-hidden
        />
        <div
          ref={scrollRef}
          className="relative z-10 h-[220px] snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="pb-[88px] pt-[88px]">
            {values.map((v) => (
              <div
                key={`${v}`}
                className="flex h-11 snap-center items-center justify-center text-sm font-semibold tabular-nums text-gray-900"
              >
                {format(v)}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1 text-center text-[10px] font-medium text-gray-500">{unit}</p>
    </div>
  );
}
