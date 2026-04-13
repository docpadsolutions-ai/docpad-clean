"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { formatRequestedAgo, rpcGetMyPendingConsults, rpcRespondToConsult } from "@/app/lib/ipdConsults";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type TabId = "pending" | "accepted";

function urgencyRank(u: string): number {
  const x = u.toLowerCase();
  if (x === "stat") return 0;
  if (x === "urgent") return 1;
  return 2;
}

function sortConsultRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const list = [...rows];
  list.sort((a, b) => {
    const du = urgencyRank(s(a.urgency)) - urgencyRank(s(b.urgency));
    if (du !== 0) return du;
    const ta = Date.parse(s(a.requested_at));
    const tb = Date.parse(s(b.requested_at));
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  });
  return list;
}

export default function ConsultInboxPage() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tab, setTab] = useState<TabId>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await rpcGetMyPendingConsults(supabase);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    setRows(data);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const pendingRows = useMemo(
    () => sortConsultRows(rows.filter((r) => s(r.status).toLowerCase() === "requested")),
    [rows],
  );
  const acceptedRows = useMemo(
    () => sortConsultRows(rows.filter((r) => s(r.status).toLowerCase() === "accepted")),
    [rows],
  );

  const displayed = tab === "pending" ? pendingRows : acceptedRows;
  const pendingCount = pendingRows.length;

  const setNote = (id: string, v: string) => {
    setResponseText((m) => ({ ...m, [id]: v }));
  };

  const accept = async (consultId: string) => {
    setBusyId(consultId);
    const { error } = await rpcRespondToConsult(supabase, {
      p_consult_id: consultId,
      p_status: "accepted",
      p_consult_notes: null,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Consult accepted");
    void load();
  };

  const submitResponse = async (consultId: string) => {
    const notes = s(responseText[consultId]);
    if (!notes) {
      toast.error("Enter consult notes before submitting.");
      return;
    }
    setBusyId(consultId);
    const { error } = await rpcRespondToConsult(supabase, {
      p_consult_id: consultId,
      p_status: "responded",
      p_consult_notes: notes,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Response submitted");
    setRespondingId(null);
    setResponseText((m) => {
      const next = { ...m };
      delete next[consultId];
      return next;
    });
    void load();
  };

  const lastUpdatedLabel =
    lastUpdated != null
      ? lastUpdated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "—";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 text-gray-900 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
              <Stethoscope className="h-7 w-7 shrink-0 text-violet-600" aria-hidden />
              Consult Inbox
              {pendingCount > 0 ? (
                <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {pendingCount}
                </span>
              ) : null}
            </h1>
          </div>
          <p className="text-xs text-gray-500">
            Last updated: <span className="font-medium text-gray-900">{lastUpdatedLabel}</span>
          </p>
        </div>

        <div className="flex gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab("pending")}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
              tab === "pending"
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-gray-500 hover:text-gray-900",
            )}
          >
            Pending
            {pendingCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-900">
                {pendingCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setTab("accepted")}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
              tab === "accepted"
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-gray-500 hover:text-gray-900",
            )}
          >
            Accepted
            {acceptedRows.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-900">
                {acceptedRows.length}
              </span>
            ) : null}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center shadow-sm">
            <CheckCircle className="h-12 w-12 text-emerald-500/80" aria-hidden />
            <p className="mt-3 text-sm font-medium text-gray-500">
              {tab === "pending" ? "No pending consults" : "No accepted consults"}
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {displayed.map((row) => {
              const id = s(row.id);
              const patientName = s(row.patient_name) || "Patient";
              const age = s(row.patient_age);
              const bed = s(row.bed_number);
              const ward = s(row.ward_name);
              const admId = s(row.admission_id);
              const urgency = s(row.urgency).toLowerCase();
              const status = s(row.status).toLowerCase();
              const reason = s(row.reason_for_consult);
              const requester = s(row.requesting_doctor_name);
              const reqAt = s(row.requested_at);
              const isPendingTab = tab === "pending";

              const cardUrgencyClass =
                urgency === "stat"
                  ? "border border-gray-200 border-l-4 border-l-red-500 bg-red-500/5"
                  : urgency === "urgent"
                    ? "border border-gray-200 border-l-4 border-l-orange-400 bg-orange-400/5"
                    : "border border-gray-200 bg-white shadow-sm";

              return (
                <li key={id} className={cn("rounded-2xl p-4 shadow-sm", cardUrgencyClass)}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-bold text-gray-900">
                      {patientName}
                      {age ? <span className="font-normal text-gray-500"> · {age}</span> : null}
                      {bed ? <span className="font-normal text-gray-500"> · {bed}</span> : null}
                      {ward ? <span className="font-normal text-gray-500"> · {ward}</span> : null}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {urgency === "stat" ? (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                          STAT
                        </span>
                      ) : urgency === "urgent" ? (
                        <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">Urgent</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-900">
                          Routine
                        </span>
                      )}
                      {status === "requested" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                          requested
                        </span>
                      ) : status === "accepted" ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-900">
                          accepted
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {requester ? (
                    <p className="mt-2 text-xs text-gray-500">From Dr. {requester}</p>
                  ) : null}
                  {reqAt ? (
                    <p className="mt-0.5 text-xs text-gray-500">{formatRequestedAgo(reqAt)}</p>
                  ) : null}

                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{reason || "—"}</p>

                  <hr className="my-4 border-gray-200" />

                  <div className="flex flex-wrap items-center gap-2">
                    {isPendingTab ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === id}
                          className="border-gray-200"
                          onClick={() => void accept(id)}
                        >
                          Accept
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="bg-violet-600 text-white hover:bg-violet-500"
                          variant={respondingId === id ? "secondary" : "default"}
                          onClick={() => setRespondingId((x) => (x === id ? null : id))}
                        >
                          Respond
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="bg-violet-600 text-white hover:bg-violet-500"
                        variant={respondingId === id ? "secondary" : "default"}
                        onClick={() => setRespondingId((x) => (x === id ? null : id))}
                      >
                        Respond
                      </Button>
                    )}
                    {admId ? (
                      <Link
                        href={`/ipd/admissions/${encodeURIComponent(admId)}`}
                        className="ml-auto text-sm font-medium text-sky-600 hover:text-sky-700"
                      >
                        View Patient →
                      </Link>
                    ) : null}
                  </div>

                  {respondingId === id ? (
                    <div className="mt-4 space-y-2 border-t border-gray-200 pt-4">
                      <Textarea
                        rows={4}
                        className="min-h-[96px] border-gray-200 bg-white"
                        placeholder="Enter your consult findings and recommendations..."
                        value={responseText[id] ?? ""}
                        onChange={(e) => setNote(id, e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRespondingId(null)}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-500"
                          disabled={busyId === id}
                          onClick={() => void submitResponse(id)}
                        >
                          Submit Response
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
