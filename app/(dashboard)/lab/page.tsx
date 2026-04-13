"use client";

/**
 * DocPad Lab Tech — `/lab`
 * Today’s investigations for the signed-in hospital: collect samples, enter results, mark ready.
 */

import { Fragment, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { formatDistanceToNow } from "date-fns";
import OCRUploadModal from "../../components/investigations/OCRUploadModal";
import { fetchAuthOrgId } from "../../lib/authOrg";
import { formatOrderedDate } from "../../lib/investigationsUi";
import { practitionerDisplayNameFromRow, practitionersOrFilterForAuthUid } from "../../lib/practitionerAuthLookup";
import { supabase } from "../../supabase";

/** Row from `get_lab_queue` / `get_lab_queue_external` RPCs. */
type InvestigationLabRow = {
  order_id: string;
  patient_id: string | null;
  test_name: string | null;
  test_category: string | null;
  status: string | null;
  priority: string | null;
  patient_name: string | null;
  patient_age: number | null;
  patient_sex: string | null;
  ward_name: string | null;
  bed_number: string | null;
  admission_number: string | null;
  sample_type: string | null;
  requires_fasting: boolean | null;
  expected_tat_hrs: number | null;
  ordered_by_name: string | null;
  ordered_by_id: string | null;
  ordered_at: string | null;
  is_in_house: boolean | null;
  external_lab_name: string | null;
  billing_status: string | null;
};

type ResultEntryDraft = {
  key: string;
  parameter_name: string;
  result_value: string;
  unit: string;
  reference_range: string;
  is_abnormal: boolean;
};

const inputCls =
  "w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40";

const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 transition hover:bg-gray-50 disabled:opacity-40";

const btnGhost =
  "inline-flex items-center justify-center rounded-lg border border-transparent px-2 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-50 disabled:opacity-40";

function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDayBoundsIso(): { start: string; end: string } {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function priorityRank(p: string | null | undefined): number {
  const x = norm(p);
  if (x === "stat") return 0;
  if (x === "urgent") return 1;
  if (x === "routine") return 2;
  return 3;
}

function sortInvestigations(rows: InvestigationLabRow[]): InvestigationLabRow[] {
  return [...rows].sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    return (a.ordered_at ?? "").localeCompare(b.ordered_at ?? "");
  });
}

function patientNameDocpad(row: InvestigationLabRow): { name: string; token: string } {
  const name = (row.patient_name ?? "").trim() || "—";
  const token = (row.admission_number ?? "").trim() || (row.order_id ?? "").slice(0, 8) || "—";
  return { name, token };
}

function doctorLabel(row: InvestigationLabRow): string {
  const n = (row.ordered_by_name ?? "").trim();
  return n ? `Dr. ${n}` : "—";
}

function newDraftKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyDraft(): ResultEntryDraft {
  return {
    key: newDraftKey(),
    parameter_name: "",
    result_value: "",
    unit: "",
    reference_range: "",
    is_abnormal: false,
  };
}

function defaultDraftsForTest(testName: string | null | undefined): ResultEntryDraft[] {
  const n = (testName ?? "").trim();
  if (!n) return [emptyDraft()];
  const lower = n.toLowerCase();
  if (lower.includes("cbc") || lower.includes("complete blood")) {
    return ["Hb", "Total WBC", "Platelets", "RBC"].map((parameter_name) => ({
      ...emptyDraft(),
      key: newDraftKey(),
      parameter_name,
    }));
  }
  if (lower.includes("lft") || lower.includes("liver function")) {
    return ["ALT", "AST", "Total Bilirubin", "ALP"].map((parameter_name) => ({
      ...emptyDraft(),
      key: newDraftKey(),
      parameter_name,
    }));
  }
  if (lower.includes("rft") || lower.includes("renal") || lower.includes("kidney function")) {
    return ["Creatinine", "Urea", "eGFR"].map((parameter_name) => ({
      ...emptyDraft(),
      key: newDraftKey(),
      parameter_name,
    }));
  }
  return [{ ...emptyDraft(), parameter_name: n }];
}

function priorityPillClass(p: string | null | undefined): string {
  const x = norm(p);
  if (x === "stat") return "bg-red-100 text-red-900 ring-red-200";
  if (x === "urgent") return "bg-amber-100 text-amber-950 ring-amber-200";
  if (x === "routine") return "bg-slate-100 text-slate-800 ring-slate-200";
  return "bg-gray-100 text-gray-800 ring-gray-200";
}

function statusPillClass(st: string | null | undefined): string {
  const x = norm(st);
  if (x === "ordered") return "bg-amber-50 text-amber-900 ring-amber-200";
  if (x === "sample_collected" || x === "collected") return "bg-blue-50 text-blue-900 ring-blue-200";
  if (x === "result_entered" || x === "resulted") return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  return "bg-gray-50 text-gray-800 ring-gray-200";
}

function parseResultValue(raw: string): { value_numeric: number | null; value_text: string } {
  const t = raw.trim();
  if (!t) return { value_numeric: null, value_text: "" };
  const n = Number.parseFloat(t.replace(/,/g, ""));
  if (!Number.isNaN(n) && Number.isFinite(n)) {
    return { value_numeric: n, value_text: t };
  }
  return { value_numeric: null, value_text: t };
}

export default function LabTechDashboardPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [rows, setRows] = useState<InvestigationLabRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [silentLoading, setSilentLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "collected" | "resulted">("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "stat" | "urgent" | "routine">("all");
  const [labView, setLabView] = useState<"inhouse" | "external">("inhouse");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryDrafts, setEntryDrafts] = useState<ResultEntryDraft[]>([]);
  const [savingResults, setSavingResults] = useState(false);
  const [ocrTarget, setOcrTarget] = useState<InvestigationLabRow | null>(null);
  const [labTechPractitionerId, setLabTechPractitionerId] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3400);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid) {
        if (!cancelled) setLabTechPractitionerId(null);
        return;
      }
      const { data: pr } = await supabase
        .from("practitioners")
        .select("id")
        .or(practitionersOrFilterForAuthUid(uid))
        .maybeSingle();
      if (!cancelled) setLabTechPractitionerId(pr?.id != null ? String(pr.id) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadInvestigations = useCallback(
    async (hid: string | null, opts?: { silent?: boolean; view?: "inhouse" | "external" }) => {
      if (!hid) {
        setRows([]);
        setLoading(false);
        setSilentLoading(false);
        return;
      }
      if (opts?.silent) setSilentLoading(true);
      else {
        setLoading(true);
        setLoadError(null);
      }

      const view = opts?.view ?? labView;
      const rpc = view === "external" ? "get_lab_queue_external" : "get_lab_queue";
      const { data, error } = await supabase.rpc(rpc, { p_hospital_id: hid });

      if (error) {
        if (!opts?.silent) setLoadError(error.message);
        showToast(error.message);
        setRows([]);
      } else {
        const list = (Array.isArray(data) ? data : []) as InvestigationLabRow[];
        setRows(sortInvestigations(list));
        setLoadError(null);
      }

      if (opts?.silent) setSilentLoading(false);
      else setLoading(false);
    },
    [showToast, labView],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { orgId, error } = await fetchAuthOrgId();
      if (cancelled) return;
      if (error) setOrgError(error.message);
      setHospitalId(orgId);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel(`lab-queue-${hospitalId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ipd_investigation_orders", filter: `hospital_id=eq.${hospitalId}` },
        () => {
          void loadInvestigations(hospitalId, { silent: true });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hospitalId, loadInvestigations]);

  useEffect(() => {
    if (!hospitalId) return;
    void loadInvestigations(hospitalId);
  }, [hospitalId, labView, loadInvestigations]);

  const stats = useMemo(() => {
    let pendingCollection = 0;
    let inProgress = 0;
    let ready = 0;
    for (const r of rows) {
      const st = norm(r.status);
      if (st === "ordered") pendingCollection += 1;
      else if (st === "sample_collected" || st === "collected") inProgress += 1;
      else if (st === "result_entered" || st === "resulted") {
        ready += 1;
      }
    }
    return {
      pendingCollection,
      inProgress,
      ready,
      total: rows.length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const st = norm(r.status);
      if (statusFilter === "pending" && st !== "ordered") return false;
      if (statusFilter === "collected" && st !== "sample_collected" && st !== "collected") return false;
      if (statusFilter === "resulted" && st !== "result_entered" && st !== "resulted") return false;
      const pr = norm(r.priority);
      if (priorityFilter === "stat" && pr !== "stat") return false;
      if (priorityFilter === "urgent" && pr !== "urgent") return false;
      if (priorityFilter === "routine" && pr !== "routine") return false;
      return true;
    });
  }, [rows, statusFilter, priorityFilter]);

  async function runAction(id: string, label: string, fn: () => Promise<{ error: { message: string } | null }>) {
    setActionId(id);
    const { error } = await fn();
    setActionId(null);
    if (error) {
      showToast(error.message);
      return;
    }
    showToast(label);
    await loadInvestigations(hospitalId, { silent: true, view: labView });
  }

  function openEnterResults(row: InvestigationLabRow) {
    setEditingId(row.order_id);
    setEntryDrafts([{ ...emptyDraft(), parameter_name: (row.test_name ?? "").trim() || "Result" }]);
  }

  function closeEnterResults() {
    setEditingId(null);
    setEntryDrafts([]);
  }

  async function saveLabResults(inv: InvestigationLabRow) {
    const d = entryDrafts[0];
    if (!d || !d.result_value.trim()) {
      showToast("Enter a result value.");
      return;
    }
    setSavingResults(true);
    const now = new Date().toISOString();
    const { value_numeric, value_text } = parseResultValue(d.result_value);
    const isCritical = d.is_abnormal;

    const { error: upErr } = await supabase
      .from("ipd_investigation_orders")
      .update({
        status: "result_entered",
        result_value: value_numeric,
        result_unit: d.unit.trim() || null,
        result_text: value_text || d.result_value.trim(),
        is_critical: isCritical,
        result_available_at: now,
      })
      .eq("id", inv.order_id)
      .eq("hospital_id", hospitalId ?? "");

    if (upErr) {
      setSavingResults(false);
      showToast(upErr.message);
      return;
    }

    if (isCritical && inv.ordered_by_id) {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      const ward = (inv.ward_name ?? "").trim();
      const bed = (inv.bed_number ?? "").trim();
      const loc = [ward, bed ? `Bed ${bed}` : ""].filter(Boolean).join(" ");
      await supabase.from("notifications").insert({
        hospital_id: hospitalId,
        recipient_id: inv.ordered_by_id,
        sender_id: uid,
        type: "critical_lab",
        priority: "critical",
        context: "IPD",
        title: "Critical lab result",
        body: `CRITICAL: ${(inv.test_name ?? "").trim()} — ${(inv.patient_name ?? "").trim()}${loc ? ` (${loc})` : ""}`,
        data: { order_id: inv.order_id, test_name: inv.test_name },
        action_url: `/dashboard/ipd`,
      });
    }

    setSavingResults(false);
    showToast("Results saved.");
    closeEnterResults();
    await loadInvestigations(hospitalId, { silent: true, view: labView });
  }

  const todayLabel = todayLocalYmd();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Lab</h1>
            <p className="text-xs text-gray-500">
              Today’s investigations · {todayLabel}
              {silentLoading ? <span className="ml-2 text-blue-600">Updating…</span> : null}
            </p>
          </div>
          <button
            type="button"
            className={btnSecondary}
            disabled={!hospitalId || loading}
            onClick={() => void loadInvestigations(hospitalId, { silent: true, view: labView })}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {orgError ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Organization lookup: {orgError}
          </p>
        ) : null}
        {!hospitalId && !orgError && !loading ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No hospital context — sign in as a practitioner linked to a hospital.
          </p>
        ) : null}

        {loadError ? (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>
        ) : null}

        {toast ? (
          <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 shadow-lg">
            {toast}
          </div>
        ) : null}

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard title="Pending Collection" value={stats.pendingCollection} accent="border-amber-200 bg-amber-50/90 text-amber-950" />
          <StatCard title="In Progress" value={stats.inProgress} accent="border-blue-200 bg-blue-50/90 text-blue-950" />
          <StatCard title="Ready" value={stats.ready} accent="border-emerald-200 bg-emerald-50/90 text-emerald-950" />
          <StatCard title="Total Today" value={stats.total} accent="border-slate-200 bg-white text-slate-900" />
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <FilterChipGroup
            label="Queue"
            value={labView}
            onChange={(v) => setLabView(v)}
            options={[
              { id: "inhouse", label: "In-house" },
              { id: "external", label: "External" },
            ]}
          />
          <FilterChipGroup
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { id: "all", label: "All" },
              { id: "pending", label: "Pending" },
              { id: "collected", label: "Collected" },
              { id: "resulted", label: "Resulted" },
            ]}
          />
          <FilterChipGroup
            label="Priority"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { id: "all", label: "All" },
              { id: "stat", label: "Stat" },
              { id: "urgent", label: "Urgent" },
              { id: "routine", label: "Routine" },
            ]}
          />
        </div>

        {loading ? (
          <div className="animate-pulse space-y-2 rounded-xl border border-gray-100 bg-white p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-[1000px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-3">Token</th>
                  <th className="px-3 py-3">Patient</th>
                  <th className="px-3 py-3">Test</th>
                  <th className="px-3 py-3">Category</th>
                  {labView === "external" ? <th className="px-3 py-3">External Lab</th> : null}
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-3 py-3">Doctor</th>
                  <th className="px-3 py-3">Ordered At</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={labView === "external" ? 10 : 9} className="px-3 py-12 text-center text-sm text-gray-500">
                      No investigations match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const { name, token } = patientNameDocpad(row);
                    const st = norm(row.status);
                    const busy = actionId === row.order_id;
                    const isEditing = editingId === row.order_id;
                    const rel =
                      row.ordered_at && !Number.isNaN(Date.parse(row.ordered_at))
                        ? formatDistanceToNow(new Date(row.ordered_at), { addSuffix: true })
                        : "—";
                    const ageSex = [row.patient_age != null ? `${row.patient_age}y` : "", (row.patient_sex ?? "").trim()]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <Fragment key={row.order_id}>
                        <tr className="border-b border-gray-100 transition hover:bg-slate-50/50">
                          <td className="px-3 py-2.5 font-mono text-xs font-semibold text-gray-800">{token}</td>
                          <td className="px-3 py-2.5 text-gray-900">
                            <div className="font-medium">{name}</div>
                            {ageSex ? <div className="text-[11px] text-gray-500">{ageSex}</div> : null}
                          </td>
                          <td className="max-w-[220px] px-3 py-2.5 text-gray-800">
                            <span className="line-clamp-2 font-medium">{(row.test_name ?? "").trim() || "—"}</span>
                            {(row.sample_type ?? "").trim() ? (
                              <span className="mt-0.5 block text-[11px] text-gray-500">{(row.sample_type ?? "").trim()}</span>
                            ) : null}
                            {row.requires_fasting ? (
                              <span className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                                Fasting
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600">{(row.test_category ?? "").trim() || "—"}</td>
                          {labView === "external" ? (
                            <td className="px-3 py-2.5 text-gray-700">{(row.external_lab_name ?? "").trim() || "—"}</td>
                          ) : null}
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${priorityPillClass(row.priority)} ${norm(row.priority) === "stat" ? "animate-pulse" : ""}`}
                            >
                              {(row.priority ?? "").trim() || "—"}
                            </span>
                          </td>
                          <td className="max-w-[160px] px-3 py-2.5 text-xs text-gray-700">
                            <span className="line-clamp-2">{doctorLabel(row)}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-600">
                            <div>{formatOrderedDate(row.ordered_at)}</div>
                            <div className="text-[10px] text-gray-400">{rel}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${statusPillClass(row.status)}`}
                            >
                              {(row.status ?? "").trim() || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              {st === "ordered" ? (
                                <button
                                  type="button"
                                  disabled={busy || !hospitalId || !labTechPractitionerId}
                                  className={btnPrimary}
                                  onClick={() =>
                                    void runAction(row.order_id, "Sample collected.", async () =>
                                      await supabase
                                        .from("ipd_investigation_orders")
                                        .update({
                                          status: "sample_collected",
                                          sample_collected_at: new Date().toISOString(),
                                          sample_collected_by: labTechPractitionerId,
                                        })
                                        .eq("id", row.order_id)
                                        .eq("hospital_id", hospitalId ?? ""),
                                    )
                                  }
                                >
                                  {busy ? "…" : "Collect Sample"}
                                </button>
                              ) : null}
                              {st === "sample_collected" || st === "collected" ? (
                                <button type="button" className={btnSecondary} onClick={() => openEnterResults(row)}>
                                  Enter Result
                                </button>
                              ) : null}
                              {st === "result_entered" || st === "resulted" ? (
                                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                                  Resulted
                                </span>
                              ) : null}
                              {labView === "external" && (st === "ordered" || st === "sample_collected" || st === "collected") ? (
                                <>
                                  <button
                                    type="button"
                                    className={btnGhost}
                                    onClick={() => {
                                      window.print();
                                    }}
                                  >
                                    Print Requisition
                                  </button>
                                  <button type="button" className={btnGhost} disabled={!hospitalId} onClick={() => setOcrTarget(row)}>
                                    Upload Result
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {isEditing ? (
                          <tr className="border-b border-gray-200 bg-blue-50/30">
                            <td colSpan={labView === "external" ? 10 : 9} className="px-4 py-4">
                              <EnterResultsPanel
                                testLabel={(row.test_name ?? "").trim() || "Investigation"}
                                drafts={entryDrafts}
                                setDrafts={setEntryDrafts}
                                saving={savingResults}
                                onAddRow={() => setEntryDrafts((d) => [...d, emptyDraft()])}
                                onCancel={closeEnterResults}
                                onSave={() => void saveLabResults(row)}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {ocrTarget ? (
        <OCRUploadModal
          open
          onClose={() => setOcrTarget(null)}
          investigationId={ocrTarget.order_id}
          patientId={ocrTarget.patient_id}
          hospitalId={hospitalId ?? ""}
          uploadedBy={labTechPractitionerId}
          investigationTestName={ocrTarget.test_name}
          onSuccess={() => void loadInvestigations(hospitalId, { silent: true, view: labView })}
        />
      ) : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  accent,
}: {
  title: string;
  value: number;
  accent: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${accent}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{title}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function FilterChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
            value === o.id ? "bg-blue-600 text-white shadow-sm" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EnterResultsPanel({
  testLabel,
  drafts,
  setDrafts,
  saving,
  onAddRow,
  onCancel,
  onSave,
}: {
  testLabel: string;
  drafts: ResultEntryDraft[];
  setDrafts: Dispatch<SetStateAction<ResultEntryDraft[]>>;
  saving: boolean;
  onAddRow: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-gray-900">Enter results · {testLabel}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={onAddRow}>
            + Add parameter
          </button>
          <button type="button" className={btnGhost} onClick={onCancel}>
            Close
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {drafts.map((d, idx) => (
          <div key={d.key} className="grid gap-2 rounded-lg border border-gray-100 bg-slate-50/50 p-3 sm:grid-cols-12 sm:items-end">
            <label className="sm:col-span-3">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Parameter</span>
              <input
                className={inputCls}
                value={d.parameter_name}
                onChange={(e) =>
                  setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, parameter_name: e.target.value } : x)))
                }
                placeholder="e.g. Hb"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Result</span>
              <input
                className={inputCls}
                value={d.result_value}
                onChange={(e) =>
                  setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, result_value: e.target.value } : x)))
                }
                placeholder="Value"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Unit</span>
              <input
                className={inputCls}
                value={d.unit}
                onChange={(e) =>
                  setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, unit: e.target.value } : x)))
                }
              />
            </label>
            <label className="sm:col-span-3">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Reference</span>
              <input
                className={inputCls}
                value={d.reference_range}
                onChange={(e) =>
                  setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, reference_range: e.target.value } : x)))
                }
                placeholder="e.g. 12–16 g/dL"
              />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={d.is_abnormal}
                onChange={(e) =>
                  setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, is_abnormal: e.target.checked } : x)))
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-xs font-medium text-gray-700">Critical</span>
            </label>
            {drafts.length > 1 ? (
              <div className="sm:col-span-12">
                <button
                  type="button"
                  className="text-xs font-semibold text-rose-700 hover:underline"
                  onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                >
                  Remove row
                </button>
              </div>
            ) : null}
          </div>
        ))}
        {drafts.length === 0 ? <p className="text-xs text-gray-500">No rows — use “Add parameter”.</p> : null}
      </div>
    </div>
  );
}
