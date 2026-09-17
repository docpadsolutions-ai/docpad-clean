"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import ClinicalQueueRow, { displayToken } from "@/components/ClinicalQueueRow";
import { patientIdsWithSimilarNamePeer } from "@/lib/patientNameSimilarity";
import type { DraftEncounterRow, WaitingPatientRow } from "@/lib/clinicalQueue";
import { useClinicalCommandCenter } from "./useClinicalCommandCenter";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { KeyboardShortcutsHelp } from "@/components/ui/keyboard-shortcuts-help";

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

  const waitingSimilarIds = useMemo(
    () => patientIdsWithSimilarNamePeer(waiting.map((r) => ({ id: r.patientId, fullName: r.patientName }))),
    [waiting],
  );
  const draftsSimilarIds = useMemo(
    () => patientIdsWithSimilarNamePeer(drafts.map((r) => ({ id: r.patientId, fullName: r.patientName }))),
    [drafts],
  );

  const [queueFilter, setQueueFilter] = useState("");
  const queueSearchRef = useRef<HTMLInputElement>(null);

  const filteredWaiting = useMemo(() => {
    const q = queueFilter.trim().toLowerCase();
    if (!q) return waiting;
    return waiting.filter((r) => {
      const blob = [r.patientName, r.primaryDisplay, r.chiefComplaint ?? "", r.docpadId ?? ""]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [waiting, queueFilter]);

  const filteredDrafts = useMemo(() => {
    const q = queueFilter.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((r) => {
      const blob = [r.patientName, r.chiefComplaint ?? "", r.encounterToken ?? ""].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [drafts, queueFilter]);

  const displayRows: readonly (WaitingPatientRow | DraftEncounterRow)[] = showWaiting
    ? filteredWaiting
    : filteredDrafts;
  const filteredOut =
    !empty && displayRows.length === 0 && Boolean(queueFilter.trim());

  const queueKb = useKeyboardNav(displayRows, (row, _index) => {
    if (showWaiting) void onWaitingRowClick(row as WaitingPatientRow);
    else onDraftRowClick(row as DraftEncounterRow);
  }, {
    searchInputRef: queueSearchRef,
    onClearSelection: () => {
      setQueueFilter("");
    },
    enabled: !loading && displayRows.length > 0,
  });

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
        <div className="flex flex-wrap items-center gap-2">
          <TabButton active={showWaiting} onClick={setWaitingTab} count={waiting.length}>
            Waiting room
          </TabButton>
          <TabButton active={!showWaiting} onClick={setDraftsTab} count={drafts.length}>
            Returning / drafts
          </TabButton>
          <div className="ml-auto flex min-w-[min(100%,14rem)] max-w-sm flex-1 items-center gap-2 sm:min-w-[12rem]">
            <label htmlFor="ccc-queue-filter" className="sr-only">
              Filter patients
            </label>
            <input
              id="ccc-queue-filter"
              ref={queueSearchRef}
              type="search"
              value={queueFilter}
              onChange={(e) => setQueueFilter(e.target.value)}
              placeholder="Filter…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              autoComplete="off"
            />
            <KeyboardShortcutsHelp
              entries={[
                { keys: "↑ / ↓", label: "Move highlight" },
                { keys: "Enter", label: "Open selected patient" },
                { keys: "Esc", label: "Clear highlight & filter" },
                { keys: "/", label: "Focus filter" },
              ]}
            />
          </div>
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
      ) : filteredOut ? (
        <div className="px-6 py-12 text-center text-sm text-slate-600">No rows match your filter.</div>
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
          <table
            role="grid"
            aria-label={showWaiting ? "Waiting room patients" : "Returning and draft charts"}
            aria-rowcount={displayRows.length}
            className="w-full min-w-[900px] text-left text-sm"
          >
            <thead role="rowgroup">
              <tr role="row" className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th role="columnheader" className="whitespace-nowrap px-5 py-3 lg:px-6">
                  Token
                </th>
                <th role="columnheader" className="min-w-[160px] px-3 py-3">
                  Patient
                </th>
                <th role="columnheader" className="min-w-[200px] px-3 py-3">
                  Vitals
                </th>
                <th role="columnheader" className="min-w-[200px] px-3 py-3">
                  Chief complaint
                </th>
                <th role="columnheader" className="whitespace-nowrap px-3 py-3">
                  Status
                </th>
                <th role="columnheader" className="whitespace-nowrap px-5 py-3 text-right lg:px-6">
                  {" "}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-slate-100">
              {showWaiting
                ? filteredWaiting.map((row, rowIndex) => {
                    const meta =
                      row.docpadId?.trim() && row.ageGender?.trim()
                        ? `${row.ageGender} · ${row.docpadId.trim()}`
                        : row.docpadId?.trim() || row.ageGender || "—";
                    return (
                      <ClinicalQueueRow
                        ref={queueKb.assignRowRef(rowIndex)}
                        key={row.rowKey}
                        patientId={row.patientId}
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
                        hasSimilarName={waitingSimilarIds.has(row.patientId)}
                        keyboardSelected={queueKb.isRowSelected(rowIndex)}
                      />
                    );
                  })
                : filteredDrafts.map((row, rowIndex) => {
                    const { label, badgeClass } = draftStatusMeta(row.status);
                    return (
                      <ClinicalQueueRow
                        ref={queueKb.assignRowRef(rowIndex)}
                        key={row.encounterId}
                        patientId={row.patientId}
                        primaryColumn={displayToken(row.encounterToken)}
                        patientName={row.patientName}
                        patientMeta={row.ageGender}
                        vitals={row.vitals}
                        chiefComplaint={row.chiefComplaint}
                        statusLabel={label}
                        statusBadgeClassName={badgeClass}
                        actionLabel="Open file"
                        onClick={() => onDraftRowClick(row)}
                        hasSimilarName={draftsSimilarIds.has(row.patientId)}
                        keyboardSelected={queueKb.isRowSelected(rowIndex)}
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
