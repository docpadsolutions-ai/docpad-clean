"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import ClinicalQueueRow, { displayToken } from "../../components/ClinicalQueueRow";
import type { DraftEncounterRow } from "../../lib/clinicalQueue";
import { useClinicalCommandCenter } from "./useClinicalCommandCenter";

const WAITING_BADGE = "bg-amber-50 text-amber-700 ring-amber-200";

const SOURCE_RECEPTION_BADGE = "bg-blue-50 text-blue-800 ring-blue-200/80";
const SOURCE_DIRECT_BADGE = "bg-slate-100 text-slate-600 ring-slate-200";

function draftStatusMeta(status: DraftEncounterRow["status"]): { label: string; badgeClass: string } {
  if (status === "draft") {
    return { label: "Draft", badgeClass: "bg-slate-50 text-slate-700 ring-slate-200" };
  }
  return { label: "In progress", badgeClass: "bg-violet-50 text-violet-700 ring-violet-200" };
}

function TabButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-blue-600 text-white shadow-sm"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
      <span
        className={`ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs font-bold ${
          active ? "bg-white/20 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export default function ClinicalCommandCenterQueue() {
  const {
    tab,
    setTab,
    waiting,
    drafts,
    loading,
    fetchError,
    startingRowKey,
    onWaitingRowClick,
    onDraftRowClick,
  } = useClinicalCommandCenter();

  const setWaitingTab = () => setTab("waiting");
  const setDraftsTab = () => setTab("drafts");

  const showWaiting = tab === "waiting";
  const rowsWaiting = waiting.length === 0;
  const rowsDrafts = drafts.length === 0;
  const empty = showWaiting ? rowsWaiting : rowsDrafts;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Clinical Command Center</h2>
            <p className="text-xs text-slate-500">Waiting room and returning charts</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/opd/new"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              + New OPD Patient
            </Link>
            <Link href="#" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
              View all &gt;
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TabButton active={showWaiting} onClick={setWaitingTab} count={waiting.length}>
            Waiting room
          </TabButton>
          <TabButton active={!showWaiting} onClick={setDraftsTab} count={drafts.length}>
            Returning / drafts
          </TabButton>
        </div>
      </div>

      {fetchError ? (
        <div className="px-6 py-8 text-center">
          <p className="text-sm font-medium text-red-700">Could not load queue</p>
          <p className="mt-1 text-xs text-red-600/90">{fetchError}</p>
          <p className="mt-3 text-xs text-slate-500">
            Check Supabase RLS and embed names (
            <code className="rounded bg-slate-100 px-1">reception_queue</code>,{" "}
            <code className="rounded bg-slate-100 px-1">opd_encounters</code>,{" "}
            <code className="rounded bg-slate-100 px-1">patients</code>).
          </p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : empty ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
            <svg
              className="h-7 w-7 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-800">
            {showWaiting ? "No patients in the waiting room" : "No draft or in-progress charts"}
          </p>
          <p className="mt-1 max-w-sm mx-auto text-sm text-slate-500">
            {showWaiting
              ? "Patients appear when reception sends them to your room or when you have a scheduled visit for today."
              : "Open encounters stay here until they are completed or cleared from draft."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-5 py-3 lg:px-6">Token</th>
                <th className="min-w-[160px] px-3 py-3">Patient</th>
                <th className="min-w-[200px] px-3 py-3">Vitals</th>
                <th className="min-w-[200px] px-3 py-3">Chief complaint</th>
                <th className="whitespace-nowrap px-3 py-3">Status</th>
                <th className="whitespace-nowrap px-5 py-3 text-right lg:px-6"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {showWaiting
                ? waiting.map((row) => {
                    const meta =
                      row.docpadId?.trim() && row.ageGender?.trim()
                        ? `${row.ageGender} · ${row.docpadId.trim()}`
                        : row.docpadId?.trim() || row.ageGender || "—";
                    return (
                      <ClinicalQueueRow
                        key={row.rowKey}
                        primaryColumn={row.primaryDisplay}
                        patientName={row.patientName}
                        patientMeta={meta}
                        vitals={row.vitals}
                        chiefComplaint={row.chiefComplaint}
                        statusLabel="Waiting"
                        statusBadgeClassName={WAITING_BADGE}
                        sourceBadge={
                          row.source === "reception"
                            ? { label: "Reception", className: SOURCE_RECEPTION_BADGE }
                            : { label: "Direct", className: SOURCE_DIRECT_BADGE }
                        }
                        actionLabel="Start chart"
                        onClick={() => void onWaitingRowClick(row)}
                        disabled={startingRowKey === row.rowKey}
                      />
                    );
                  })
                : drafts.map((row) => {
                    const { label, badgeClass } = draftStatusMeta(row.status);
                    return (
                      <ClinicalQueueRow
                        key={row.encounterId}
                        primaryColumn={displayToken(row.encounterToken)}
                        patientName={row.patientName}
                        patientMeta={row.ageGender}
                        vitals={row.vitals}
                        chiefComplaint={row.chiefComplaint}
                        statusLabel={label}
                        statusBadgeClassName={badgeClass}
                        actionLabel="Open file"
                        onClick={() => onDraftRowClick(row)}
                      />
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
