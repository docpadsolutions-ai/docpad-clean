"use client";

/**
 * DocPad Lab Tech — `/lab`
 * Today’s investigations for the signed-in hospital: collect samples, enter results, mark ready.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import OCRUploadModal from "@/components/investigations/OCRUploadModal";
import { fetchAuthOrgId } from "@/lib/authOrg";
import { formatOrderedDate } from "@/lib/investigationsUi";
import { practitionerDisplayNameFromRow, practitionersOrFilterForAuthUid } from "@/lib/practitionerAuthLookup";
import { supabase } from "@/lib/supabase";

/** Row from `get_lab_queue` / `get_lab_queue_external` RPCs, plus merged OPD `investigations` rows. */
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
  /** IPD queue RPC vs OPD `investigations` merged row */
  queue_source: "ipd" | "opd";
};

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

function patientAgeYears(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth?.trim()) return null;
  const d = new Date(dateOfBirth);
  if (Number.isNaN(d.getTime())) return null;
  const yrs = Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
  return yrs >= 0 ? yrs : null;
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

function priorityPillClass(p: string | null | undefined): string {
  const x = norm(p);
  if (x === "stat") return "bg-red-100 text-red-900 ring-red-200";
  if (x === "urgent") return "bg-amber-100 text-amber-950 ring-amber-200";
  if (x === "routine") return "bg-slate-100 text-slate-800 ring-slate-200";
  return "bg-gray-100 text-gray-800 ring-gray-200";
}

function statusPillClass(st: string | null | undefined): string {
  const x = norm(st);
  if (x === "ordered" || x === "pending_collection") return "bg-amber-50 text-amber-900 ring-amber-200";
  if (x === "sample_collected" || x === "collected" || x === "in_progress") return "bg-blue-50 text-blue-900 ring-blue-200";
  if (x === "result_entered" || x === "resulted" || x === "ready") return "bg-emerald-50 text-emerald-900 ring-emerald-200";
  return "bg-gray-50 text-gray-800 ring-gray-200";
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
        if (opts?.silent) setSilentLoading(false);
        else setLoading(false);
        return;
      }

      const rawList = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
      const ipdRows: InvestigationLabRow[] = rawList.map((row) => ({
        order_id: String(row.order_id ?? ""),
        patient_id: row.patient_id != null ? String(row.patient_id) : null,
        test_name: row.test_name != null ? String(row.test_name) : null,
        test_category: row.test_category != null ? String(row.test_category) : null,
        priority: row.priority != null ? String(row.priority) : null,
        status: row.status != null ? String(row.status) : null,
        patient_name: row.patient_name != null ? String(row.patient_name) : null,
        patient_age: row.patient_age != null ? Number(row.patient_age) : null,
        patient_sex: row.patient_sex != null ? String(row.patient_sex) : null,
        ward_name: row.ward_name != null ? String(row.ward_name) : null,
        bed_number: row.bed_number != null ? String(row.bed_number) : null,
        admission_number: row.admission_number != null ? String(row.admission_number) : null,
        sample_type: row.sample_type != null ? String(row.sample_type) : null,
        requires_fasting: Boolean(row.requires_fasting),
        expected_tat_hrs: row.expected_tat_hrs != null ? Number(row.expected_tat_hrs) : null,
        ordered_by_name: row.ordered_by_name != null ? String(row.ordered_by_name) : null,
        ordered_by_id: row.ordered_by_id != null ? String(row.ordered_by_id) : null,
        ordered_at: row.ordered_at != null ? String(row.ordered_at) : null,
        is_in_house: row.is_in_house != null ? Boolean(row.is_in_house) : null,
        external_lab_name: row.external_lab_name != null ? String(row.external_lab_name) : null,
        billing_status: row.billing_status != null ? String(row.billing_status) : null,
        queue_source: "ipd",
      }));

      let merged: InvestigationLabRow[] = ipdRows;

      if (view === "inhouse") {
        const { data: opdData, error: opdErr } = await supabase
          .from("investigations")
          .select(
            "id, patient_id, hospital_id, test_name, test_category, priority, status, ordered_at, expected_tat_hours, billing_status, doctor_id, encounter_id, patients (full_name, date_of_birth, sex)",
          )
          .eq("hospital_id", hid)
          .eq("billing_status", "paid")
          .in("status", ["ordered", "pending_collection", "collected", "result_entered", "resulted"])
          .not("encounter_id", "is", null);

        if (opdErr) {
          if (!opts?.silent) showToast(opdErr.message);
        } else if (opdData && opdData.length > 0) {
          const docIds = [
            ...new Set(
              (opdData as { doctor_id?: string | null }[])
                .map((r) => r.doctor_id)
                .filter((x): x is string => x != null && String(x).trim() !== ""),
            ),
          ];
          const prMap = new Map<string, { full_name?: string | null; first_name?: string | null; last_name?: string | null }>();
          if (docIds.length > 0) {
            const { data: prs } = await supabase
              .from("practitioners")
              .select("id, full_name, first_name, last_name")
              .in("id", docIds);
            for (const p of prs ?? []) {
              const rec = p as {
                id: string;
                full_name?: string | null;
                first_name?: string | null;
                last_name?: string | null;
              };
              prMap.set(String(rec.id), rec);
            }
          }

          const opdRows: InvestigationLabRow[] = (opdData as Record<string, unknown>[]).map((raw) => {
            const pt = pickOne(
              raw.patients as {
                full_name?: string | null;
                date_of_birth?: string | null;
                sex?: string | null;
              } | null,
            );
            const docId = raw.doctor_id != null ? String(raw.doctor_id) : null;
            const pr = docId ? prMap.get(docId) : undefined;
            const tatRaw = raw.expected_tat_hours;
            const tatNum = tatRaw != null && tatRaw !== "" ? Number(tatRaw) : NaN;
            return {
              order_id: String(raw.id),
              patient_id: raw.patient_id != null ? String(raw.patient_id) : null,
              test_name: raw.test_name != null ? String(raw.test_name) : null,
              test_category: raw.test_category != null ? String(raw.test_category) : null,
              status: raw.status != null ? String(raw.status) : null,
              priority: raw.priority != null ? String(raw.priority) : null,
              patient_name: pt?.full_name != null ? String(pt.full_name) : null,
              patient_age: patientAgeYears(pt?.date_of_birth != null ? String(pt.date_of_birth) : null),
              patient_sex: pt?.sex != null ? String(pt.sex) : null,
              ward_name: "",
              bed_number: "",
              admission_number: "OPD",
              sample_type: null,
              requires_fasting: false,
              expected_tat_hrs: Number.isFinite(tatNum) ? tatNum : null,
              ordered_by_name: pr ? practitionerDisplayNameFromRow(pr) : null,
              ordered_by_id: docId,
              ordered_at: raw.ordered_at != null ? String(raw.ordered_at) : null,
              is_in_house: true,
              external_lab_name: null,
              billing_status: raw.billing_status != null ? String(raw.billing_status) : null,
              queue_source: "opd",
            };
          });
          merged = [...ipdRows, ...opdRows];
        }
      }

      setRows(sortInvestigations(merged));
      setLoadError(null);

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "investigations", filter: `hospital_id=eq.${hospitalId}` },
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
      if (st === "ordered" || st === "pending_collection") pendingCollection += 1;
      else if (st === "sample_collected" || st === "collected" || st === "in_progress") inProgress += 1;
      else if (st === "result_entered" || st === "resulted" || st === "ready") {
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
      if (norm(r.billing_status) !== "paid") return false;
      const st = norm(r.status);
      if (statusFilter === "pending" && st !== "ordered" && st !== "pending_collection") return false;
      if (
        statusFilter === "collected" &&
        st !== "sample_collected" &&
        st !== "collected" &&
        st !== "in_progress"
      )
        return false;
      if (statusFilter === "resulted" && st !== "result_entered" && st !== "resulted" && st !== "ready") return false;
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

  const todayLabel = todayLocalYmd();

  function toggleStatusFilterFromStatCard(target: "all" | "pending" | "collected" | "resulted") {
    if (target === "all") {
      setStatusFilter("all");
      setPriorityFilter("all");
      return;
    }
    setStatusFilter((prev) => (prev === target ? "all" : target));
  }

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

        {/* Stats — click toggles the same filter as the Status pill row */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            title="Pending Collection"
            value={stats.pendingCollection}
            accent="border-amber-200 bg-amber-50/90 text-amber-950"
            active={statusFilter === "pending"}
            onClick={() => toggleStatusFilterFromStatCard("pending")}
          />
          <StatCard
            title="In Progress"
            value={stats.inProgress}
            accent="border-blue-200 bg-blue-50/90 text-blue-950"
            active={statusFilter === "collected"}
            onClick={() => toggleStatusFilterFromStatCard("collected")}
          />
          <StatCard
            title="Ready"
            value={stats.ready}
            accent="border-emerald-200 bg-emerald-50/90 text-emerald-950"
            active={statusFilter === "resulted"}
            onClick={() => toggleStatusFilterFromStatCard("resulted")}
          />
          <StatCard
            title="Total Today"
            value={stats.total}
            accent="border-slate-200 bg-white text-slate-900"
            active={statusFilter === "all" && priorityFilter === "all"}
            onClick={() => toggleStatusFilterFromStatCard("all")}
          />
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
                                    void runAction(row.order_id, "Sample collected.", async () => {
                                      if (row.queue_source === "opd") {
                                        return await supabase
                                          .from("investigations")
                                          .update({
                                            status: "collected",
                                            collected_at: new Date().toISOString(),
                                          })
                                          .eq("id", row.order_id)
                                          .eq("hospital_id", hospitalId ?? "");
                                      }
                                      return await supabase
                                        .from("ipd_investigation_orders")
                                        .update({
                                          status: "collected",
                                          sample_collected_at: new Date().toISOString(),
                                          sample_collected_by: labTechPractitionerId,
                                        })
                                        .eq("id", row.order_id)
                                        .eq("hospital_id", hospitalId ?? "");
                                    })
                                  }
                                >
                                  {busy ? "…" : "Collect Sample"}
                                </button>
                              ) : null}
                              {st === "sample_collected" || st === "collected" ? (
                                <button
                                  type="button"
                                  className={btnSecondary}
                                  disabled={!hospitalId}
                                  onClick={() => setOcrTarget(row)}
                                >
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
          open={Boolean(ocrTarget)}
          onClose={() => setOcrTarget(null)}
          investigationId={ocrTarget.order_id}
          patientId={ocrTarget.patient_id}
          hospitalId={hospitalId ?? ""}
          uploadedBy={labTechPractitionerId}
          investigationTestName={ocrTarget.test_name}
          onSuccess={() => {
            setOcrTarget(null);
            void loadInvestigations(hospitalId, { silent: true, view: labView });
          }}
        />
      ) : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  accent,
  active,
  onClick,
}: {
  title: string;
  value: number;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-4 py-3 text-left shadow-sm transition cursor-pointer hover:brightness-[0.99] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${accent} ${
        active ? "ring-2 ring-blue-600 ring-offset-2 ring-offset-slate-50" : ""
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{title}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </button>
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
