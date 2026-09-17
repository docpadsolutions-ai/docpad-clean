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
    "flex w-full cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left shadow-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

  const withPatient = (extra?: Record<string, unknown>) => {
    const o: Record<string, unknown> = { ...extra };
    if (pid) o.patientId = pid;
    return o;
  };

  const go = (view: string, params?: Record<string, unknown>) => {
    if (!onNavigate) return;
    onNavigate(view, withPatient(params));
  };

  const Item = ({
    icon: Icon,
    iconClass,
    title,
    sub,
    hover,
    onClick,
  }: {
    icon: typeof Stethoscope;
    iconClass: string;
    title: string;
    sub: string;
    hover: string;
    onClick: () => void;
  }) => (
    <button type="button" className={`${btnBase} ${hover}`} disabled={!pid} onClick={onClick}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} strokeWidth={2} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="mt-0.5 block text-[11px] font-normal leading-snug text-gray-500">{sub}</span>
      </span>
    </button>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-slate-50/90 to-white p-3 shadow-sm">
      <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Quick Actions</p>
      <nav className="flex flex-col gap-2">
        <Item
          icon={Stethoscope}
          iconClass="text-blue-600"
          title="Start New OPD Encounter"
          sub="Begin a new consultation"
          hover="hover:bg-blue-50"
          onClick={() => go("current-encounter", { mode: "new" })}
        />
        <Item
          icon={FileText}
          iconClass="text-green-600"
          title="View/Download Past Prescriptions"
          sub="Access prescription history"
          hover="hover:bg-green-50"
          onClick={() => go("prescriptions")}
        />
        <Item
          icon={Microscope}
          iconClass="text-purple-600"
          title="Order Investigations"
          sub="Request lab tests or imaging"
          hover="hover:bg-purple-50"
          onClick={() => go("investigations", { mode: "order" })}
        />
        <Item
          icon={Calendar}
          iconClass="text-orange-600"
          title="Schedule Follow-up"
          sub="Book next appointment"
          hover="hover:bg-orange-50"
          onClick={() => go("followup")}
        />
        <Item
          icon={MessageSquare}
          iconClass="text-teal-600"
          title="Request Consult"
          sub="Get specialist opinion"
          hover="hover:bg-teal-50"
          onClick={() => go("consults")}
        />
        <Item
          icon={ListPlus}
          iconClass="text-red-600"
          title="Add to Problem List"
          sub="Record a new diagnosis"
          hover="hover:bg-red-50"
          onClick={() => go("add-problem")}
        />
        <Item
          icon={Upload}
          iconClass="text-gray-600"
          title="Upload Documents"
          sub="Add external records"
          hover="hover:bg-gray-50"
          onClick={() => go("upload")}
        />
      </nav>
    </div>
  );
}
