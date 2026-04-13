"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../../supabase";
import ProblemCard, { type ProblemCardRow } from "./problem-card";

const ENCOUNTER_FALLBACK_HINT = "From encounters — not yet confirmed";

type EncounterDxRow = {
  diagnosis_term?: unknown;
  diagnosis_snomed?: unknown;
  diagnosis_sctid?: unknown;
  diagnosis_icd10?: unknown;
  encounter_date?: unknown;
};

function stableFallbackId(term: string, snomed: string | null): string {
  const key = `${term}\u0000${snomed ?? ""}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `enc-dx-${(h >>> 0).toString(16)}`;
}

/** Mirrors DISTINCT + GROUP BY diagnosis_term, diagnosis_snomed with MIN(encounter_date). */
function aggregateEncounterDiagnoses(raw: EncounterDxRow[]): ProblemCardRow[] {
  type Agg = { term: string; snomed: string | null; icd10: string | null; minDate: string | null };
  const map = new Map<string, Agg>();

  for (const r of raw) {
    const term = typeof r.diagnosis_term === "string" ? r.diagnosis_term.trim() : "";
    if (!term) continue;
    const snRaw = r.diagnosis_snomed ?? r.diagnosis_sctid;
    const snomed =
      snRaw != null && String(snRaw).trim() !== "" ? String(snRaw).trim() : null;
    const icdRaw = r.diagnosis_icd10;
    const icd10 =
      icdRaw != null && String(icdRaw).trim() !== "" ? String(icdRaw).trim() : null;
    const key = `${term}\u0000${snomed ?? ""}`;
    const dRaw = r.encounter_date;
    const encDate =
      dRaw != null && String(dRaw).trim() !== "" ? String(dRaw).trim().slice(0, 10) : null;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, { term, snomed, icd10, minDate: encDate });
    } else {
      if (encDate && (!prev.minDate || encDate < prev.minDate)) {
        prev.minDate = encDate;
      }
      if (!prev.icd10 && icd10) {
        prev.icd10 = icd10;
      }
    }
  }

  const out: ProblemCardRow[] = [];
  for (const { term, snomed, icd10, minDate } of map.values()) {
    out.push({
      id: stableFallbackId(term, snomed),
      condition_name: term,
      status: "Active",
      onset_date: minDate,
      snomed_code: snomed,
      diagnosis_icd10: icd10,
      sourceLabel: ENCOUNTER_FALLBACK_HINT,
    });
  }

  out.sort((a, b) => {
    const da = a.onset_date ?? "";
    const db = b.onset_date ?? "";
    if (da !== db) return db.localeCompare(da);
    return a.condition_name.localeCompare(b.condition_name);
  });
  return out;
}

async function fetchEncounterDiagnosisFallback(patientId: string): Promise<{
  rows: ProblemCardRow[];
  error: string | null;
}> {
  const selectAttempts = [
    "diagnosis_term, diagnosis_snomed, diagnosis_sctid, diagnosis_icd10, encounter_date",
    "diagnosis_term, diagnosis_snomed, diagnosis_sctid, encounter_date",
    "diagnosis_term, diagnosis_snomed, encounter_date",
    "diagnosis_term, encounter_date",
  ];

  let lastMessage: string | null = null;
  for (const cols of selectAttempts) {
    const { data, error } = await supabase
      .from("opd_encounters")
      .select(cols)
      .eq("patient_id", patientId)
      .not("diagnosis_term", "is", null)
      .neq("diagnosis_term", "");
    if (!error) {
      return {
        rows: aggregateEncounterDiagnoses((data ?? []) as EncounterDxRow[]),
        error: null,
      };
    }
    lastMessage = error.message;
  }

  return { rows: [], error: lastMessage };
}

export default function ActiveProblemsPanel({
  patientId,
  reloadToken,
}: {
  patientId: string;
  /** Change to refetch after adds/edits elsewhere (e.g. problem list modal). */
  reloadToken?: number | string;
}) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<ProblemCardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const pid = patientId?.trim() ?? "";
    if (!pid) {
      setRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("active_problems")
      .select("id, condition_name, status, onset_date, snomed_code, created_at")
      .eq("patient_id", pid)
      .order("onset_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (qErr) {
      setLoading(false);
      setError(qErr.message);
      setRows([]);
      return;
    }

    let list = (data ?? []) as ProblemCardRow[];
    if (list.length === 0) {
      const { rows: fbRows, error: fbErr } = await fetchEncounterDiagnosisFallback(pid);
      if (fbErr) {
        setError(fbErr);
        setRows([]);
        setLoading(false);
        return;
      }
      list = fbRows;
    }

    setLoading(false);
    setError(null);
    setRows(list);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 border-b border-gray-100 bg-gradient-to-r from-slate-50/90 to-white px-4 py-3 text-left transition hover:bg-slate-50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={2.5} aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={2.5} aria-hidden />
          )}
          <span className="text-sm font-bold text-gray-900">Active problems</span>
          {!loading && rows.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
              {rows.length}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 py-3">
          {error && (
            <p role="alert" className="mb-2 text-xs text-red-600">
              {error}
            </p>
          )}
          {loading ? (
            <ul className="space-y-2" aria-busy>
              {[1, 2, 3].map((i) => (
                <li key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">No active problems recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <ProblemCard row={row} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
