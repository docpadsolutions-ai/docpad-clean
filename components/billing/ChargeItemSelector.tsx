"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { supabase } from "@/app/supabase";

export type ChargeDefinitionOption = {
  id: string;
  code: string;
  code_system: string;
  display_name: string;
  category: string;
  base_price: number;
};

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

type Props = {
  hospitalId: string | null;
  valueId: string | null;
  onSelect: (row: ChargeDefinitionOption | null) => void;
  disabled?: boolean;
};

/**
 * Combobox-style search over `charge_item_definitions` (hospital scoped, active).
 * Uses DB columns `display_name` and `base_price` (not `name` / `default_price`).
 */
export function ChargeItemSelector({ hospitalId, valueId, onSelect, disabled }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ChargeDefinitionOption[]>([]);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.id === valueId) ?? null, [options, valueId]);

  useEffect(() => {
    if (selected) {
      setSelectedLabel(`${selected.display_name} (${selected.code})`);
    } else if (!valueId) {
      setSelectedLabel("");
    }
  }, [selected, valueId]);

  const search = useCallback(
    async (q: string) => {
      if (!hospitalId) {
        setOptions([]);
        setQueryError(null);
        return;
      }
      setLoading(true);
      try {
        const raw = q.trim().replace(/%/g, "").replace(/,/g, " ");
        const base = () =>
          supabase
            .from("charge_item_definitions")
            .select("id, code, code_system, display_name, category, base_price")
            .eq("hospital_id", hospitalId)
            .eq("status", "active")
            .order("display_name", { ascending: true })
            .limit(40);

        let data: Record<string, unknown>[] | null = null;
        let error: { code?: string; message?: string } | null = null;

        if (raw.length > 0) {
          const term = `%${raw}%`;
          const [r1, r2] = await Promise.all([
            base().ilike("display_name", term),
            base().ilike("code", term),
          ]);
          error = r1.error ?? r2.error ?? null;
          if (!error) {
            const byId = new Map<string, Record<string, unknown>>();
            for (const row of [...(r1.data ?? []), ...(r2.data ?? [])]) {
              const id = String((row as { id: string }).id);
              if (!byId.has(id)) byId.set(id, row as Record<string, unknown>);
            }
            data = Array.from(byId.values())
              .sort((a, b) =>
                String((a as { display_name?: string }).display_name ?? "").localeCompare(
                  String((b as { display_name?: string }).display_name ?? ""),
                ),
              )
              .slice(0, 40);
          }
        } else {
          const res = await base();
          data = res.data ?? null;
          error = res.error ?? null;
        }

        if (error) {
          setQueryError("Could not load charge items. Check table/RLS or network.");
          setOptions([]);
          return;
        }
        setQueryError(null);
        setOptions(
          (data ?? []).map((r) => ({
            id: String((r as { id: string }).id),
            code: String((r as { code: string }).code ?? ""),
            code_system: String((r as { code_system?: string }).code_system ?? "http://snomed.info/sct"),
            display_name: String((r as { display_name: string }).display_name ?? ""),
            category: String((r as { category: string }).category ?? ""),
            base_price: num((r as { base_price: unknown }).base_price),
          })),
        );
      } finally {
        setLoading(false);
      }
    },
    [hospitalId],
  );

  useEffect(() => {
    if (!open || !hospitalId) return;
    const t = window.setTimeout(() => void search(query), 200);
    return () => window.clearTimeout(t);
  }, [open, query, hospitalId, search]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!valueId || !hospitalId) return;
    void (async () => {
      const { data } = await supabase
        .from("charge_item_definitions")
        .select("id, code, code_system, display_name, category, base_price")
        .eq("id", valueId)
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (!data) return;
      const row = data as {
        id: string;
        code: string;
        code_system: string;
        display_name: string;
        category: string;
        base_price: unknown;
      };
      setOptions((prev) => {
        if (prev.some((p) => p.id === row.id)) return prev;
        return [
          {
            id: String(row.id),
            code: row.code,
            code_system: row.code_system,
            display_name: row.display_name,
            category: row.category,
            base_price: num(row.base_price),
          },
          ...prev,
        ];
      });
    })();
  }, [valueId, hospitalId]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        id={`${listId}-trigger`}
        disabled={disabled || !hospitalId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${listId}-listbox`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-950"
      >
        <span className="min-w-0 truncate">{selectedLabel || (hospitalId ? "Search charge item…" : "Select hospital first")}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      {open ? (
        <div
          id={`${listId}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full min-w-[280px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900"
        >
          <div className="sticky top-0 border-b border-slate-100 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or code…"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              autoFocus
            />
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Searching…
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
              {queryError ? (
                <span className="text-amber-700 dark:text-amber-400">{queryError}</span>
              ) : (
                <>
                  No charge items for this hospital.
                  <span className="mt-1 block text-xs text-slate-400">
                    Seed or add definitions for this org, or confirm the patient belongs to the same hospital as your catalog.
                  </span>
                </>
              )}
            </div>
          ) : (
            <ul className="py-1">
              {options.map((o) => {
                const active = o.id === valueId;
                return (
                  <li key={o.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800 ${
                        active ? "bg-blue-50 dark:bg-blue-950/40" : ""
                      }`}
                      onClick={() => {
                        onSelect(o);
                        setSelectedLabel(`${o.display_name} (${o.code})`);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                        {active ? <Check className="h-4 w-4 text-blue-600" aria-hidden /> : <span className="w-4" />}
                        <span className="min-w-0 truncate">{o.display_name}</span>
                      </span>
                      <span className="pl-6 text-xs text-slate-500 dark:text-slate-400">
                        {o.code} · {o.category} ·{" "}
                        {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(o.base_price)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
