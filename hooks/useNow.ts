"use client";

import { useEffect, useState } from "react";

/**
 * The current time as a render input rather than an impure call.
 *
 * `Date.now()` read during render makes the render impure: the same component with the
 * same props produces a different result on each pass, which is what `react-hooks/purity`
 * objects to. It is also a latent bug in its own right - a label that says "3m ago"
 * computed this way only changes when something else happens to re-render the component,
 * so it can sit there saying "3m ago" for half an hour.
 *
 * Holding the clock in state fixes both. The value updates on a timer, the render stays
 * pure, and the relative labels actually tick.
 *
 * Pick the interval to match what is being shown: a minute for "x minutes ago", a
 * fraction of a second for a progress bar. Pass 0 to freeze it at mount.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
