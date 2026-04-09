"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchAuthOrgId } from "../../lib/authOrg";
import { practitionersOrFilterForAuthUid } from "../../lib/practitionerAuthLookup";
import OCRUploadModal from "../investigations/OCRUploadModal";
import { supabase } from "../../supabase";
import {
  formatOrderedDate,
  localYmd,
  normalizeResultStatus,
  orderedOnLocalDay,
  resultStatusBadgeClass,
  resultStatusDotClass,
} from "../../lib/investigationsUi";

export type InvestigationRecord = {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  doctor_id: string | null;
  hospital_id: string | null;
  test_name: string | null;
  test_code: string | null;
  test_category: string | null;
  test_subcategory: string | null;
  status: string | null;
  result_status: string | null;
  clinical_indication: string | null;
  priority: string | null;
  ordered_at: string | null;
  expected_tat_hours: number | string | null;
  collected_at: string | null;
  resulted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  report_storage_path: string | null;
};

type LabResultEntryRow = {
  id: string;
  investigation_id: string;
  patient_id: string | null;
  parameter_name: string | null;
  loinc_code: string | null;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_text: string | null;
  interpretation: string | null;
  is_abnormal: boolean | null;
  created_at: string | null;
};

type WorkflowRow = {
  id: string;
  investigation_id: string;
  step: string;
  performed_by: string | null;
  performed_at: string | null;
  notes: string | null;
};

const INV_SELECT =
  "id, patient_id, encounter_id, doctor_id, hospital_id, test_name, test_code, test_category, test_subcategory, status, result_status, clinical_indication, priority, ordered_at, expected_tat_hours, collected_at, resulted_at, reviewed_at, reviewed_by, report_storage_path";

const LAB_ENTRY_SELECT =
  "id, investigation_id, parameter_name, loinc_code, value_numeric, value_text, unit, ref_range_low, ref_range_high, ref_range_text, interpretation, is_abnormal, created_at";

const VIEWS = ["current", "timeline", "category", "all"] as const;
type ViewId = (typeof VIEWS)[number];

function investigationStatusPending(s: string | null | undefined): boolean {
  const x = (s ?? "").trim().toLowerCase();
  return x === "ordered" || x === "collected";
}

/** Ready to review: new results, not yet signed off (supports DB values `resulted` or `ready`). */
function isReadyForReview(inv: InvestigationRecord): boolean {
  const rs = normalizeResultStatus(inv.result_status);
  const hasReviewed = inv.reviewed_at != null && String(inv.reviewed_at).trim() !== "";
  if (hasReviewed) return false;
  return rs === "resulted" || rs === "ready";
}

function orderedLocalYmd(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    const head = iso.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : "—";
  }
  return localYmd(new Date(t));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** One row per parameter_name per investigation: keep latest by created_at. */
function dedupeLatestLabResultsByParameter(rows: LabResultEntryRow[]): LabResultEntryRow[] {
  const acc: Record<string, LabResultEntryRow> = {};
  for (const r of rows) {
    const nameKey = (r.parameter_name ?? "").trim();
    const key = nameKey || r.id;
    const prev = acc[key];
    const curT = Date.parse(String(r.created_at ?? "").trim()) || 0;
    const prevT = prev ? Date.parse(String(prev.created_at ?? "").trim()) || 0 : -Infinity;
    if (!prev || curT >= prevT) acc[key] = r;
  }
  return Object.values(acc);
}

function stepLabel(step: string): string {
  const s = step.trim().toLowerCase().replace(/_/g, " ");
  return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : step;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const t = Date.parse(iso);
  if (!Number.isNaN(t)) {
    const sec = Math.round((t - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const abs = Math.abs(sec);
    if (abs < 60) return rtf.format(sec, "second");
    const min = Math.round(sec / 60);
    if (Math.abs(min) < 60) return rtf.format(min, "minute");
    const hr = Math.round(sec / 3600);
    if (Math.abs(hr) < 24) return rtf.format(hr, "hour");
    const day = Math.round(sec / 86400);
    return rtf.format(day, "day");
  }
  return formatOrderedDate(iso);
}

export default function InvestigationsTabContent({
  patientId,
  encounterId,
  hospitalId: hospitalIdProp,
  doctorDisplayName,
  onRequestOrderMore,
}: {
  patientId: string;
  encounterId: string;
  doctorDisplayName: string;
  /** When omitted, resolved from encounter row or `auth_org()`. */
  hospitalId?: string | null;
  onRequestOrderMore?: () => void;
}) {
  const [view, setView] = useState<ViewId>("current");
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [allSort, setAllSort] = useState<"date-desc" | "date-asc" | "status">("date-desc");

  const [encounterWhen, setEncounterWhen] = useState<string | null>(null);
  const [investigations, setInvestigations] = useState<InvestigationRecord[]>([]);
  const [labEntries, setLabEntries] = useState<LabResultEntryRow[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewingDoctorId, setReviewingDoctorId] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);
  const [ocrTargetInv, setOcrTargetInv] = useState<InvestigationRecord | null>(null);
  const [expandedCurrentId, setExpandedCurrentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid) {
        if (!cancelled) setReviewingDoctorId(null);
        return;
      }
      const { data: pr, error: prErr } = await supabase
        .from("practitioners")
        .select("id")
        .or(practitionersOrFilterForAuthUid(uid))
        .maybeSingle();
      if (cancelled) return;
      if (prErr || !pr?.id) {
        setReviewingDoctorId(null);
        return;
      }
      setReviewingDoctorId(String(pr.id));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const pid = patientId?.trim() ?? "";
    if (!pid) {
      setInvestigations([]);
      setLabEntries([]);
      setWorkflow([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    let hid = (hospitalIdProp ?? "").trim();
    if (!hid && encounterId) {
      const { data: encH } = await supabase.from("opd_encounters").select("hospital_id").eq("id", encounterId).maybeSingle();
      const raw = encH && typeof encH === "object" && "hospital_id" in encH ? (encH as { hospital_id?: unknown }).hospital_id : null;
      if (raw != null && String(raw).trim() !== "") hid = String(raw).trim();
    }
    if (!hid) {
      const { orgId } = await fetchAuthOrgId();
      hid = orgId?.trim() ?? "";
    }
    if (!hid) {
      setError("Hospital context missing — cannot load investigations.");
      setInvestigations([]);
      setLabEntries([]);
      setWorkflow([]);
      setLoading(false);
      return;
    }

    const [{ data: encRow, error: encErr }, invRes] = await Promise.all([
      encounterId
        ? supabase.from("opd_encounters").select("encounter_date, created_at").eq("id", encounterId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("investigations")
        .select(INV_SELECT)
        .eq("patient_id", pid)
        .eq("hospital_id", hid)
        .order("ordered_at", { ascending: false }),
    ]);

    if (encErr) {
      console.warn("[investigations] encounter lookup", encErr.message);
    } else if (encRow) {
      const er = encRow as { encounter_date?: string | null; created_at?: string | null };
      const when = er.encounter_date ?? er.created_at ?? null;
      setEncounterWhen(when ? String(when) : null);
    }

    if (invRes.error) {
      setError(invRes.error.message);
      setInvestigations([]);
      setLabEntries([]);
      setWorkflow([]);
      setLoading(false);
      return;
    }

    const invList = (invRes.data ?? []) as InvestigationRecord[];
    setInvestigations(invList);

    const ids = invList.map((r) => r.id).filter(Boolean);
    const entryRows: LabResultEntryRow[] = [];
    for (const part of chunk(ids, 80)) {
      if (part.length === 0) continue;
      const { data: rows, error: labErr } = await supabase
        .from("lab_result_entries")
        .select(LAB_ENTRY_SELECT)
        .in("investigation_id", part);
      if (labErr) {
        console.warn("[investigations] lab_result_entries chunk", labErr.message);
        continue;
      }
      entryRows.push(...((rows ?? []) as LabResultEntryRow[]));
    }
    setLabEntries(entryRows);

    const wfRows: WorkflowRow[] = [];
    for (const part of chunk(ids, 80)) {
      if (part.length === 0) continue;
      const { data: w, error: wErr } = await supabase
        .from("investigation_workflow")
        .select("id, investigation_id, step, performed_by, performed_at, notes")
        .in("investigation_id", part)
        .order("performed_at", { ascending: false });
      if (wErr) {
        console.warn("[investigations] workflow chunk", wErr.message);
        continue;
      }
      wfRows.push(...((w ?? []) as WorkflowRow[]));
    }
    wfRows.sort((a, b) => {
      const ta = Date.parse(a.performed_at ?? "") || 0;
      const tb = Date.parse(b.performed_at ?? "") || 0;
      return tb - ta;
    });
    setWorkflow(wfRows);

    setLoading(false);
  }, [patientId, encounterId, hospitalIdProp]);

  useEffect(() => {
    void load();
  }, [load]);

  const acknowledgeSignOff = useCallback(
    async (invId: string) => {
      const pid = patientId?.trim() ?? "";
      const docId = reviewingDoctorId?.trim() ?? "";
      if (!pid || !docId || !invId.trim()) return;
      const invRow = investigations.find((i) => i.id === invId);
      const hidRow = invRow?.hospital_id != null && String(invRow.hospital_id).trim() !== "" ? String(invRow.hospital_id).trim() : null;
      setSigningId(invId);
      const now = new Date().toISOString();
      let q = supabase
        .from("investigations")
        .update({ reviewed_at: now, reviewed_by: docId })
        .eq("id", invId)
        .eq("patient_id", pid);
      if (hidRow) q = q.eq("hospital_id", hidRow);
      const { error: upErr } = await q;
      setSigningId(null);
      if (upErr) {
        console.error("[investigations] sign off", upErr.message);
        setError(upErr.message);
        return;
      }
      await load();
    },
    [patientId, reviewingDoctorId, load, investigations],
  );

  const invById = useMemo(() => {
    const m = new Map<string, InvestigationRecord>();
    for (const i of investigations) m.set(i.id, i);
    return m;
  }, [investigations]);

  const dedupedLabEntries = useMemo(() => {
    const byInv = new Map<string, LabResultEntryRow[]>();
    for (const e of labEntries) {
      const id = e.investigation_id;
      if (!id) continue;
      if (!byInv.has(id)) byInv.set(id, []);
      byInv.get(id)!.push(e);
    }
    const out: LabResultEntryRow[] = [];
    for (const list of byInv.values()) {
      out.push(...dedupeLatestLabResultsByParameter(list));
    }
    return out;
  }, [labEntries]);

  const investigationHasAbnormalEntry = useMemo(() => {
    const s = new Set<string>();
    for (const e of dedupedLabEntries) {
      if (e.is_abnormal === true && e.investigation_id) s.add(e.investigation_id);
    }
    return s;
  }, [dedupedLabEntries]);

  const stats = useMemo(() => {
    let critical = 0;
    let pending = 0;
    let ready = 0;
    for (const i of investigations) {
      if (investigationHasAbnormalEntry.has(i.id)) critical += 1;
      if (investigationStatusPending(i.status)) pending += 1;
      const rs = normalizeResultStatus(i.result_status);
      const hasReviewed = i.reviewed_at != null && String(i.reviewed_at).trim() !== "";
      if (rs === "resulted" && !hasReviewed) ready += 1;
    }
    return {
      critical,
      pending,
      ready,
      total: investigations.length,
    };
  }, [investigations, investigationHasAbnormalEntry]);

  const currentEncounterInvs = useMemo(
    () => investigations.filter((i) => i.encounter_id === encounterId),
    [investigations, encounterId],
  );

  const encounterStats = useMemo(() => {
    const ordered = currentEncounterInvs.length;
    let pending = 0;
    let ready = 0;
    for (const i of currentEncounterInvs) {
      if (investigationStatusPending(i.status)) pending += 1;
      const rs = normalizeResultStatus(i.result_status);
      const hasReviewed = i.reviewed_at != null && String(i.reviewed_at).trim() !== "";
      if (rs === "resulted" && !hasReviewed) ready += 1;
    }
    return { ordered, pending, ready };
  }, [currentEncounterInvs]);

  const filterInv = useCallback(
    (i: InvestigationRecord) => {
      const rs = normalizeResultStatus(i.result_status);
      const abnormalFromLab = investigationHasAbnormalEntry.has(i.id);
      if (abnormalOnly && !abnormalFromLab && !["abnormal", "critical"].includes(rs)) return false;
      if (pendingOnly && !investigationStatusPending(i.status)) return false;
      if (overdueOnly && rs !== "late") return false;
      return true;
    },
    [abnormalOnly, pendingOnly, overdueOnly, investigationHasAbnormalEntry],
  );

  const todayYmd = useMemo(() => localYmd(), []);

  const orderedToday = useMemo(() => {
    return investigations.filter(
      (i) =>
        i.encounter_id === encounterId &&
        orderedOnLocalDay(i.ordered_at, todayYmd) &&
        filterInv(i),
    );
  }, [investigations, encounterId, todayYmd, filterInv]);

  const comparePairs = useMemo(() => {
    const byTest = new Map<string, InvestigationRecord>();
    for (const i of currentEncounterInvs) {
      const name = (i.test_name ?? "").trim();
      if (!name) continue;
      const prev = byTest.get(name);
      if (!prev || (i.ordered_at ?? "") > (prev.ordered_at ?? "")) byTest.set(name, i);
    }
    const pairs: { testName: string; current: InvestigationRecord; prior: InvestigationRecord | null }[] = [];
    for (const [testName, cur] of byTest) {
      const prior =
        investigations
          .filter(
            (x) =>
              (x.test_name ?? "").trim() === testName &&
              x.id !== cur.id &&
              x.encounter_id !== encounterId &&
              x.ordered_at &&
              cur.ordered_at &&
              x.ordered_at < cur.ordered_at,
          )
          .sort((a, b) => (b.ordered_at ?? "").localeCompare(a.ordered_at ?? ""))[0] ?? null;
      pairs.push({ testName, current: cur, prior });
    }
    pairs.sort((a, b) => (b.current.ordered_at ?? "").localeCompare(a.current.ordered_at ?? ""));
    return pairs;
  }, [currentEncounterInvs, investigations, encounterId]);

  const trendSeries = useMemo(() => {
    type Point = { t: number; label: string; value: number };
    const groups = new Map<string, Point[]>();
    for (const r of dedupedLabEntries) {
      if (r.value_numeric == null || Number.isNaN(Number(r.value_numeric))) continue;
      const inv = invById.get(r.investigation_id);
      if (!inv) continue;
      const tn = (inv.test_name ?? "").trim() || "Test";
      const pn = (r.parameter_name ?? "").trim() || "Value";
      const key = `${tn} — ${pn}`;
      const iso = inv.ordered_at ?? inv.resulted_at ?? "";
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) continue;
      const label = new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      const list = groups.get(key) ?? [];
      list.push({ t, label, value: Number(r.value_numeric) });
      groups.set(key, list);
    }
    const series: { key: string; data: { label: string; value: number }[] }[] = [];
    for (const [key, pts] of groups) {
      pts.sort((a, b) => a.t - b.t);
      if (pts.length < 2) continue;
      series.push({
        key,
        data: pts.map((p) => ({ label: p.label, value: p.value })),
      });
    }
    series.sort((a, b) => b.data.length - a.data.length);
    return series.slice(0, 5);
  }, [dedupedLabEntries, invById]);

  const filteredInvestigations = useMemo(
    () => investigations.filter((i) => filterInv(i)),
    [investigations, filterInv],
  );

  const timelineGroups = useMemo(() => {
    const m = new Map<string, InvestigationRecord[]>();
    for (const i of filteredInvestigations) {
      const d = orderedLocalYmd(i.ordered_at);
      const key = d === "—" ? "Unknown date" : d;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(i);
    }
    const entries = [...m.entries()];
    entries.sort(([a], [b]) => {
      if (a === "Unknown date") return 1;
      if (b === "Unknown date") return -1;
      return b.localeCompare(a);
    });
    return entries;
  }, [filteredInvestigations]);

  const categoryGroups = useMemo(() => {
    const m = new Map<string, InvestigationRecord[]>();
    for (const i of filteredInvestigations) {
      const cat = (i.test_category ?? "").trim() || "Uncategorized";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(i);
    }
    const entries = [...m.entries()];
    entries.sort(([a], [b]) => a.localeCompare(b));
    for (const [, rows] of entries) {
      rows.sort((x, y) => (y.ordered_at ?? "").localeCompare(x.ordered_at ?? ""));
    }
    return entries;
  }, [filteredInvestigations]);

  const allSorted = useMemo(() => {
    const rows = [...filteredInvestigations];
    if (allSort === "date-desc") {
      rows.sort((a, b) => (b.ordered_at ?? "").localeCompare(a.ordered_at ?? ""));
    } else if (allSort === "date-asc") {
      rows.sort((a, b) => (a.ordered_at ?? "").localeCompare(b.ordered_at ?? ""));
    } else {
      rows.sort((a, b) => {
        const sa = normalizeResultStatus(a.result_status) || "zzz";
        const sb = normalizeResultStatus(b.result_status) || "zzz";
        const c = sa.localeCompare(sb);
        if (c !== 0) return c;
        return (b.ordered_at ?? "").localeCompare(a.ordered_at ?? "");
      });
    }
    return rows;
  }, [filteredInvestigations, allSort]);

  const recentWorkflowLines = useMemo(() => {
    return workflow.slice(0, 8).map((w) => {
      const inv = invById.get(w.investigation_id);
      const name = (inv?.test_name ?? "").trim() || "Investigation";
      return { ...w, testName: name };
    });
  }, [workflow, invById]);

  const comparePairByCurrentId = useMemo(() => {
    const m = new Map<string, { prior: InvestigationRecord | null }>();
    for (const p of comparePairs) {
      m.set(p.current.id, { prior: p.prior });
    }
    return m;
  }, [comparePairs]);

  const labEntriesByInvestigationId = useMemo(() => {
    const m = new Map<string, LabResultEntryRow[]>();
    for (const e of dedupedLabEntries) {
      const id = e.investigation_id;
      if (!id) continue;
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(e);
    }
    for (const [id, list] of m) {
      const sorted = [...list].sort((a, b) =>
        (a.parameter_name ?? "").localeCompare(b.parameter_name ?? "", undefined, { sensitivity: "base" }),
      );
      m.set(id, sorted);
    }
    return m;
  }, [dedupedLabEntries]);

  const encounterTitle = formatOrderedDate(encounterWhen);

  if (!patientId.trim()) {
    return (
      <div className="px-6 py-12 text-center text-sm text-gray-500">Select a patient to view investigations.</div>
    );
  }

  return (
    <div className="border-t border-gray-100 bg-slate-50/50 p-4 sm:p-6">
      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-4" aria-busy>
          <div className="h-24 animate-pulse rounded-xl bg-gray-200" />
          <div className="h-64 animate-pulse rounded-xl bg-gray-200" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              title="Critical Results"
              value={stats.critical}
              subtitle="Need immediate action"
              accent="border-red-200 bg-red-50/80 text-red-900"
              dotClass="bg-red-600"
            />
            <StatCard
              title="Pending Results"
              value={stats.pending}
              subtitle="Awaiting reports"
              accent="border-amber-200 bg-amber-50/80 text-amber-950"
              dotClass="bg-amber-400"
            />
            <StatCard
              title="Ready to Review"
              value={stats.ready}
              subtitle="New results available"
              accent="border-emerald-200 bg-emerald-50/80 text-emerald-900"
              dotClass="bg-emerald-500"
            />
            <StatCard
              title="Total Tests"
              value={stats.total}
              subtitle="This patient (all time)"
              accent="border-blue-200 bg-blue-50/80 text-blue-900"
              dotClass="bg-blue-500"
            />
          </div>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            {/* Left sidebar */}
            <aside className="w-full shrink-0 space-y-4 lg:w-52">
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">View</p>
                <nav className="flex flex-col gap-1">
                  {VIEWS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setView(id)}
                      className={`rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                        view === id ? "bg-blue-600 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {id === "current" ? "Current" : id === "all" ? "All Results" : id.charAt(0).toUpperCase() + id.slice(1)}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Quick filters</p>
                <label className="flex cursor-pointer items-center gap-2 py-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} />
                  Show abnormal only
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
                  Pending only
                </label>
                <label className="flex cursor-pointer items-center gap-2 py-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
                  Overdue / late only
                </label>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Current encounter</p>
                <p className="text-xs font-semibold text-gray-900">OPD visit</p>
                <p className="mt-1 text-xs text-gray-500">{encounterTitle}</p>
                <p className="mt-1 text-xs text-gray-600">{doctorDisplayName}</p>
                <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-600">
                  <div className="flex justify-between gap-2">
                    <dt>Tests ordered</dt>
                    <dd className="font-semibold text-gray-900">{encounterStats.ordered}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Pending</dt>
                    <dd className="font-semibold text-amber-700">{encounterStats.pending}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Ready</dt>
                    <dd className="font-semibold text-emerald-700">{encounterStats.ready}</dd>
                  </div>
                </dl>
              </div>
            </aside>

            {/* Main */}
            <main className="min-w-0 flex-1 space-y-6">
              {view === "timeline" ? (
                <section className="space-y-6">
                  <div>
                    <h2 className="text-sm font-bold text-gray-900">Timeline</h2>
                    <p className="text-xs text-gray-500">Grouped by order date · all encounters for this patient</p>
                  </div>
                  {timelineGroups.length === 0 ? (
                    <p className="rounded-xl border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
                      No investigations match the current filters.
                    </p>
                  ) : (
                    timelineGroups.map(([dateLabel, invs]) => (
                      <div key={dateLabel}>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{dateLabel}</h3>
                        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {invs.map((inv) => (
                            <OrderedCard
                              key={inv.id}
                              inv={inv}
                              onAcknowledge={acknowledgeSignOff}
                              signingId={signingId}
                              canAcknowledge={Boolean(reviewingDoctorId)}
                              onUploadReport={() => setOcrTargetInv(inv)}
                            />
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </section>
              ) : view === "category" ? (
                <section className="space-y-6">
                  <div>
                    <h2 className="text-sm font-bold text-gray-900">By category</h2>
                    <p className="text-xs text-gray-500">Same patient and hospital · grouped by test category</p>
                  </div>
                  {categoryGroups.length === 0 ? (
                    <p className="rounded-xl border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
                      No investigations match the current filters.
                    </p>
                  ) : (
                    categoryGroups.map(([cat, invs]) => (
                      <div key={cat}>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{cat}</h3>
                        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {invs.map((inv) => (
                            <OrderedCard
                              key={inv.id}
                              inv={inv}
                              onAcknowledge={acknowledgeSignOff}
                              signingId={signingId}
                              canAcknowledge={Boolean(reviewingDoctorId)}
                              onUploadReport={() => setOcrTargetInv(inv)}
                            />
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </section>
              ) : view === "all" ? (
                <section>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">All results</h2>
                      <p className="text-xs text-gray-500">Flat list · sortable</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="font-medium text-gray-500">Sort</span>
                      <select
                        value={allSort}
                        onChange={(e) => setAllSort(e.target.value as "date-desc" | "date-asc" | "status")}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-800 outline-none focus:border-blue-500"
                      >
                        <option value="date-desc">Date (newest)</option>
                        <option value="date-asc">Date (oldest)</option>
                        <option value="status">Status</option>
                      </select>
                    </label>
                  </div>
                  {allSorted.length === 0 ? (
                    <p className="rounded-xl border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
                      No investigations match the current filters.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {allSorted.map((inv) => (
                        <OrderedCard
                          key={inv.id}
                          inv={inv}
                          onAcknowledge={acknowledgeSignOff}
                          signingId={signingId}
                          canAcknowledge={Boolean(reviewingDoctorId)}
                          onUploadReport={() => setOcrTargetInv(inv)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ) : (
                <>
                  <section>
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-bold text-gray-900">Ordered today</h2>
                        <p className="text-xs text-gray-500">
                          {orderedToday.length} test{orderedToday.length === 1 ? "" : "s"} · {todayYmd}
                        </p>
                      </div>
                      {onRequestOrderMore ? (
                        <button
                          type="button"
                          onClick={onRequestOrderMore}
                          className="text-xs font-semibold text-blue-600 hover:underline"
                        >
                          + Order more tests
                        </button>
                      ) : null}
                    </div>
                    {orderedToday.length === 0 ? (
                      <p className="rounded-xl border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
                        No investigations ordered today for this encounter.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {orderedToday.map((inv) => {
                          const priorInv = comparePairByCurrentId.get(inv.id)?.prior ?? null;
                          const priorEntries = priorInv ? (labEntriesByInvestigationId.get(priorInv.id) ?? []) : [];
                          return (
                            <CurrentExpandableInvestigationCard
                              key={inv.id}
                              inv={inv}
                              expanded={expandedCurrentId === inv.id}
                              onToggleExpand={() =>
                                setExpandedCurrentId((id) => (id === inv.id ? null : inv.id))
                              }
                              entries={labEntriesByInvestigationId.get(inv.id) ?? []}
                              priorInv={priorInv}
                              priorEntries={priorEntries}
                              onAcknowledge={acknowledgeSignOff}
                              signingId={signingId}
                              canAcknowledge={Boolean(reviewingDoctorId)}
                              onUploadReport={() => setOcrTargetInv(inv)}
                            />
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h2 className="mb-3 text-sm font-bold text-gray-900">Compare with relevant past results</h2>
                    {comparePairs.length === 0 ? (
                      <p className="rounded-xl border border-gray-200 bg-white py-10 text-center text-sm text-gray-500">
                        No investigations on this encounter yet, or no prior orders to compare.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {comparePairs.map(({ testName, current, prior }) => (
                          <li
                            key={current.id}
                            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                          >
                            <p className="text-sm font-bold text-gray-900">{testName}</p>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-lg border border-gray-100 bg-slate-50/80 p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                  {prior ? "Previous encounter" : "Previous"}
                                </p>
                                {prior ? (
                                  <>
                                    <p className="mt-1 text-xs text-gray-600">{formatOrderedDate(prior.ordered_at)}</p>
                                    <div className="mt-2 flex items-center gap-2">
                                      <span className={`h-2 w-2 rounded-full ${resultStatusDotClass(prior.result_status)}`} />
                                      <span className="text-xs font-medium capitalize text-gray-800">
                                        {normalizeResultStatus(prior.result_status) || "—"}
                                      </span>
                                    </div>
                                  </>
                                ) : (
                                  <p className="mt-2 text-xs text-gray-500">No prior order found.</p>
                                )}
                              </div>
                              <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                                  This encounter
                                </p>
                                <p className="mt-1 text-xs text-gray-700">{formatOrderedDate(current.ordered_at)}</p>
                                <div className="mt-2 flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${resultStatusDotClass(current.result_status)}`} />
                                  <span className="text-xs font-medium capitalize text-gray-900">
                                    {normalizeResultStatus(current.result_status) || "—"}
                                  </span>
                                </div>
                                {investigationStatusPending(current.status) ? (
                                  <button
                                    type="button"
                                    onClick={() => setOcrTargetInv(current)}
                                    className="mt-3 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm hover:bg-blue-50"
                                  >
                                    Upload Report
                                  </button>
                                ) : null}
                                {isReadyForReview(current) && reviewingDoctorId ? (
                                  <button
                                    type="button"
                                    disabled={signingId === current.id}
                                    onClick={() => void acknowledgeSignOff(current.id)}
                                    className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {signingId === current.id ? "Signing…" : "Acknowledge & Sign Off"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}
            </main>

            {/* Right */}
            <aside className="w-full shrink-0 space-y-4 lg:w-72">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Key trends</p>
                {trendSeries.length === 0 ? (
                  <p className="py-6 text-center text-xs text-gray-500">Not enough numeric results over time yet.</p>
                ) : (
                  <ul className="space-y-5">
                    {trendSeries.map((s) => (
                      <li key={s.key}>
                        <p className="mb-1 truncate text-xs font-semibold text-gray-800" title={s.key}>
                          {s.key}
                        </p>
                        <div className="h-36 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={s.data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} width={36} />
                              <Tooltip />
                              <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Recent activity</p>
                {recentWorkflowLines.length === 0 ? (
                  <p className="py-6 text-center text-xs text-gray-500">No workflow events recorded yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {recentWorkflowLines.map((w) => (
                      <li key={w.id} className="flex gap-2 text-xs">
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${workflowDot(w.step)}`} />
                        <div>
                          <p className="font-medium text-gray-800">
                            {w.testName}: {stepLabel(w.step)}
                          </p>
                          <p className="text-gray-500">{relativeTime(w.performed_at)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>
        </>
      )}

      {ocrTargetInv?.hospital_id ? (
        <OCRUploadModal
          open
          onClose={() => setOcrTargetInv(null)}
          investigationId={ocrTargetInv.id}
          patientId={ocrTargetInv.patient_id}
          hospitalId={String(ocrTargetInv.hospital_id)}
          uploadedBy={reviewingDoctorId}
          investigationTestName={ocrTargetInv.test_name}
          onSuccess={() => void load()}
        />
      ) : null}
    </div>
  );
}

function formatLabEntryValue(e: LabResultEntryRow): string {
  const t = e.value_text != null ? String(e.value_text).trim() : "";
  if (t) return t;
  if (e.value_numeric != null && Number.isFinite(Number(e.value_numeric))) return String(e.value_numeric);
  return "—";
}

function formatRefRangeDisplay(e: LabResultEntryRow): string {
  const rt = e.ref_range_text?.trim();
  if (rt) return rt;
  if (e.ref_range_low != null && e.ref_range_high != null) {
    return `${e.ref_range_low}–${e.ref_range_high}`;
  }
  return "—";
}

function paramKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

function InvestigationWorkflowRail({ inv }: { inv: InvestigationRecord }) {
  const steps: { label: string; at: string | null }[] = [
    { label: "Ordered", at: inv.ordered_at },
    { label: "Collected", at: inv.collected_at },
    { label: "Resulted", at: inv.resulted_at },
    { label: "Reviewed", at: inv.reviewed_at },
  ];
  return (
    <div className="shrink-0 lg:w-[158px]" aria-label="Investigation workflow">
      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const done = Boolean(s.at?.trim());
          return (
            <li key={s.label} className="flex gap-3">
              <div className="flex w-4 shrink-0 flex-col items-center pt-1">
                <span
                  className={`h-3 w-3 rounded-full border-2 ${
                    done ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white"
                  }`}
                  aria-hidden
                />
                {i < steps.length - 1 ? (
                  <span className="my-0.5 min-h-[14px] w-px flex-1 bg-gray-200" aria-hidden />
                ) : null}
              </div>
              <div className="min-w-0 pb-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{s.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-700">{formatOrderedDate(s.at)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LabResultsSection({
  title,
  accentClass,
  rows,
}: {
  title: string;
  accentClass: string;
  rows: LabResultEntryRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${accentClass}`}>{title}</p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[480px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2">Parameter</th>
              <th className="px-2 py-2">Value</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Ref range</th>
              <th className="px-2 py-2 text-center">Abnormal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const abnormal = e.is_abnormal === true;
              return (
                <tr
                  key={e.id}
                  className={`border-b border-gray-100 ${abnormal ? "bg-red-50/90 text-red-900" : "text-gray-800"}`}
                >
                  <td className={`px-2 py-1.5 font-medium ${abnormal ? "text-red-900" : ""}`}>
                    {(e.parameter_name ?? "").trim() || "—"}
                  </td>
                  <td className={`px-2 py-1.5 tabular-nums ${abnormal ? "font-semibold text-red-800" : ""}`}>
                    {formatLabEntryValue(e)}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600">{(e.unit ?? "").trim() || "—"}</td>
                  <td className="px-2 py-1.5 text-gray-600">{formatRefRangeDisplay(e)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span
                      className={`inline-flex min-w-[2rem] justify-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        abnormal ? "bg-red-200 text-red-900" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {abnormal ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriorComparisonBlock({
  currentEntries,
  priorEntries,
  priorInv,
}: {
  currentEntries: LabResultEntryRow[];
  priorEntries: LabResultEntryRow[];
  priorInv: InvestigationRecord | null;
}) {
  if (!priorInv) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-slate-50/60 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Previous results</p>
        <p className="mt-1 text-xs text-gray-500">No prior order for this test on record.</p>
      </div>
    );
  }
  const priorMap = new Map<string, LabResultEntryRow>();
  for (const p of priorEntries) {
    const k = paramKey(p.parameter_name);
    if (k) priorMap.set(k, p);
  }
  const rows = currentEntries
    .filter((c) => paramKey(c.parameter_name))
    .map((c) => {
      const pk = paramKey(c.parameter_name);
      const prev = priorMap.get(pk);
      return {
        parameter: (c.parameter_name ?? "").trim(),
        current: formatLabEntryValue(c),
        previous: prev ? formatLabEntryValue(prev) : "—",
      };
    });
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-slate-50/50 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Previous results</p>
        <p className="mt-1 text-xs text-gray-600">
          Prior order {formatOrderedDate(priorInv.ordered_at)} — no line-item comparison (add results to compare).
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Comparison with previous ({formatOrderedDate(priorInv.ordered_at)})
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[360px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2">Parameter</th>
              <th className="px-2 py-2">Current</th>
              <th className="px-2 py-2">Previous</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.parameter} className="border-b border-gray-100 text-gray-800">
                <td className="px-2 py-1.5 font-medium">{r.parameter}</td>
                <td className="px-2 py-1.5 tabular-nums text-gray-900">{r.current}</td>
                <td className="px-2 py-1.5 tabular-nums text-gray-600">{r.previous}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CurrentExpandableInvestigationCard({
  inv,
  expanded,
  onToggleExpand,
  entries,
  priorInv,
  priorEntries,
  onAcknowledge,
  signingId,
  canAcknowledge,
  onUploadReport,
}: {
  inv: InvestigationRecord;
  expanded: boolean;
  onToggleExpand: () => void;
  entries: LabResultEntryRow[];
  priorInv: InvestigationRecord | null;
  priorEntries: LabResultEntryRow[];
  onAcknowledge?: (id: string) => void;
  signingId?: string | null;
  canAcknowledge?: boolean;
  onUploadReport?: () => void;
}) {
  const rs = normalizeResultStatus(inv.result_status);
  const st = (inv.status ?? "").trim().toLowerCase();
  const showUploadReport = Boolean(onUploadReport) && (st === "ordered" || st === "collected");
  const tat = inv.expected_tat_hours;
  const tatNum = typeof tat === "number" ? tat : tat != null ? parseFloat(String(tat)) : NaN;
  const tatLine = Number.isFinite(tatNum) ? `Expected: ${tatNum}h` : null;
  const sub = (inv.test_subcategory ?? "").trim();
  const showSign = Boolean(onAcknowledge && canAcknowledge && isReadyForReview(inv));

  const abnormalRows = entries.filter((e) => e.is_abnormal === true);
  const normalRows = entries.filter((e) => e.is_abnormal !== true);
  const indication = (inv.clinical_indication ?? "").trim();

  return (
    <li className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className="flex w-full cursor-pointer items-start gap-3 p-4 text-left transition hover:bg-slate-50/80"
      >
        <span
          className="mt-0.5 shrink-0 text-gray-400"
          aria-hidden
        >
          {expanded ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">{(inv.test_name ?? "").trim() || "Investigation"}</p>
              {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
            </div>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${resultStatusBadgeClass(inv.result_status)}`}
            >
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${resultStatusDotClass(inv.result_status)}`} />
              {rs || "—"}
            </span>
          </div>
          {tatLine ? <p className="mt-2 text-xs text-amber-800">{tatLine}</p> : null}
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-gray-100 bg-white">
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-6">
            <div className="min-w-0 space-y-4">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Clinical indication</p>
                <p className="rounded-lg border border-gray-100 bg-slate-50/80 px-3 py-2 text-sm text-gray-800">
                  {indication || "—"}
                </p>
              </div>

              {entries.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 bg-slate-50/50 px-3 py-4 text-center text-xs text-gray-500">
                  No lab results linked yet. They will appear here when entered or uploaded.
                </p>
              ) : (
                <div className="space-y-4">
                  <LabResultsSection title="Abnormal / critical" accentClass="text-red-700" rows={abnormalRows} />
                  <LabResultsSection title="Within reference" accentClass="text-emerald-800" rows={normalRows} />
                </div>
              )}

              <PriorComparisonBlock
                currentEntries={entries}
                priorEntries={priorEntries}
                priorInv={priorInv}
              />

              <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:flex-wrap">
                {showUploadReport ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUploadReport?.();
                    }}
                    className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-xs font-semibold text-blue-700 shadow-sm hover:bg-blue-50"
                  >
                    Upload Report
                  </button>
                ) : null}
                {showSign ? (
                  <button
                    type="button"
                    disabled={signingId === inv.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onAcknowledge?.(inv.id);
                    }}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {signingId === inv.id ? "Signing…" : "Acknowledge & Sign Off"}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="lg:border-l lg:border-gray-100 lg:pl-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 lg:hidden">
                Workflow
              </p>
              <InvestigationWorkflowRail inv={inv} />
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function workflowDot(step: string): string {
  const s = step.toLowerCase();
  if (s.includes("cancel")) return "bg-red-500";
  if (s.includes("review")) return "bg-gray-400";
  if (s.includes("result")) return "bg-emerald-500";
  if (s.includes("ordered") || s.includes("sample")) return "bg-blue-500";
  return "bg-slate-400";
}

function StatCard({
  title,
  value,
  subtitle,
  accent,
  dotClass,
}: {
  title: string;
  value: number;
  subtitle: string;
  accent: string;
  dotClass: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${accent}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        <p className="text-[11px] font-bold uppercase tracking-wide opacity-90">{title}</p>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] opacity-80">{subtitle}</p>
    </div>
  );
}

function OrderedCard({
  inv,
  onAcknowledge,
  signingId,
  canAcknowledge,
  onUploadReport,
}: {
  inv: InvestigationRecord;
  onAcknowledge?: (id: string) => void;
  signingId?: string | null;
  canAcknowledge?: boolean;
  onUploadReport?: () => void;
}) {
  const rs = normalizeResultStatus(inv.result_status);
  const st = (inv.status ?? "").trim().toLowerCase();
  const showUploadReport =
    Boolean(onUploadReport) && (st === "ordered" || st === "collected");
  const tat = inv.expected_tat_hours;
  const tatNum = typeof tat === "number" ? tat : tat != null ? parseFloat(String(tat)) : NaN;
  const tatLine = Number.isFinite(tatNum) ? `Expected: ${tatNum}h` : null;
  const sub = (inv.test_subcategory ?? "").trim();
  const showSign =
    Boolean(onAcknowledge && canAcknowledge && isReadyForReview(inv));

  return (
    <li className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">{(inv.test_name ?? "").trim() || "Investigation"}</p>
          {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${resultStatusBadgeClass(inv.result_status)}`}
        >
          <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${resultStatusDotClass(inv.result_status)}`} />
          {rs || "—"}
        </span>
      </div>
      {tatLine ? <p className="mt-3 text-xs text-amber-800">{tatLine}</p> : null}
      {showUploadReport ? (
        <button
          type="button"
          onClick={() => onUploadReport?.()}
          className="mt-3 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm hover:bg-blue-50"
        >
          Upload Report
        </button>
      ) : null}
      {showSign ? (
        <button
          type="button"
          disabled={signingId === inv.id}
          onClick={() => onAcknowledge?.(inv.id)}
          className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {signingId === inv.id ? "Signing…" : "Acknowledge & Sign Off"}
        </button>
      ) : null}
    </li>
  );
}
