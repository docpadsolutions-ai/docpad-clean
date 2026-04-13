"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const ROW_H = 36;
const COL_W = 60;
const PICKER_H = 180;
const PAD = (PICKER_H - ROW_H) / 2;

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;
const PERIODS = ["AM", "PM"] as const;

export type Time12hParts = { hour12: number; minute: number; isPm: boolean };

const DEFAULT_PARTS: Time12hParts = { hour12: 9, minute: 0, isPm: false };

/** Nearest 5-minute step (0–55). */
export function roundToFiveMinute(m: number): number {
  const clamped = Math.min(55, Math.max(0, m));
  return MINUTE_STEPS.reduce((best, v) => (Math.abs(v - clamped) < Math.abs(best - clamped) ? v : best), 0);
}

/** "09:15 AM" | "02:30 PM" */
export function formatTime12h(parts: Time12hParts): string {
  const hh = String(parts.hour12).padStart(2, "0");
  const mm = String(parts.minute).padStart(2, "0");
  return `${hh}:${mm} ${parts.isPm ? "PM" : "AM"}`;
}

/** Parse display string; returns null if invalid or empty. */
export function parseTime12h(s: string): Time12hParts | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const hour12 = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
  return {
    hour12,
    minute: roundToFiveMinute(minute),
    isPm: ap === "PM",
  };
}

/** 24h clock → display "hh:mm AM/PM" */
export function time24hTo12hDisplay(h24: number, minute: number): string {
  const isPm = h24 >= 12;
  let h12: number;
  if (h24 === 0) h12 = 12;
  else if (h24 > 12) h12 = h24 - 12;
  else h12 = h24;
  return formatTime12h({ hour12: h12, minute: roundToFiveMinute(minute), isPm });
}

/** Display string → Postgres-friendly "HH:MM:00" (24h). */
export function time12hTo24hForDb(display: string): string | null {
  const p = parseTime12h(display);
  if (!p) return null;
  let h24: number;
  if (p.isPm) {
    h24 = p.hour12 === 12 ? 12 : p.hour12 + 12;
  } else {
    h24 = p.hour12 === 12 ? 0 : p.hour12;
  }
  return `${String(h24).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:00`;
}

/** Load from `start_time` / ISO / `HH:MM(:SS)` → wheel display, or "" if unparseable. */
export function parseDbStartTimeTo12hDisplay(st: string): string {
  const t = st.trim();
  if (!t) return "";
  if (t.includes("T")) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return time24hTo12hDisplay(d.getHours(), d.getMinutes());
  }
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    return time24hTo12hDisplay(hh, mm);
  }
  return "";
}

function partsToIndices(parts: Time12hParts): { hi: number; mi: number; pi: number } {
  const hiRaw = HOURS.indexOf(parts.hour12 as (typeof HOURS)[number]);
  const hi = hiRaw >= 0 ? hiRaw : 8;
  const miRaw = MINUTE_STEPS.indexOf(parts.minute as (typeof MINUTE_STEPS)[number]);
  const mi = miRaw >= 0 ? miRaw : 0;
  const pi = parts.isPm ? 1 : 0;
  return { hi, mi, pi };
}

function indicesToParts(hi: number, mi: number, pi: number): Time12hParts {
  return {
    hour12: HOURS[Math.min(11, Math.max(0, hi))]!,
    minute: MINUTE_STEPS[Math.min(11, Math.max(0, mi))]!,
    isPm: pi === 1,
  };
}

function WheelColumn({
  children,
  itemCount,
  onIndexChange,
  scrollIndex,
  disabled,
  className,
  widthPx,
}: {
  children: ReactNode;
  itemCount: number;
  onIndexChange: (index: number) => void;
  scrollIndex: number;
  disabled?: boolean;
  className?: string;
  widthPx?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);

  const syncScroll = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el || itemCount < 1) return;
      const max = itemCount - 1;
      const i = Math.min(max, Math.max(0, index));
      syncingRef.current = true;
      el.scrollTop = i * ROW_H;
      window.setTimeout(() => {
        syncingRef.current = false;
      }, 200);
    },
    [itemCount],
  );

  useLayoutEffect(() => {
    syncScroll(scrollIndex);
  }, [scrollIndex, syncScroll]);

  const handleScroll = () => {
    if (syncingRef.current) return;
    const el = ref.current;
    if (!el || itemCount < 1) return;
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {
      const raw = el.scrollTop / ROW_H;
      const max = itemCount - 1;
      const idx = Math.min(max, Math.max(0, Math.round(raw)));
      if (Math.abs(el.scrollTop - idx * ROW_H) > 0.5) {
        el.scrollTo({ top: idx * ROW_H, behavior: "smooth" });
      }
      onIndexChange(idx);
    }, 80);
  };

  const w = widthPx ?? COL_W;

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden bg-white", className)}
      style={{ width: w, height: PICKER_H }}
    >
      <div
        ref={ref}
        role="listbox"
        tabIndex={disabled ? -1 : 0}
        onScroll={handleScroll}
        className={cn(
          "relative z-[1] h-full overflow-y-auto scroll-smooth overscroll-contain",
          "snap-y snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          disabled && "pointer-events-none opacity-50",
        )}
        style={{
          scrollSnapType: "y mandatory",
          maskImage: "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
        }}
      >
        <div style={{ paddingTop: PAD, paddingBottom: PAD }}>{children}</div>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 z-[2] -translate-y-1/2 border-y border-blue-600"
        style={{ height: ROW_H }}
        aria-hidden
      />
    </div>
  );
}

function WheelItem({
  children,
  selected,
  onPick,
}: {
  children: ReactNode;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-wheel-item
      onClick={onPick}
      className={cn(
        "flex h-9 w-full shrink-0 snap-center items-center justify-center border-0 bg-transparent px-1 transition-colors",
        selected ? "text-base font-bold text-blue-600" : "text-sm font-normal text-gray-400",
      )}
      style={{ height: ROW_H, scrollSnapAlign: "center" }}
    >
      {children}
    </button>
  );
}

export default function TimeWheelPicker({
  value,
  onChange,
  disabled,
  className,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-labelledby"?: string;
}) {
  const parsed = parseTime12h(value);
  const base = parsed ?? DEFAULT_PARTS;
  const initial = partsToIndices(base);

  const [hourIdx, setHourIdx] = useState(initial.hi);
  const [minIdx, setMinIdx] = useState(initial.mi);
  const [periodIdx, setPeriodIdx] = useState(initial.pi);

  useEffect(() => {
    const p = parseTime12h(value);
    if (!p) {
      const idx = partsToIndices(DEFAULT_PARTS);
      setHourIdx(idx.hi);
      setMinIdx(idx.mi);
      setPeriodIdx(idx.pi);
      return;
    }
    const idx = partsToIndices(p);
    setHourIdx(idx.hi);
    setMinIdx(idx.mi);
    setPeriodIdx(idx.pi);
  }, [value]);

  const emit = useCallback(
    (nextHi: number, nextMi: number, nextPi: number) => {
      const parts = indicesToParts(nextHi, nextMi, nextPi);
      const next = formatTime12h(parts);
      if (next === value.trim()) return;
      onChange(next);
    },
    [onChange, value],
  );

  const onHourIndex = (i: number) => {
    setHourIdx(i);
    emit(i, minIdx, periodIdx);
  };
  const onMinIndex = (i: number) => {
    setMinIdx(i);
    emit(hourIdx, i, periodIdx);
  };
  const onPeriodIndex = (i: number) => {
    setPeriodIdx(i);
    emit(hourIdx, minIdx, i);
  };

  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-900 shadow-sm",
        className,
      )}
      aria-labelledby={ariaLabelledBy}
    >
      <WheelColumn itemCount={HOURS.length} scrollIndex={hourIdx} onIndexChange={onHourIndex} disabled={disabled}>
        {HOURS.map((h, i) => (
          <WheelItem key={h} selected={i === hourIdx} onPick={() => onHourIndex(i)}>
            {String(h).padStart(2, "0")}
          </WheelItem>
        ))}
      </WheelColumn>
      <div className="flex w-2 shrink-0 items-center justify-center self-center text-sm text-gray-300" aria-hidden>
        :
      </div>
      <WheelColumn itemCount={MINUTE_STEPS.length} scrollIndex={minIdx} onIndexChange={onMinIndex} disabled={disabled}>
        {MINUTE_STEPS.map((m, i) => (
          <WheelItem key={m} selected={i === minIdx} onPick={() => onMinIndex(i)}>
            {String(m).padStart(2, "0")}
          </WheelItem>
        ))}
      </WheelColumn>
      <WheelColumn
        itemCount={PERIODS.length}
        scrollIndex={periodIdx}
        onIndexChange={onPeriodIndex}
        disabled={disabled}
        widthPx={COL_W}
      >
        {PERIODS.map((p, i) => (
          <WheelItem key={p} selected={i === periodIdx} onPick={() => onPeriodIndex(i)}>
            {p}
          </WheelItem>
        ))}
      </WheelColumn>
    </div>
  );
}
