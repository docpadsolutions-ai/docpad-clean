"use client";

import { Keyboard } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ShortcutEntry = { keys: string; label: string };

export function KeyboardShortcutsHelp({
  entries,
  label = "Keyboard shortcuts",
  align = "end",
}: {
  entries: ShortcutEntry[];
  label?: string;
  align?: "start" | "end" | "center";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          aria-label={label}
          title={label}
        >
          <Keyboard className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto max-w-xs border-slate-200 p-3 text-sm">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.keys + e.label} className="flex items-start justify-between gap-4 text-xs text-slate-700">
              <span className="text-slate-600">{e.label}</span>
              <kbd className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-800">
                {e.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
