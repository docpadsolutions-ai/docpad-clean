"use client";

import { Calendar, FileText, ListPlus, MessageSquare, Microscope, Stethoscope, Upload } from "lucide-react";

export default function SummaryQuickActions({
  patientId,
  onNavigate,
}: {
  patientId: string;
  onNavigate?: (view: string, params?: Record<string, unknown>) => void;
}) {
  const pid = patientId?.trim() || "";

  const btnBase =
    "flex w-full cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left text-sm font-semibold text-gray-800 shadow-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

  const withPatient = (extra?: Record<string, unknown>) => {
    const o: Record<string, unknown> = { ...extra };
    if (pid) o.patientId = pid;
    return o;
  };

  const go = (view: string, params?: Record<string, unknown>) => {
    if (!onNavigate) return;
    onNavigate(view, withPatient(params));
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-slate-50/90 to-white p-3 shadow-sm">
      <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Quick actions</p>
      <nav className="flex flex-col gap-2">
        <button
          type="button"
          className={`${btnBase} hover:bg-blue-50`}
          disabled={!pid}
          onClick={() => go("current-encounter", { mode: "new" })}
        >
          <Stethoscope className="h-5 w-5 shrink-0 text-blue-600" strokeWidth={2} />
          <span>Start New OPD Encounter</span>
        </button>

        <button
          type="button"
          className={`${btnBase} hover:bg-green-50`}
          disabled={!pid}
          onClick={() => go("prescriptions")}
        >
          <FileText className="h-5 w-5 shrink-0 text-green-600" strokeWidth={2} />
          <span>View / Download Past Prescriptions</span>
        </button>

        <button
          type="button"
          className={`${btnBase} hover:bg-purple-50`}
          disabled={!pid}
          onClick={() => go("investigations", { mode: "order" })}
        >
          <Microscope className="h-5 w-5 shrink-0 text-purple-600" strokeWidth={2} />
          <span>Order Investigations</span>
        </button>

        <button
          type="button"
          className={`${btnBase} hover:bg-orange-50`}
          disabled={!pid}
          onClick={() => go("followup")}
        >
          <Calendar className="h-5 w-5 shrink-0 text-orange-600" strokeWidth={2} />
          <span>Schedule Follow-up</span>
        </button>

        <button
          type="button"
          className={`${btnBase} hover:bg-teal-50`}
          disabled={!pid}
          onClick={() => go("consults")}
        >
          <MessageSquare className="h-5 w-5 shrink-0 text-teal-600" strokeWidth={2} />
          <span>Request Consult</span>
        </button>

        <button
          type="button"
          className={`${btnBase} hover:bg-red-50`}
          disabled={!pid}
          onClick={() => go("add-problem")}
        >
          <ListPlus className="h-5 w-5 shrink-0 text-red-600" strokeWidth={2} />
          <span>Add to Problem List</span>
        </button>

        <button
          type="button"
          className={`${btnBase} hover:bg-gray-50`}
          disabled={!pid}
          onClick={() => go("upload")}
        >
          <Upload className="h-5 w-5 shrink-0 text-gray-600" strokeWidth={2} />
          <span>Upload Documents</span>
        </button>
      </nav>
    </div>
  );
}
