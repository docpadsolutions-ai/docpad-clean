"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRef } from "@/hooks/useLatestRef";

export type UseKeyboardNavOptions<T> = {
  /** Called when Escape clears selection (and optionally other UI). */
  onClearSelection?: () => void;
  /** Focus this input when `/` is pressed (outside text fields). */
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  enabled?: boolean;
  /** Optional: `a` / `A` when a row is highlighted. */
  onActionKey?: (item: T, index: number) => void;
};

/**
 * Arrow Up/Down moves a virtual selection; Enter activates `onSelect`.
 * Escape clears selection; `/` focuses `searchInputRef` when not typing in a field.
 */
export function useKeyboardNav<T>(
  items: readonly T[],
  onSelect: (item: T, index: number) => void,
  options: UseKeyboardNavOptions<T> = {},
) {
  const { onClearSelection, searchInputRef, enabled = true, onActionKey } = options;

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const selectedIndexRef = useLatestRef(selectedIndex);

  const itemsRef = useLatestRef(items);

  const onSelectRef = useLatestRef(onSelect);

  const onClearRef = useLatestRef(onClearSelection);

  const onActionRef = useLatestRef(onActionKey);

  const rowElements = useRef<(HTMLElement | null)[]>([]);

  const assignRowRef = useCallback((index: number) => (el: HTMLElement | null) => {
    rowElements.current[index] = el;
  }, []);

  const count = items.length;

  useEffect(() => {
    if (selectedIndex >= count) setSelectedIndex(-1);
  }, [count, selectedIndex]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const el = rowElements.current[selectedIndex];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const clearSelection = useCallback(() => {
    setSelectedIndex(-1);
    onClearRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        Boolean(target && "isContentEditable" in target && target.isContentEditable);

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (searchInputRef?.current && document.activeElement !== searchInputRef.current) {
          if (!isTyping) {
            e.preventDefault();
            searchInputRef.current.focus();
          }
        }
        return;
      }

      if (isTyping && e.key !== "Escape") return;

      if (e.key === "Escape") {
        if (searchInputRef?.current && document.activeElement === searchInputRef.current) {
          searchInputRef.current.blur();
        }
        clearSelection();
        return;
      }

      if (count === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => {
          if (i < 0) return 0;
          return Math.min(count - 1, i + 1);
        });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => {
          if (i <= 0) return -1;
          return i - 1;
        });
        return;
      }

      if (e.key === "Enter") {
        const idx = selectedIndexRef.current;
        if (idx < 0 || idx >= itemsRef.current.length) return;
        e.preventDefault();
        onSelectRef.current(itemsRef.current[idx], idx);
        return;
      }

      if ((e.key === "a" || e.key === "A") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const idx = selectedIndexRef.current;
        if (idx < 0 || idx >= itemsRef.current.length) return;
        if (!onActionRef.current) return;
        e.preventDefault();
        onActionRef.current(itemsRef.current[idx], idx);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, count, clearSelection, searchInputRef]);

  const isRowSelected = useCallback((index: number) => selectedIndex === index, [selectedIndex]);

  return {
    selectedIndex,
    setSelectedIndex,
    clearSelection,
    assignRowRef,
    isRowSelected,
  };
}
