"use client";

/**
 * DocPad Reception — `/reception` (`app/(dashboard)/reception/page.tsx`).
 * Reads: `reception_today_queue` (no client-side status filter); writes: `reception_queue`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import NewPatientModal from "../../components/NewPatientModal";
import { fetchHospitalIdFromPractitionerAuthId } from "../../lib/authOrg";
import { fetchDoctorAssignmentOptions } from "../../lib/doctorAssignmentOptions";
import { enqueueReceptionWalkIn } from "../../lib/receptionEnqueue";
import type { RegisteredPatientRow } from "../../lib/registerNewPatient";
import { supabase } from "../../supabase";

type ReceptionTodayQueueRow = {
  id: string;
  hospital_id: string | null;
  token_display: string | null;
  token_number: number | null;
  queue_status: string;
  assigned_room: string | null;
  patient_name: string | null;
  docpad_id: string | null;
  phone: string | null;
  age_years: number | null;
  sex: string | null;
  doctor_name: string | null;
  doctor_specialty: string | null;
  billing_status: string | null;
  bill_amount: number | string | null;
  payment_method: string | null;
  registered_at: string | null;
  billed_at: string | null;
  triaged_at: string | null;
  called_at: string | null;
  completed_at: string | null;
  no_show_marked_at: string | null;
  created_at: string;
  updated_at: string;
  waiting_minutes: number | null;
  triage_bp: string | null;
  triage_pulse: string | null;
  triage_temp: string | null;
  triage_spo2: string | null;
  triage_weight: string | null;
};

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const labelCls = "mb-1 block text-xs font-medium text-gray-700";

const btnPrimary =
  "inline-flex items-center justify-center rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40";

const btnSecondary =
  "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:opacity-40";

const btnGhost =
  "inline-flex items-center justify-center rounded-xl border border-transparent px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-40";

const btnDanger =
  "inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 transition hover:bg-rose-100 disabled:opacity-40";

function todayLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "registered":
      return "bg-slate-100 text-slate-800 ring-slate-200";
    case "triaged":
      return "bg-violet-50 text-violet-900 ring-violet-200";
    case "waiting":
      return "bg-amber-50 text-amber-900 ring-amber-200";
    case "with_doctor":
      return "bg-emerald-50 text-emerald-900 ring-emerald-200";
    case "completed":
      return "bg-gray-100 text-gray-700 ring-gray-200";
    case "no_show":
      return "bg-red-50 text-red-900 ring-red-200";
    default:
      return "bg-gray-50 text-gray-700 ring-gray-200";
  }
}

function formatMoney(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return "—";
  return `₹${n.toFixed(0)}`;
}

/** Minutes in queue for display; terminal statuses show em dash. */
function formatWaitingMinutesDisplay(status: string, row: ReceptionTodayQueueRow): string {
  if (status === "completed" || status === "no_show") return "—";
  let n: number | null = null;
  if (row.waiting_minutes != null) {
    const parsed = typeof row.waiting_minutes === "number" ? row.waiting_minutes : parseFloat(String(row.waiting_minutes));
    if (!Number.isNaN(parsed)) n = parsed;
  }
  if (n == null && row.registered_at) {
    const start = new Date(row.registered_at).getTime();
    const end = row.called_at ? new Date(row.called_at).getTime() : Date.now();
    const mins = (end - start) / 60000;
    if (Number.isFinite(mins)) n = mins;
  }
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}m`;
}

function StatsSkeleton() {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-gray-100 bg-white p-4">
          <div className="h-3 w-20 rounded bg-gray-200" />
          <div className="mt-3 h-8 w-12 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-xl bg-gray-100 py-3">
          <div className="h-4 w-12 rounded bg-gray-200" />
          <div className="h-4 flex-1 rounded bg-gray-200" />
          <div className="h-4 w-24 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

export default function ReceptionPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [queue, setQueue] = useState<ReceptionTodayQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [newPatientModalOpen, setNewPatientModalOpen] = useState(false);
  const [pendingQueuePatient, setPendingQueuePatient] = useState<RegisteredPatientRow | null>(null);
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [enrollDoctorId, setEnrollDoctorId] = useState("");
  const [practitioners, setPractitioners] = useState<{ id: string; full_name: string | null }[]>([]);
  const [practitionersLoading, setPractitionersLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const loadQueue = useCallback(async (hid: string | null, opts?: { silent?: boolean }) => {
    if (!hid) {
      setQueue([]);
      setLoading(false);
      return;
    }
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setFetchError(null);
    }
    // View applies hospital + "today" in SQL; do not filter queue_status here (all statuses).
    const { data, error } = await supabase
      .from("reception_today_queue")
      .select("*")
      .eq("hospital_id", hid)
      .order("token_number", { ascending: true, nullsFirst: false });
    if (error) {
      if (!silent) {
        setFetchError(error.message);
        setQueue([]);
      }
    } else {
      setQueue((data ?? []) as ReceptionTodayQueueRow[]);
      if (!silent) setFetchError(null);
    }
    if (!silent) setLoading(false);
  }, []);

  const loadPractitioners = useCallback(async (hid: string | null) => {
    if (!hid) {
      setPractitioners([]);
      return;
    }
    setPractitionersLoading(true);
    const { options, error } = await fetchDoctorAssignmentOptions(supabase, hid);
    if (!error) setPractitioners(options);
    else setPractitioners([]);
    setPractitionersLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { hospitalId: hid, error } = await fetchHospitalIdFromPractitionerAuthId();
      if (cancelled) return;
      if (error) setOrgError(error.message);
      setHospitalId(hid);
      await loadQueue(hid);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadQueue]);

  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("reception-queue-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reception_queue", filter: `hospital_id=eq.${hospitalId}` },
        () => {
          void loadQueue(hospitalId, { silent: true });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hospitalId, loadQueue]);

  useEffect(() => {
    if (!queueDrawerOpen || !hospitalId) return;
    void loadPractitioners(hospitalId);
  }, [queueDrawerOpen, hospitalId, loadPractitioners]);

  const stats = useMemo(() => {
    const total = queue.length;
    const waiting = queue.filter((r) => ["registered", "triaged"].includes(r.queue_status)).length;
    const withDoc = queue.filter((r) => r.queue_status === "with_doctor").length;
    const completed = queue.filter((r) => r.queue_status === "completed").length;
    const noShow = queue.filter((r) => r.queue_status === "no_show").length;
    return { total, waiting, withDoc, completed, noShow };
  }, [queue]);

  async function nextTokenNumber(hid: string, queueDate: string): Promise<number> {
    const { data, error } = await supabase
      .from("reception_queue")
      .select("token_number")
      .eq("hospital_id", hid)
      .eq("queue_date", queueDate)
      .order("token_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const max = data?.token_number;
    if (max == null || typeof max !== "number") return 1;
    return max + 1;
  }

  async function updateQueueRow(id: string, patch: Record<string, unknown>) {
    setUpdatingId(id);
    const { error } = await supabase
      .from("reception_queue")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    setUpdatingId(null);
    if (error) {
      showToast(error.message);
      return;
    }
    void loadQueue(hospitalId, { silent: true });
  }

  function callNext(row: ReceptionTodayQueueRow) {
    const now = new Date().toISOString();
    void updateQueueRow(row.id, { queue_status: "with_doctor", called_at: now });
  }

  function completeVisit(row: ReceptionTodayQueueRow) {
    const now = new Date().toISOString();
    void updateQueueRow(row.id, { queue_status: "completed", completed_at: now });
  }

  function markNoShow(row: ReceptionTodayQueueRow) {
    const now = new Date().toISOString();
    void updateQueueRow(row.id, { queue_status: "no_show", no_show_marked_at: now });
  }

  function onNewPatientRegistered(patient: RegisteredPatientRow) {
    setPendingQueuePatient(patient);
    setEnrollDoctorId("");
    setEnrollError(null);
    setQueueDrawerOpen(true);
  }

  async function submitAddToQueue(e: React.FormEvent) {
    e.preventDefault();
    setEnrollError(null);
    if (!hospitalId || !pendingQueuePatient) {
      setEnrollError("Missing hospital or patient.");
      return;
    }
    if (!enrollDoctorId) {
      setEnrollError("Select an assigned doctor.");
      return;
    }
    setEnrolling(true);
    try {
      const qd = todayLocalDateString();
      const tokenNum = await nextTokenNumber(hospitalId, qd);
      const enq = await enqueueReceptionWalkIn({
        hospitalId,
        patientId: pendingQueuePatient.id,
        doctorPractitionerId: enrollDoctorId,
        queueDateYmd: qd,
        tokenNumber: tokenNum,
      });
      if (!enq.ok) throw new Error(enq.error);
      setQueueDrawerOpen(false);
      setPendingQueuePatient(null);
      setEnrollDoctorId("");
      showToast(`Patient added to queue (${enq.tokenDisplay}).`);
      void loadQueue(hospitalId, { silent: true });
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : "Could not add to queue.");
    } finally {
      setEnrolling(false);
    }
  }

  function queueRowActions(s: string): { callNext: boolean; complete: boolean; noShow: boolean } {
    if (s === "completed" || s === "no_show") {
      return { callNext: false, complete: false, noShow: false };
    }
    if (s === "with_doctor" || s === "waiting") {
      return { callNext: false, complete: true, noShow: true };
    }
    if (s === "registered" || s === "triaged") {
      return { callNext: true, complete: true, noShow: true };
    }
    return { callNext: false, complete: true, noShow: true };
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Reception</h1>
            <p className="mt-1 text-sm text-gray-600">Today&apos;s OPD queue and check-in.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => setNewPatientModalOpen(true)}>
              + New patient
            </button>
            <button type="button" className={btnSecondary} onClick={() => showToast("Coming soon")}>
              Lab billing
            </button>
          </div>
        </header>

        {orgError ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {orgError}
          </div>
        ) : null}

        {loading && queue.length === 0 && !fetchError ? (
          <StatsSkeleton />
        ) : (
          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                ["Total today", stats.total],
                ["Waiting", stats.waiting],
                ["With doctor", stats.withDoc],
                ["Completed", stats.completed],
                ["No-show", stats.noShow],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{n}</p>
              </div>
            ))}
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Today&apos;s queue</h2>
            <p className="text-xs text-gray-500">Updates live from the queue.</p>
          </div>

          {fetchError ? (
            <div className="px-4 py-10 text-center text-sm text-red-600">{fetchError}</div>
          ) : loading && queue.length === 0 ? (
            <TableSkeleton />
          ) : queue.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-500">No entries in the queue today.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/90 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2.5">Token</th>
                    <th className="px-3 py-2.5">Patient</th>
                    <th className="px-3 py-2.5">Doctor</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Waiting</th>
                    <th className="px-3 py-2.5">Bill</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {queue.map((row) => {
                    const busy = updatingId === row.id;
                    const actions = queueRowActions(row.queue_status);
                    const tokenLabel = row.token_display?.trim() || (row.token_number != null ? String(row.token_number) : "—");
                    return (
                      <tr key={row.id} className="hover:bg-gray-50/80">
                        <td className="px-3 py-3 font-mono font-semibold text-gray-900">{tokenLabel}</td>
                        <td className="px-3 py-3 text-gray-800">
                          <div className="font-medium">{row.patient_name?.trim() || "—"}</div>
                          <div className="text-xs text-gray-500">{row.docpad_id?.trim() || "—"}</div>
                        </td>
                        <td className="px-3 py-3 text-gray-700">
                          <div>{row.doctor_name?.trim() || "—"}</div>
                          {row.doctor_specialty?.trim() ? (
                            <div className="text-xs text-gray-500">{row.doctor_specialty}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusBadgeClass(row.queue_status)}`}
                          >
                            {row.queue_status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-gray-600">
                          {formatWaitingMinutesDisplay(row.queue_status, row)}
                        </td>
                        <td className="px-3 py-3 text-gray-700">
                          <div>{formatMoney(row.bill_amount)}</div>
                          <div className="text-xs text-gray-500">{row.billing_status?.trim() || "—"}</div>
                          {row.payment_method?.trim() ? (
                            <div className="text-xs text-gray-400">{row.payment_method}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {actions.callNext || actions.complete || actions.noShow ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              {actions.callNext ? (
                                <button
                                  type="button"
                                  className={btnGhost}
                                  disabled={busy}
                                  onClick={() => callNext(row)}
                                >
                                  Call Next
                                </button>
                              ) : null}
                              {actions.complete ? (
                                <button
                                  type="button"
                                  className={btnSecondary}
                                  disabled={busy}
                                  onClick={() => completeVisit(row)}
                                >
                                  Complete
                                </button>
                              ) : null}
                              {actions.noShow ? (
                                <button
                                  type="button"
                                  className={btnDanger}
                                  disabled={busy}
                                  onClick={() => markNoShow(row)}
                                >
                                  No Show
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <NewPatientModal
        open={newPatientModalOpen}
        onClose={() => setNewPatientModalOpen(false)}
        orgId={hospitalId}
        onSuccess={onNewPatientRegistered}
      />

      {queueDrawerOpen && pendingQueuePatient ? (
        <div className="fixed inset-0 z-[110] flex justify-end" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => {
              setQueueDrawerOpen(false);
              setPendingQueuePatient(null);
            }}
          />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">Add to queue</h2>
              <button
                type="button"
                onClick={() => {
                  setQueueDrawerOpen(false);
                  setPendingQueuePatient(null);
                }}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4" onSubmit={submitAddToQueue}>
              <p className="mb-3 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{pendingQueuePatient.full_name}</span>
                <span className="text-gray-500"> · {pendingQueuePatient.docpad_id}</span>
              </p>
              {enrollError ? (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {enrollError}
                </p>
              ) : null}
              <div>
                <label className={labelCls}>Assigned doctor</label>
                <select
                  className={inputCls}
                  value={enrollDoctorId}
                  onChange={(e) => setEnrollDoctorId(e.target.value)}
                  required
                  disabled={practitionersLoading}
                >
                  <option value="">{practitionersLoading ? "Loading…" : "Select doctor"}</option>
                  {practitioners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-auto flex gap-2 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className={`${btnSecondary} flex-1`}
                  onClick={() => {
                    setQueueDrawerOpen(false);
                    setPendingQueuePatient(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className={`${btnPrimary} flex-1`} disabled={enrolling}>
                  {enrolling ? "Saving…" : "Add to queue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
