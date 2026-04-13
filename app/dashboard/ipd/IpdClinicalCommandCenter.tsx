"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, AlertCircle, Droplets, Heart, Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type IpdDoctorAdmissionSummaryRow,
  type PendingIpdAdmissionRow,
  type UseIpdDoctorAdmissionsResult,
} from "./useIpdDoctorAdmissions";

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
        active ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
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

/** Count badge stays amber (active or not) to distinguish from in-ward patient counts. */
function PendingAdmissionTabButton({
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
        active ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
      <span
        className={`ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs font-bold ring-1 ${
          active
            ? "bg-amber-300/95 text-amber-950 ring-amber-400/90"
            : "bg-amber-100 text-amber-900 ring-amber-300/90"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Relative time from first admission / pending timestamp. */
function formatWaitingSince(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const then = new Date(iso.trim()).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function admissionTypeBadge(type: string | null | undefined): { label: string; badgeClass: string } {
  const raw = (type ?? "").trim();
  const t = raw.toLowerCase();
  if (!t) return { label: "—", badgeClass: "bg-slate-100 text-slate-600 ring-slate-200" };
  if (t.includes("emerg") || t === "er") {
    return { label: "Emergency", badgeClass: "bg-rose-50 text-rose-900 ring-rose-200/80" };
  }
  if (t.includes("day")) {
    return { label: "Day Care", badgeClass: "bg-slate-100 text-slate-700 ring-slate-200/90" };
  }
  if (t.includes("elect")) {
    return { label: "Elective", badgeClass: "bg-blue-50 text-blue-800 ring-blue-200/80" };
  }
  return {
    label: raw.length ? raw : "—",
    badgeClass: "bg-slate-50 text-slate-700 ring-slate-200/70",
  };
}

/** Tooltip text for HD badge — actual calendar admit date from the server. */
function formatAdmissionDateTooltip(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return undefined;
  const formatted = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
  return `Admitted ${formatted}`;
}

function statusPillMeta(status: string | null | undefined): { label: string; badgeClass: string } {
  const s = status?.toLowerCase().trim() ?? "";
  if (s === "stable") {
    return { label: "Stable", badgeClass: "bg-emerald-50 text-emerald-800 ring-emerald-200/80" };
  }
  if (s === "guarded") {
    return { label: "Guarded", badgeClass: "bg-amber-50 text-amber-900 ring-amber-200/80" };
  }
  if (s === "critical") {
    return { label: "Critical", badgeClass: "bg-rose-50 text-rose-800 ring-rose-200/80" };
  }
  return { label: "In progress", badgeClass: "bg-slate-50 text-slate-600 ring-slate-200" };
}

function vitalsValueClass(bad: boolean): string {
  return bad ? "font-semibold text-red-600" : "text-slate-700";
}

function VitalsCell({ row }: { row: IpdDoctorAdmissionSummaryRow }) {
  const hr = toNum(row.heart_rate);
  const sys = toNum(row.bp_systolic);
  const dia = toNum(row.bp_diastolic);
  const spo2 = toNum(row.spo2);
  const temp = toNum(row.temperature_c);
  const pain = toNum(row.pain_score);

  const hrBad = hr != null && (hr < 50 || hr > 100);
  const sysBad = sys != null && (sys > 160 || sys < 90);
  const spo2Bad = spo2 != null && spo2 < 94;
  const tempBad = temp != null && temp > 38.5;
  const painBad = pain != null && pain > 6;

  const bpText =
    sys == null && dia == null ? "—" : `${sys == null ? "—" : String(Math.round(sys))}/${dia == null ? "—" : String(Math.round(dia))}`;
  const spo2Text = spo2 == null ? "—" : `${Math.round(spo2)}`;
  const tempText =
    temp == null
      ? "—"
      : Math.abs(temp - Math.round(temp)) < 0.05
        ? String(Math.round(temp))
        : temp.toFixed(1);

  const line = (
    icon: ReactNode,
    iconToneClass: string,
    text: string,
    suffix: string,
    bad: boolean,
    key: string,
  ) => (
    <div key={key} className="flex min-w-0 items-start gap-1.5">
      <span className={`mt-0.5 inline-flex shrink-0 ${iconToneClass}`} aria-hidden>
        {icon}
      </span>
      <span className={`min-w-0 leading-tight ${vitalsValueClass(bad)}`}>
        <span className="text-xs">
          {text}
          {suffix}
        </span>
      </span>
    </div>
  );

  return (
    <div className="flex min-w-[120px] flex-col gap-0.5 py-0.5">
      {line(
        <Heart className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
        "text-rose-400",
        hr == null ? "—" : `${Math.round(hr)}`,
        " bpm",
        hrBad,
        "hr",
      )}
      {line(
        <Activity className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
        "text-violet-400",
        bpText,
        " mmHg",
        sysBad,
        "bp",
      )}
      {line(
        <Droplets className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
        "text-sky-400",
        spo2Text,
        spo2 == null ? "" : "%",
        spo2Bad,
        "spo2",
      )}
      {line(
        <Thermometer className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
        "text-amber-400",
        tempText,
        temp == null ? "" : "°C",
        tempBad,
        "temp",
      )}
      {line(
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />,
        "text-orange-400",
        pain == null ? "Pain —" : `Pain ${Math.round(pain)}`,
        "/10",
        painBad,
        "pain",
      )}
    </div>
  );
}

function IpdCommandCenterSkeleton() {
  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <colgroup>
          <col className="w-[15%]" />
          <col className="w-[22%]" />
          <col className="min-w-[120px] w-[25%]" />
          <col className="w-[22%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-2 py-3 pl-4 lg:pl-5">Bed</th>
            <th className="px-2 py-3">Patient</th>
            <th className="min-w-[120px] px-2 py-3">Vitals</th>
            <th className="px-2 py-3">Diagnosis</th>
            <th className="px-2 py-3 pr-4 text-right lg:pr-5">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i}>
              <td className="min-w-0 px-2 py-4 pl-4 lg:pl-5">
                <div className="flex w-[110px] max-w-[110px] min-w-0 flex-col gap-0.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="mt-0.5 h-3 w-full" />
                </div>
              </td>
              <td className="min-w-0 px-2 py-4">
                <Skeleton className="h-4 w-full max-w-[8rem]" />
                <Skeleton className="mt-2 h-3 w-24" />
              </td>
              <td className="min-w-[120px] px-2 py-4">
                <div className="flex min-w-[120px] flex-col gap-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </td>
              <td className="min-w-0 px-2 py-4">
                <Skeleton className="h-4 w-full" />
              </td>
              <td className="min-w-0 px-2 py-4 pr-4 text-right lg:pr-5">
                <div className="ml-auto flex max-w-full items-center justify-end gap-2">
                  <Skeleton className="inline-block h-6 w-16 rounded-full" />
                  <Skeleton className="h-8 w-14 shrink-0 rounded-lg" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingAdmissionTableSkeleton() {
  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <colgroup>
          <col className="w-[14%]" />
          <col className="w-[18%]" />
          <col className="w-[20%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-2 py-3 pl-4 text-left lg:pl-5">Bed</th>
            <th className="px-2 py-3 text-left">Patient</th>
            <th className="px-2 py-3 text-left">Diagnosis</th>
            <th className="px-2 py-3 text-left">Type</th>
            <th className="px-2 py-3 text-left">Waiting since</th>
            <th className="px-2 py-3 text-left">Status</th>
            <th className="px-2 py-3 pr-4 text-right lg:pr-5">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              <td className="px-2 py-4 pl-4 lg:pl-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-5 w-20 rounded-full" />
              </td>
              <td className="px-2 py-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-20" />
              </td>
              <td className="px-2 py-4">
                <Skeleton className="h-4 w-full" />
              </td>
              <td className="px-2 py-4">
                <Skeleton className="h-6 w-16 rounded-full" />
              </td>
              <td className="px-2 py-4">
                <Skeleton className="h-4 w-20" />
              </td>
              <td className="px-2 py-4">
                <Skeleton className="h-6 w-28 rounded-full" />
              </td>
              <td className="px-2 py-4 pr-4 text-right">
                <Skeleton className="ml-auto h-8 w-24 rounded-lg" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingAdmissionDetailsBody({ row }: { row: PendingIpdAdmissionRow }) {
  const name = str(row.patient_name) || "—";
  const age = toNum(row.patient_age);
  const sex = str(row.patient_sex) || "—";
  const ward = str(row.ward_name);
  const bed = str(row.bed_number);
  const bt = str(row.bed_type);
  const doctor = str(row.doctor_name) || "—";
  const dx = str(row.primary_diagnosis) || "—";
  const admNo = str(row.admission_number) || "—";
  const bedLine = [ward, bed ? `Bed ${bed}` : ""].filter(Boolean).join(" · ") || "—";

  return (
    <div className="max-w-xs space-y-3 text-sm">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Patient</p>
        <p className="font-semibold text-slate-900">{name}</p>
        <p className="text-xs text-slate-600">
          {age != null ? `${Math.round(age)}Y` : "—"} · {sex}
        </p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bed</p>
        <p className="text-slate-800">{bedLine}</p>
        {bt ? <p className="text-xs text-slate-600">Type: {bt}</p> : null}
        <span className="mt-1 inline-flex w-fit rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200/80">
          Reserved
        </span>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Doctor</p>
        <p className="text-slate-800">{doctor}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Diagnosis</p>
        <p className="text-slate-800">{dx}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Admission number</p>
        <p className="font-mono text-xs text-slate-800">{admNo}</p>
      </div>
      <p className="rounded-lg border border-amber-100 bg-amber-50/90 px-2.5 py-2 text-xs text-amber-950">
        Waiting for reception to confirm payment
      </p>
    </div>
  );
}

export default function IpdClinicalCommandCenter(ipd: UseIpdDoctorAdmissionsResult) {
  const {
    displayRows,
    tabCounts,
    tab,
    setTab,
    commandCenterLoading,
    commandCenterError,
    pendingAdmissionRows,
  } = ipd;

  const isPendingTab = tab === "pending_admission";
  const emptyMain = !commandCenterLoading && !isPendingTab && displayRows.length === 0;
  const emptyPending = !commandCenterLoading && isPendingTab && pendingAdmissionRows.length === 0;

  return (
    <section
      id="ipd-clinical-command-centre"
      className="w-full min-w-0 scroll-mt-4 overflow-x-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm lg:scroll-mt-6"
    >
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Clinical Command Center</h2>
            <p className="text-xs text-slate-500">Active admissions under your care</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="#" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
              View all &gt;
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === "all"} onClick={() => setTab("all")} count={tabCounts.all}>
            All Patients
          </TabButton>
          <PendingAdmissionTabButton
            active={isPendingTab}
            onClick={() => setTab("pending_admission")}
            count={tabCounts.pendingAdmission}
          >
            Pending Admission
          </PendingAdmissionTabButton>
          <TabButton active={tab === "post_op"} onClick={() => setTab("post_op")} count={tabCounts.postOp}>
            Post-Op
          </TabButton>
          <TabButton
            active={tab === "discharge"}
            onClick={() => setTab("discharge")}
            count={tabCounts.discharge}
          >
            For Discharge
          </TabButton>
        </div>
      </div>

      {commandCenterError ? (
        <div className="px-6 py-8 text-center">
          <p className="text-sm font-medium text-red-700">Could not load admissions</p>
          <p className="mt-1 text-xs text-red-600/90">{commandCenterError}</p>
          <p className="mt-3 text-xs text-slate-500">
            {isPendingTab ? (
              <>
                Check Supabase RLS and the <code className="rounded bg-slate-100 px-1">get_pending_admissions</code> RPC.
              </>
            ) : (
              <>
                Check Supabase RLS and the{" "}
                <code className="rounded bg-slate-100 px-1">ipd_doctor_admissions_summary</code> view.
              </>
            )}
          </p>
        </div>
      ) : commandCenterLoading ? (
        <div className="w-full min-w-0 overflow-x-hidden py-4">
          {isPendingTab ? <PendingAdmissionTableSkeleton /> : <IpdCommandCenterSkeleton />}
        </div>
      ) : emptyPending ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-100">
            <svg
              className="h-7 w-7 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-800">No pending admissions</p>
          <p className="mt-1 max-w-md mx-auto text-sm text-slate-500">
            New admissions created by doctors will appear here until reception confirms payment
          </p>
        </div>
      ) : emptyMain ? (
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
          <p className="text-base font-semibold text-slate-800">No active admissions under your care</p>
          <p className="mt-1 max-w-sm mx-auto text-sm text-slate-500">
            Admissions appear here when patients are admitted under your care and the encounter is active.
          </p>
        </div>
      ) : isPendingTab ? (
        <div className="w-full min-w-0 overflow-x-hidden">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[18%]" />
              <col className="w-[20%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-3 pl-4 text-left lg:pl-5">Bed</th>
                <th className="px-2 py-3 text-left">Patient</th>
                <th className="px-2 py-3 text-left">Diagnosis</th>
                <th className="px-2 py-3 text-left">Type</th>
                <th className="px-2 py-3 text-left">Waiting since</th>
                <th className="px-2 py-3 text-left">Status</th>
                <th className="px-2 py-3 pr-4 text-right lg:pr-5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendingAdmissionRows.map((row) => {
                const ward = str(row.ward_name);
                const bed = str(row.bed_number);
                const name = str(row.patient_name) || "—";
                const age = toNum(row.patient_age);
                const sex = str(row.patient_sex) || "—";
                const dx = str(row.primary_diagnosis) || "—";
                const typeMeta = admissionTypeBadge(row.admission_type);
                const waiting = formatWaitingSince(row.admitted_at);

                return (
                  <tr key={row.admission_id} className="transition hover:bg-slate-50/90">
                    <td className="min-w-0 px-2 py-4 pl-4 align-top lg:pl-5">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-sm font-semibold leading-snug text-slate-900">
                          {ward || "—"}
                          {bed ? (
                            <>
                              {" "}
                              · Bed {bed}
                            </>
                          ) : null}
                        </p>
                        <span className="inline-flex w-fit rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 ring-1 ring-amber-200/80">
                          Reserved
                        </span>
                      </div>
                    </td>
                    <td className="min-w-0 px-2 py-4 align-top">
                      <p className="truncate font-semibold text-slate-900" title={name}>
                        {name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {age != null ? `${Math.round(age)}Y` : "—"}, {sex}
                      </p>
                    </td>
                    <td className="min-w-0 px-2 py-4 align-top text-xs text-slate-600">
                      <span className="line-clamp-2 break-words" title={dx || undefined}>
                        {dx || "—"}
                      </span>
                    </td>
                    <td className="min-w-0 px-2 py-4 align-top">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${typeMeta.badgeClass}`}
                      >
                        {typeMeta.label}
                      </span>
                    </td>
                    <td className="min-w-0 px-2 py-4 align-top text-xs text-slate-700">{waiting}</td>
                    <td className="min-w-0 px-2 py-4 align-top">
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-950 ring-1 ring-amber-200/80">
                        Awaiting Payment
                      </span>
                    </td>
                    <td className="min-w-0 px-2 py-4 pr-4 text-right align-top lg:pr-5">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" size="sm" className="text-xs font-semibold">
                            View Details
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-auto max-w-sm border-slate-200 p-4">
                          <PendingAdmissionDetailsBody row={row} />
                        </PopoverContent>
                      </Popover>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="w-full min-w-0 overflow-x-hidden">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[22%]" />
              <col className="min-w-[120px] w-[25%]" />
              <col className="w-[22%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-3 pl-4 text-left lg:pl-5">Bed</th>
                <th className="px-2 py-3 text-left">Patient</th>
                <th className="min-w-[120px] px-2 py-3 text-left">Vitals</th>
                <th className="px-2 py-3 text-left">Diagnosis</th>
                <th className="px-2 py-3 pr-4 text-right lg:pr-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayRows.map((row) => {
                const admissionId = row.admission_id?.trim();
                if (!admissionId) return null;
                const bed = row.bed_number?.trim() || "—";
                const admissionRef = row.admission_number?.trim() || "";
                const admitTooltip = formatAdmissionDateTooltip(row.admission_date ?? null);
                const ward = row.ward_name?.trim() || "";
                const name = row.patient_name?.trim() || "—";
                const age = toNum(row.age_years);
                const sex = row.sex?.trim() || "—";
                const hd = toNum(row.computed_hospital_day);
                const pod = toNum(row.post_op_day);
                const allergies = row.known_allergies?.trim();
                const hasAllergies = Boolean(allergies);
                const dx = row.primary_diagnosis_display?.trim() || "";
                const { label: statusLabel, badgeClass } = statusPillMeta(row.clinical_status);
                const pendingInv = toNum(row.pending_investigations) ?? 0;
                const pendingTx = toNum(row.pending_treatments) ?? 0;

                return (
                  <tr key={admissionId} className="transition hover:bg-slate-50/90">
                    <td className="min-w-0 px-2 py-4 pl-4 align-top lg:pl-5">
                      <div className="flex w-[110px] max-w-[110px] min-w-0 flex-col gap-0.5">
                        <p className="truncate font-semibold text-sm text-slate-900">{bed}</p>
                        {admissionRef ? (
                          <p
                            className="min-w-0 truncate overflow-hidden text-[10px] text-gray-400"
                            title={admissionRef}
                          >
                            {admissionRef}
                          </p>
                        ) : null}
                        {ward ? (
                          <p className="break-words text-xs text-gray-500">{ward}</p>
                        ) : null}
                      </div>
                    </td>
                    <td className="min-w-0 px-2 py-4 align-top">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="min-w-0 truncate font-semibold text-slate-900" title={name}>
                          {name}
                        </p>
                        {hasAllergies ? (
                          <span
                            className="inline-flex shrink-0 text-red-600"
                            title={allergies ?? "Allergies on file"}
                            aria-label={`Allergies: ${allergies}`}
                          >
                            ⚠
                          </span>
                        ) : null}
                        {hd != null ? (
                          <span
                            className="inline-flex shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800 ring-1 ring-inset ring-blue-200/80"
                            title={admitTooltip}
                          >
                            HD-{Math.round(hd)}
                          </span>
                        ) : null}
                        {pod != null && pod > 0 ? (
                          <span className="inline-flex shrink-0 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-900 ring-1 ring-inset ring-orange-200/80">
                            POD-{Math.round(pod)}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {age != null ? `${Math.round(age)}Y` : "—"}, {sex}
                      </p>
                    </td>
                    <td className="min-w-[120px] align-top px-2 py-4">
                      <VitalsCell row={row} />
                    </td>
                    <td className="min-w-0 px-2 py-4 align-top text-xs text-slate-600">
                      <span className="line-clamp-2 break-words" title={dx || undefined}>
                        {dx || "—"}
                      </span>
                    </td>
                    <td className="min-w-0 px-2 py-4 pr-4 align-top lg:pr-5">
                      <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                          <span
                            className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 sm:px-2.5 sm:py-1 sm:text-xs ${badgeClass}`}
                          >
                            {statusLabel}
                          </span>
                          {pendingInv > 0 ? (
                            <span
                              className="shrink-0 text-[11px] text-slate-600 sm:text-xs"
                              title={`${pendingInv} pending investigation(s)`}
                            >
                              🔬 {pendingInv}
                            </span>
                          ) : null}
                          {pendingTx > 0 ? (
                            <span
                              className="shrink-0 text-[11px] text-slate-600 sm:text-xs"
                              title={`${pendingTx} pending treatment(s)`}
                            >
                              💊 {pendingTx}
                            </span>
                          ) : null}
                        </div>
                        <Link
                          href={`/ipd/admissions/${encodeURIComponent(admissionId)}`}
                          className="inline-flex shrink-0 items-center justify-center gap-1 self-end rounded-lg bg-blue-600 px-2 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:self-auto sm:px-3 sm:py-2 sm:text-xs"
                        >
                          Open
                          <svg
                            className="h-3 w-3 sm:h-3.5 sm:w-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden
                          >
                            <path
                              d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
