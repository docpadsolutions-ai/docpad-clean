"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAuthOrgId } from "../../lib/authOrg";
import {
  practitionerHeaderSubtitle,
  practitionerHeaderTitle,
} from "../../lib/practitionerHeader";
import { practitionersOrFilterForAuthUid } from "../../lib/practitionerAuthLookup";
import { supabase } from "../../supabase";
import IpdClinicalCommandCenter from "./IpdClinicalCommandCenter";
import WardCensusTab from "./WardCensusTab";
import { useIpdDoctorAdmissions } from "./useIpdDoctorAdmissions";
import { DashboardHeaderNotificationBell } from "@/app/components/dashboard/DashboardHeaderNotificationBell";
import { DashboardNotificationsPanel } from "@/app/components/dashboard/DashboardNotificationsPanel";
import { useNotificationCounts } from "@/app/hooks/useNotifications";

const AdmitPatientModal = dynamic(
  () => import("@/app/components/ipd/admit-patient-modal").then((m) => m.AdmitPatientModal),
  { ssr: false },
);

export default function IpdDashboardPage() {
  const router = useRouter();
  const [hospitalName, setHospitalName] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const ipd = useIpdDoctorAdmissions(hospitalId);
  const [dashTab, setDashTab] = useState<"my" | "census">("my");
  const [admitOpen, setAdmitOpen] = useState(false);
  const [headerTitle, setHeaderTitle] = useState<string | null>(null);
  const [headerSubtitle, setHeaderSubtitle] = useState<string | null>(null);
  const [headerLoading, setHeaderLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setHeaderLoading(true);
      const { orgId, error: orgErr } = await fetchAuthOrgId();
      if (cancelled) return;

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;

      const tasks: Promise<void>[] = [];

      if (uid) {
        tasks.push(
          (async () => {
            const { data: profile, error } = await supabase
              .from("practitioners")
              .select("first_name, last_name, full_name, role, user_role, specialty, qualification")
              .or(practitionersOrFilterForAuthUid(uid))
              .maybeSingle();
            if (cancelled) return;
            if (error || !profile) {
              setHeaderTitle(null);
              setHeaderSubtitle(null);
              return;
            }
            const row = profile as {
              full_name?: unknown;
              first_name?: unknown;
              last_name?: unknown;
              role?: unknown;
              user_role?: unknown;
              specialty?: unknown;
              qualification?: unknown;
            };
            const title = practitionerHeaderTitle(row);
            const sub = practitionerHeaderSubtitle(row);
            setHeaderTitle(title || null);
            setHeaderSubtitle(sub || null);
          })(),
        );
      } else {
        setHeaderTitle(null);
        setHeaderSubtitle(null);
      }

      if (orgId && !orgErr) {
        setHospitalId(orgId);
        tasks.push(
          (async () => {
            const { data: org } = await supabase
              .from("organizations")
              .select("name")
              .eq("id", orgId)
              .maybeSingle();
            if (cancelled) return;
            const n = org?.name != null ? String(org.name).trim() : "";
            setHospitalName(n || null);
          })(),
        );
      } else {
        setHospitalId(null);
        setHospitalName(null);
      }

      await Promise.all(tasks);
      if (!cancelled) setHeaderLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  const { stats, loading: ipdLoading, setTab } = ipd;

  const notificationCounts = useNotificationCounts();

  const onPendingDischargesClick = useCallback(() => {
    setTab("discharge");
    requestAnimationFrame(() => {
      document.getElementById("ipd-clinical-command-centre")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [setTab]);

  return (
    <div className="flex min-h-screen min-w-0 flex-1 flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-3 sm:flex-row sm:justify-between lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="hidden lg:block" aria-hidden />
          <div className="flex w-full justify-center lg:w-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-900">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
              {hospitalName ?? (headerLoading ? "…" : "Hospital")}
            </div>
          </div>
          <div className="flex w-full items-center justify-center gap-3 sm:justify-end lg:justify-end">
            <DashboardHeaderNotificationBell total={notificationCounts.total} />
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-900">
                {headerLoading ? "…" : headerTitle || "Signed in"}
              </p>
              <p className="text-xs text-slate-500">
                {headerLoading ? "\u00a0" : headerSubtitle || "\u00a0"}
              </p>
            </div>
            <div
              className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 ring-2 ring-white"
              aria-hidden
            />
            <button
              type="button"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"
              aria-label="Account menu"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-1 flex-col gap-6 px-4 py-6 lg:flex-row lg:px-8 lg:py-8">
        <main className="min-w-0 w-full flex-1 space-y-6 lg:max-w-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">IPD</h1>
              <p className="mt-0.5 text-sm text-slate-500">{todayLabel}</p>
            </div>
            {hospitalId ? (
              <button
                type="button"
                onClick={() => setAdmitOpen(true)}
                className="shrink-0 rounded-full border border-blue-200 bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                + New Admission
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-0">
            <button
              type="button"
              onClick={() => setDashTab("my")}
              className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition ${
                dashTab === "my"
                  ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              My Patients
            </button>
            <button
              type="button"
              onClick={() => setDashTab("census")}
              className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition ${
                dashTab === "census"
                  ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Ward Census
            </button>
          </div>

          {dashTab === "my" ? (
            <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <div className="rounded-xl border border-sky-100 bg-sky-50/90 p-5 shadow-sm">
              {ipdLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <p className="text-3xl font-bold text-sky-700">{stats.activePatients}</p>
              )}
              <p className="mt-1 text-sm font-medium text-sky-900/80">Active Patients</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/90 p-5 shadow-sm">
              {ipdLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <p className="text-3xl font-bold text-amber-800">{stats.surgical}</p>
              )}
              <p className="mt-1 text-sm font-medium text-amber-950/80">Surgical</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/90 p-5 shadow-sm">
              {ipdLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <p className="text-3xl font-bold text-emerald-800">{stats.pendingLabs}</p>
              )}
              <p className="mt-1 text-sm font-medium text-emerald-950/80">Pending Labs</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              {ipdLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <p className="text-3xl font-bold text-slate-800">{stats.forDischarge}</p>
              )}
              <p className="mt-1 text-sm font-medium text-slate-600">For Discharge</p>
            </div>
          </div>

          <IpdClinicalCommandCenter {...ipd} />
            </>
          ) : (
            <WardCensusTab hospitalId={hospitalId} />
          )}

          {hospitalId ? (
            <AdmitPatientModal
              open={admitOpen}
              onClose={() => setAdmitOpen(false)}
              patientId={null}
              hospitalId={hospitalId}
              onSuccess={() => setAdmitOpen(false)}
            />
          ) : null}
        </main>

        <aside className="w-full shrink-0 space-y-6 lg:w-80 xl:w-96">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-slate-900">Quick Actions</h3>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => router.push("/ipd/beds")}
                className="w-full rounded-full border border-slate-200 bg-slate-100 px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-200/90"
              >
                Bed Management
              </button>
              <button
                type="button"
                className="w-full rounded-full border border-slate-200 bg-slate-100 px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-200/90"
              >
                OT Schedule
              </button>
              <button
                type="button"
                onClick={onPendingDischargesClick}
                className="w-full rounded-full border border-slate-200 bg-slate-100 px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-200/90"
              >
                Pending Discharges
              </button>
            </div>
          </div>

          <DashboardNotificationsPanel
            counts={{ OPD: notificationCounts.OPD, IPD: notificationCounts.IPD }}
            onInvalidate={() => void notificationCounts.refetch()}
          />
        </aside>
      </div>
    </div>
  );
}
