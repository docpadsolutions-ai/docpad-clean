import { useCallback, useState } from "react";
import type { PrescriptionLine } from "../lib/prescriptionLine";

export function usePrescription(initialLines: PrescriptionLine[] = []) {
  const [lines, setLines] = useState<PrescriptionLine[]>(initialLines);

  const replaceAll = useCallback((next: PrescriptionLine[]) => {
    setLines(next);
  }, []);

  /** Append lines (caller should use fresh `id`s on each line, e.g. from template inject). */
  const appendLines = useCallback((toAppend: PrescriptionLine[]) => {
    if (toAppend.length === 0) return;
    setLines((prev) => [...prev, ...toAppend]);
  }, []);

  const upsertLine = useCallback((line: PrescriptionLine) => {
    setLines((prev) => {
      const i = prev.findIndex((p) => p.id === line.id);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = line;
        return copy;
      }
      return [...prev, line];
    });
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  return { lines, setLines, replaceAll, appendLines, upsertLine, removeLine };
}
