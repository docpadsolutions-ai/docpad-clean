"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/app/supabase";
import { fetchAuthOrgId } from "@/app/lib/authOrg";
import { useToast } from "@/src/components/ui/toast-provider";
import { formatOrderedDate } from "@/app/lib/investigationsUi";

const DAY_MS = 86400000;

/** Workflow states still awaiting a lab result (aligned with lab queue + forward-compatible). */
const PIPELINE_STATUSES = new Set(["ordered", "sample_collected", "processing", "collected"]);

/** Terminal states where a result exists — belongs in review bucket, not SLA pipeline. */
const RESULT_READY_STATUSES = new Set(["resulted", "result_entered"]);

export type IpdPendingPanelOrder = {
  id: string;
  patient_id: string;
  hospital_id: string | null;
  admission_id: string | null;
  test_name: string | null;
  status: string | null;
  created_at: string | null;
  expected_at: string | null;
  expected_tat_hrs: number | string | null;
  result_available_at: string | null;
  acknowledged_at: string | null;
  sla_acknowledged_at: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function isPipelineStatus(status: string | null | undefined): boolean {
  return PIPELINE_STATUSES.has(norm(status));
}

/** needs_review: status = resulted and acknowledged_at IS NULL. */
function isReadyForReview(row: IpdPendingPanelOrder): boolean {
  if (row.acknowledged_at != null && String(row.acknowledged_at).trim() !== "") return false;
  return norm(row.status) === "resulted";
}

function computeExpectedAtMs(row: IpdPendingPanelOrder): number | null {
  const raw = row.expected_at;
  if (raw) {
    const t = Date.parse(String(raw));
    if (Number.isFinite(t)) return t;
  }
  const o = Date.parse(String(row.created_at ?? ""));
  if (!Number.isFinite(o)) return null;
  const tat = row.expected_tat_hrs;
  const hrs = typeof tat === "number" ? tat : tat != null ? parseFloat(String(tat)) : NaN;
  if (!Number.isFinite(hrs) || hrs <= 0) return null;
  return o + hrs * 3600 * 1000;
}

function daysSince(iso: string | null | undefined): number {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

type PipelineBucket = "pending" | "late" | "lost";

function classifyPipeline(row: IpdPendingPanelOrder): PipelineBucket | null {
  if (row.sla_acknowledged_at && String(row.sla_acknowledged_at).trim() !== "") return null;
  if (!isPipelineStatus(row.status)) return null;
  const st = norm(row.status);
  if (RESULT_READY_STATUSES.has(st) || st === "cancelled") return null;
  if (row.result_available_at && String(row.result_available_at).trim() !== "") return null;

  const expectedMs = computeExpectedAtMs(row);
  if (expectedMs == null) return "pending";

  const now = Date.now();
  const msPastDue = now - expectedMs;
  if (msPastDue <= 0) return "pending";
  if (msPastDue > 3 * DAY_MS) return "lost";
  return "late";
}

const SELECT =
  "id, patient_id, hospital_id, admission_id, test_name, status, created_at, expected_at, expected_tat_hrs, result_available_at, acknowledged_at, sla_acknowledged_at";

export default function IPDPendingResultsPanel({
  admissionId,
  patientId,
  hospitalId: hospitalIdProp,
  practitionerId,
  onRefresh,
  defaultOpen = true,
}: {
  admissionId: string;
  patientId: string;
  /** When omitted, resolved from `auth_org()`. */
  hospitalId?: string | null;
  practitionerId: string | null;
  onRefresh?: () => void;
  defaultOpen?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [resolvedHospitalId, setResolvedHospitalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IpdPendingPanelOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const lostToastShown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let h = (hospitalIdProp ?? "").trim();
      if (!h) {
        const { orgId } = await fetchAuthOrgId();
        h = orgId?.trim() ?? "";
      }
      if (!cancelled) setResolvedHospitalId(h || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [hospitalIdProp]);

  const load = useCallback(async () => {
    const aid = admissionId?.trim();
    const pid = patientId?.trim();
    const hid = resolvedHospitalId?.trim();
    setLoading(true);
    if (!aid || !pid || !hid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setError(null);
    const { data, error: fetchErr } = await supabase
      .from("ipd_investigation_orders")
      .select(SELECT)
      .eq("admission_id", aid)
      .eq("patient_id", pid)
      .eq("hospital_id", hid)
      .order("created_at", { ascending: false });
    if (fetchErr) {
      setError(fetchErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as IpdPendingPanelOrder[]);
    }
    setLoading(false);
  }, [admissionId, patientId, resolvedHospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { toReview, pending, late, lost } = useMemo(() => {
    const toReview: IpdPendingPanelOrder[] = [];
    const pendingL: IpdPendingPanelOrder[] = [];
    const lateL: IpdPendingPanelOrder[] = [];
    const lostL: IpdPendingPanelOrder[] = [];

    for (const row of rows) {
      if (isReadyForReview(row)) {
        toReview.push(row);
        continue;
      }
      const b = classifyPipeline(row);
      if (b === "pending") pendingL.push(row);
      else if (b === "late") lateL.push(row);
      else if (b === "lost") lostL.push(row);
    }
    return { toReview, pending: pendingL, late: lateL, lost: lostL };
  }, [rows]);

  useEffect(() => {
    if (loading || lostToastShown.current || lost.length === 0) return;
    lostToastShown.current = true;
    toast.critical({
      title: "Investigations may be lost",
      body: `${lost.length} IPD test order(s) are more than 3 days past the expected result time. Review the Lost section.`,
    });
  }, [loading, lost, toast]);

  const acknowledge = useCallback(
    async (row: IpdPendingPanelOrder, kind: "result_review" | "sla_pipeline") => {
      const prac = practitionerId?.trim();
      if (!prac) {
        setError("Sign in as a practitioner to acknowledge.");
        return;
      }
      const pid = patientId?.trim();
      const hid = (row.hospital_id ?? resolvedHospitalId)?.trim();
      const aid = admissionId?.trim();
      if (!pid || !hid || !aid) return;

      setBusyId(row.id);
      setError(null);
      const now = new Date().toISOString();

      if (kind === "result_review") {
        const { error: upErr } = await supabase
          .from("ipd_investigation_orders")
          .update({ acknowledged_at: now, acknowledged_by: prac })
          .eq("id", row.id)
          .eq("patient_id", pid)
          .eq("hospital_id", hid)
          .eq("admission_id", aid);
        if (upErr) {
          setError(upErr.message);
          setBusyId(null);
          return;
        }
      } else {
        const { error: upErr } = await supabase
          .from("ipd_investigation_orders")
          .update({ sla_acknowledged_at: now })
          .eq("id", row.id)
          .eq("patient_id", pid)
          .eq("hospital_id", hid)
          .eq("admission_id", aid);
        if (upErr) {
          setError(upErr.message);
          setBusyId(null);
          return;
        }
      }

      setBusyId(null);
      await load();
      onRefresh?.();
    },
    [practitionerId, patientId, resolvedHospitalId, admissionId, load, onRefresh],
  );

  const totalShown = toReview.length + pending.length + late.length + lost.length;
  if (!patientId.trim() || !admissionId.trim()) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Queue</p>
          <p className="text-sm font-bold text-slate-900">IPD pending results &amp; reviews</p>
          {!loading && totalShown === 0 ? (
            <p className="mt-0.5 text-xs text-slate-500">Nothing in queue right now.</p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-600">
              {loading ? "Loading…" : `${totalShown} item(s) need attention`}
            </p>
          )}
        </div>
        <span className="shrink-0 text-slate-500">
          {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </span>
      </button>

      {error ? (
        <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">{error}</p>
      ) : null}

      {open ? (
        <div className="border-t border-slate-100">
          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">Loading queue…</div>
          ) : totalShown === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">No pending investigations.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              <IpdPanelSection
                title="Results to Review"
                count={toReview.length}
                tone="emerald"
                rows={toReview}
                emptyHint="No new results awaiting sign-off."
                renderRow={(row) => (
                  <IpdResultRow
                    key={row.id}
                    row={row}
                    overdueDays={null}
                    daysPending={daysSince(row.created_at)}
                    busy={busyId === row.id}
                    acknowledgeDisabled={!practitionerId}
                    onAcknowledge={() => void acknowledge(row, "result_review")}
                    lostStyling={false}
                  />
                )}
              />
              <IpdPanelSection
                title="Pending"
                count={pending.length}
                tone="amber"
                rows={pending}
                emptyHint="No on-time orders awaiting results."
                renderRow={(row) => (
                  <IpdResultRow
                    key={row.id}
                    row={row}
                    overdueDays={null}
                    daysPending={daysSince(row.created_at)}
                    busy={busyId === row.id}
                    acknowledgeDisabled={!practitionerId}
                    onAcknowledge={() => void acknowledge(row, "sla_pipeline")}
                    lostStyling={false}
                  />
                )}
              />
              <IpdPanelSection
                title="Late"
                count={late.length}
                tone="orange"
                rows={late}
                emptyHint="No orders past expected time (within 3 days)."
                renderRow={(row) => {
                  const exp = computeExpectedAtMs(row);
                  const overdueDays =
                    exp != null && Date.now() > exp ? Math.max(1, Math.ceil((Date.now() - exp) / DAY_MS)) : null;
                  return (
                    <IpdResultRow
                      key={row.id}
                      row={row}
                      overdueDays={overdueDays}
                      daysPending={daysSince(row.created_at)}
                      busy={busyId === row.id}
                      acknowledgeDisabled={!practitionerId}
                      onAcknowledge={() => void acknowledge(row, "sla_pipeline")}
                      lostStyling={false}
                    />
                  );
                }}
              />
              <IpdPanelSection
                title="Lost"
                count={lost.length}
                tone="red"
                rows={lost}
                emptyHint="No orders more than 3 days past expected."
                renderRow={(row) => {
                  const exp = computeExpectedAtMs(row);
                  const overdueDays =
                    exp != null && Date.now() > exp ? Math.max(4, Math.ceil((Date.now() - exp) / DAY_MS)) : null;
                  return (
                    <IpdResultRow
                      key={row.id}
                      row={row}
                      overdueDays={overdueDays}
                      daysPending={daysSince(row.created_at)}
                      busy={busyId === row.id}
                      acknowledgeDisabled={!practitionerId}
                      onAcknowledge={() => void acknowledge(row, "sla_pipeline")}
                      lostStyling
                    />
                  );
                }}
              />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function IpdPanelSection({
  title,
  count,
  tone,
  rows,
  emptyHint,
  renderRow,
}: {
  title: string;
  count: number;
  tone: "emerald" | "amber" | "orange" | "red";
  rows: IpdPendingPanelOrder[];
  emptyHint: string;
  renderRow: (row: IpdPendingPanelOrder) => ReactNode;
}) {
  const badge =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-900"
      : tone === "amber"
        ? "bg-amber-100 text-amber-950"
        : tone === "orange"
          ? "bg-orange-100 text-orange-950"
          : "bg-red-100 text-red-900";
  return (
    <div>
      <div className="flex items-center gap-2 bg-slate-50/80 px-4 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
          {title}{" "}
          <span className={`ml-1 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge}`}>
            ({count})
          </span>
        </h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-xs italic text-slate-400">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-slate-100">{rows.map((row) => renderRow(row))}</ul>
      )}
    </div>
  );
}

function IpdResultRow({
  row,
  overdueDays,
  daysPending,
  busy,
  acknowledgeDisabled,
  onAcknowledge,
  lostStyling,
}: {
  row: IpdPendingPanelOrder;
  overdueDays: number | null;
  daysPending: number;
  busy: boolean;
  acknowledgeDisabled: boolean;
  onAcknowledge: () => void;
  lostStyling: boolean;
}) {
  const expectedMs = computeExpectedAtMs(row);
  const expectedLabel = expectedMs != null ? formatOrderedDate(new Date(expectedMs).toISOString()) : "—";

  return (
    <li
      className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        lostStyling ? "alert-banner-critical-pulse rounded-lg bg-red-50/90 ring-1 ring-inset ring-red-300" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{(row.test_name ?? "").trim() || "Investigation"}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
          <span>
            Ordered: <span className="font-medium text-slate-800">{formatOrderedDate(row.created_at)}</span>
          </span>
          <span>
            Expected: <span className="font-medium text-slate-800">{expectedLabel}</span>
          </span>
          <span>
            Days pending: <span className="font-medium text-slate-800">{daysPending}</span>
          </span>
          {overdueDays != null ? (
            <span className="font-semibold text-red-600">
              {overdueDays} day{overdueDays === 1 ? "" : "s"} overdue
            </span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        disabled={busy || acknowledgeDisabled}
        onClick={onAcknowledge}
        className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "…" : "Acknowledge"}
      </button>
    </li>
  );
}
