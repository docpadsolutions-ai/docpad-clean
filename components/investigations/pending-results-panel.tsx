"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNow } from "@/hooks/useNow";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAuthOrgId } from "@/lib/authOrg";
import { useToast } from "@/components/ui/toast-provider";
import { formatOrderedDate } from "@/lib/investigationsUi";

const DAY_MS = 86400000;

/** Workflow states still awaiting a lab result (aligned with lab queue + forward-compatible). */
const PIPELINE_STATUSES = new Set(["ordered", "sample_collected", "processing", "collected"]);

export type PendingPanelInvestigation = {
  id: string;
  patient_id: string;
  hospital_id: string | null;
  test_name: string | null;
  status: string | null;
  result_status: string | null;
  ordered_at: string | null;
  expected_at: string | null;
  expected_tat_hours: number | string | null;
  resulted_at: string | null;
  reviewed_at: string | null;
  sla_acknowledged_at: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function isPipelineStatus(status: string | null | undefined): boolean {
  return PIPELINE_STATUSES.has(norm(status));
}

function isReadyForReview(inv: PendingPanelInvestigation): boolean {
  const rs = norm(inv.result_status);
  const hasReviewed = inv.reviewed_at != null && String(inv.reviewed_at).trim() !== "";
  if (hasReviewed) return false;
  return rs === "resulted" || rs === "ready";
}

function computeExpectedAtMs(inv: PendingPanelInvestigation): number | null {
  const raw = inv.expected_at;
  if (raw) {
    const t = Date.parse(String(raw));
    if (Number.isFinite(t)) return t;
  }
  const o = Date.parse(String(inv.ordered_at ?? ""));
  if (!Number.isFinite(o)) return null;
  const tat = inv.expected_tat_hours;
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

function classifyPipeline(inv: PendingPanelInvestigation): PipelineBucket | null {
  if (inv.reviewed_at && String(inv.reviewed_at).trim() !== "") return null;
  if (!isPipelineStatus(inv.status)) return null;
  if (inv.sla_acknowledged_at) return null;
  const rs = norm(inv.result_status);
  if (rs === "resulted" || rs === "ready" || rs === "reviewed") return null;
  if (inv.resulted_at && String(inv.resulted_at).trim() !== "") return null;

  const expectedMs = computeExpectedAtMs(inv);
  if (expectedMs == null) return "pending";

  const now = Date.now();
  const msPastDue = now - expectedMs;
  if (msPastDue <= 0) return "pending";
  if (msPastDue > 3 * DAY_MS) return "lost";
  return "late";
}

const SELECT =
  "id, patient_id, hospital_id, test_name, status, result_status, ordered_at, expected_at, expected_tat_hours, resulted_at, reviewed_at, sla_acknowledged_at";

export default function PendingResultsPanel({
  patientId,
  encounterId,
  hospitalId: hospitalIdProp,
  practitionerId,
  onRefresh,
  defaultOpen = true,
}: {
  patientId: string;
  encounterId?: string | null;
  /** When omitted, resolved from encounter or `auth_org()`. */
  hospitalId?: string | null;
  practitionerId: string | null;
  onRefresh?: () => void;
  /** Panel is always mounted; this only controls expanded vs collapsed. */
  defaultOpen?: boolean;
}) {
  // A minute is the right granularity: these rows are labelled in days.
  const now = useNow(60_000);
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [resolvedHospitalId, setResolvedHospitalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PendingPanelInvestigation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const lostToastShown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let h = (hospitalIdProp ?? "").trim();
      if (!h && encounterId?.trim()) {
        const { data: encH } = await supabase
          .from("opd_encounters")
          .select("hospital_id")
          .eq("id", encounterId.trim())
          .maybeSingle();
        const raw =
          encH && typeof encH === "object" && "hospital_id" in encH
            ? (encH as { hospital_id?: unknown }).hospital_id
            : null;
        if (raw != null && String(raw).trim() !== "") h = String(raw).trim();
      }
      if (!h) {
        const { orgId } = await fetchAuthOrgId();
        h = orgId?.trim() ?? "";
      }
      if (!cancelled) setResolvedHospitalId(h || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [hospitalIdProp, encounterId]);

  const load = useCallback(async () => {
    const pid = patientId?.trim();
    const hid = resolvedHospitalId?.trim();
    setLoading(true);
    if (!pid || !hid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setError(null);
    const { data, error: fetchErr } = await supabase
      .from("investigations")
      .select(SELECT)
      .eq("patient_id", pid)
      .eq("hospital_id", hid)
      .order("ordered_at", { ascending: false });
    if (fetchErr) {
      setError(fetchErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as PendingPanelInvestigation[]);
    }
    setLoading(false);
  }, [patientId, resolvedHospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { toReview, pending, late, lost } = useMemo(() => {
    const toReview: PendingPanelInvestigation[] = [];
    const pendingL: PendingPanelInvestigation[] = [];
    const lateL: PendingPanelInvestigation[] = [];
    const lostL: PendingPanelInvestigation[] = [];

    for (const inv of rows) {
      if (isReadyForReview(inv)) {
        toReview.push(inv);
        continue;
      }
      const b = classifyPipeline(inv);
      if (b === "pending") pendingL.push(inv);
      else if (b === "late") lateL.push(inv);
      else if (b === "lost") lostL.push(inv);
    }
    return { toReview, pending: pendingL, late: lateL, lost: lostL };
  }, [rows]);

  useEffect(() => {
    if (loading || lostToastShown.current || lost.length === 0) return;
    lostToastShown.current = true;
    toast.critical({
      title: "Investigations may be lost",
      body: `${lost.length} test order(s) are more than 3 days past the expected result time. Review the Lost section.`,
    });
  }, [loading, lost, toast]);

  const acknowledge = useCallback(
    async (inv: PendingPanelInvestigation, kind: "result_review" | "sla_pipeline") => {
      if (!practitionerId?.trim()) {
        setError("Sign in as a practitioner to acknowledge.");
        return;
      }
      if (!patientId?.trim()) return;

      setBusyId(inv.id);
      setError(null);

      const { error: rpcErr } = await supabase.rpc("acknowledge_investigation", {
        p_investigation_id: inv.id,
        p_notes: null,
        p_reason: kind,
        p_action_taken: null,
      });
      if (rpcErr) {
        setError(rpcErr.message);
        setBusyId(null);
        return;
      }

      setBusyId(null);
      await load();
      onRefresh?.();
    },
    [practitionerId, patientId, load, onRefresh],
  );

  const totalShown = toReview.length + pending.length + late.length + lost.length;
  if (!patientId.trim()) return null;

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
          <p className="text-sm font-bold text-slate-900">Pending results &amp; reviews</p>
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
              <PanelSection
                title="Results to Review"
                count={toReview.length}
                tone="emerald"
                rows={toReview}
                emptyHint="No new results awaiting sign-off."
                renderRow={(inv) => (
                  <ResultRow
                    key={inv.id}
                    inv={inv}
                    overdueDays={null}
                    daysPending={daysSince(inv.ordered_at)}
                    busy={busyId === inv.id}
                    acknowledgeDisabled={!practitionerId}
                    onAcknowledge={() => void acknowledge(inv, "result_review")}
                    lostStyling={false}
                  />
                )}
              />
              <PanelSection
                title="Pending"
                count={pending.length}
                tone="amber"
                rows={pending}
                emptyHint="No on-time orders awaiting results."
                renderRow={(inv) => (
                  <ResultRow
                    key={inv.id}
                    inv={inv}
                    overdueDays={null}
                    daysPending={daysSince(inv.ordered_at)}
                    busy={busyId === inv.id}
                    acknowledgeDisabled={!practitionerId}
                    onAcknowledge={() => void acknowledge(inv, "sla_pipeline")}
                    lostStyling={false}
                  />
                )}
              />
              <PanelSection
                title="Late"
                count={late.length}
                tone="orange"
                rows={late}
                emptyHint="No orders past expected time (within 3 days)."
                renderRow={(inv) => {
                  const exp = computeExpectedAtMs(inv);
                  const overdueDays =
                    exp != null && now > exp ? Math.max(1, Math.ceil((now - exp) / DAY_MS)) : null;
                  return (
                    <ResultRow
                      key={inv.id}
                      inv={inv}
                      overdueDays={overdueDays}
                      daysPending={daysSince(inv.ordered_at)}
                      busy={busyId === inv.id}
                      acknowledgeDisabled={!practitionerId}
                      onAcknowledge={() => void acknowledge(inv, "sla_pipeline")}
                      lostStyling={false}
                    />
                  );
                }}
              />
              <PanelSection
                title="Lost"
                count={lost.length}
                tone="red"
                rows={lost}
                emptyHint="No orders more than 3 days past expected."
                renderRow={(inv) => {
                  const exp = computeExpectedAtMs(inv);
                  const overdueDays =
                    exp != null && now > exp ? Math.max(4, Math.ceil((now - exp) / DAY_MS)) : null;
                  return (
                    <ResultRow
                      key={inv.id}
                      inv={inv}
                      overdueDays={overdueDays}
                      daysPending={daysSince(inv.ordered_at)}
                      busy={busyId === inv.id}
                      acknowledgeDisabled={!practitionerId}
                      onAcknowledge={() => void acknowledge(inv, "sla_pipeline")}
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

function PanelSection({
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
  rows: PendingPanelInvestigation[];
  emptyHint: string;
  renderRow: (inv: PendingPanelInvestigation) => ReactNode;
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
        <ul className="divide-y divide-slate-100">{rows.map((inv) => renderRow(inv))}</ul>
      )}
    </div>
  );
}

function ResultRow({
  inv,
  overdueDays,
  daysPending,
  busy,
  acknowledgeDisabled,
  onAcknowledge,
  lostStyling,
}: {
  inv: PendingPanelInvestigation;
  overdueDays: number | null;
  daysPending: number;
  busy: boolean;
  acknowledgeDisabled: boolean;
  onAcknowledge: () => void;
  lostStyling: boolean;
}) {
  const expectedMs = computeExpectedAtMs(inv);
  const expectedLabel = expectedMs != null ? formatOrderedDate(new Date(expectedMs).toISOString()) : "—";

  return (
    <li
      className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        lostStyling ? "alert-banner-critical-pulse rounded-lg bg-red-50/90 ring-1 ring-inset ring-red-300" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{(inv.test_name ?? "").trim() || "Investigation"}</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
          <span>
            Ordered: <span className="font-medium text-slate-800">{formatOrderedDate(inv.ordered_at)}</span>
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
