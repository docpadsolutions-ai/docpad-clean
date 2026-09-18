"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * A ref that always holds the most recent value, without writing it during render.
 *
 * The pattern this replaces was written inline in a dozen places:
 *
 *   const onChangeRef = useRef(onChange);
 *   onChangeRef.current = onChange;      // <- during render
 *
 * It works, and it is what React's own docs used to suggest, but writing a ref while
 * rendering makes the render impure: under concurrent rendering React may start a
 * render, abandon it, and start again, and the abandoned pass has already mutated the
 * ref. `react-hooks/refs` flags it for that reason.
 *
 * Assigning in an effect is the supported form. The timing difference does not matter
 * for the way these refs are used here - they exist so that an event handler, a
 * subscription callback or a timer can read the latest props without being torn down
 * and rebuilt on every change, and all of those run after commit.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
