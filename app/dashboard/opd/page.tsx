"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchAuthOrgId } from "../../lib/authOrg";
import { fetchOpdDashboardStats } from "../../lib/opdDashboardStats";
import {
  practitionerHeaderSubtitle,
  practitionerHeaderTitle,
} from "../../lib/practitionerHeader";
import { practitionersOrFilterForAuthUid } from "../../lib/practitionerAuthLookup";
import { supabase } from "../../supabase";
import ClinicalCommandCenterQueue from "./ClinicalCommandCenterQueue";

export default function OpdDashboardPage() {
  const [hospitalName, setHospitalName] = useState<string | null>(null);
  const [headerTitle, setHeaderTitle] = useState<string | null>(null);
  const [headerSubtitle, setHeaderSubtitle] = useState<string | null>(null);
  const [stats, setStats] = useState({ scheduledToday: 0, active: 0, completed: 0, noShow: 0 });
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
        tasks.push(
          (async () => {
            const s = await fetchOpdDashboardStats(orgId);
            if (cancelled) return;
            setStats(s);
          })(),
        );
      } else {
        setHospitalName(null);
        setStats({ scheduledToday: 0, active: 0, completed: 0, noShow: 0 });
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

  return (
    <div className="flex min-h-screen min-w-0 flex-1 flex-col bg-slate-50">
        {/* Top header */}
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

        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 py-6 lg:flex-row lg:px-8 lg:py-8">
          {/* Center column */}
          <main className="min-w-0 flex-1 space-y-6 lg:max-w-none">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">OPD</h1>
              <p className="mt-0.5 text-sm text-slate-500">{todayLabel}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <div className="rounded-xl border border-sky-100 bg-sky-50/90 p-5 shadow-sm">
                <p className="text-3xl font-bold text-sky-700">{stats.scheduledToday}</p>
                <p className="mt-1 text-sm font-medium text-sky-900/80">Scheduled today</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/90 p-5 shadow-sm">
                <p className="text-3xl font-bold text-amber-800">{stats.active}</p>
                <p className="mt-1 text-sm font-medium text-amber-950/80">Active</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/90 p-5 shadow-sm">
                <p className="text-3xl font-bold text-emerald-800">{stats.completed}</p>
                <p className="mt-1 text-sm font-medium text-emerald-950/80">Completed</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-3xl font-bold text-slate-800">{stats.noShow}</p>
                <p className="mt-1 text-sm font-medium text-slate-600">No-show</p>
              </div>
            </div>

            <ClinicalCommandCenterQueue />
          </main>

          {/* Right column — Quick Actions + Notifications */}
          <aside className="w-full shrink-0 space-y-6 lg:w-80 xl:w-96">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-bold text-slate-900">Quick Actions</h3>
              <div className="mt-4 space-y-2">
                <Link
                  href="/dashboard/opd/new"
                  className="block w-full rounded-lg bg-blue-600 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  + New OPD Patient
                </Link>
                {["Block OPD Slots", "Set OPD Hours", "View OPD Templates"].map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <span className="h-8 w-8 shrink-0 rounded-lg bg-slate-100" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <svg
                  className="h-5 w-5 text-slate-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                <h3 className="text-base font-bold text-slate-900">Notifications</h3>
              </div>
              <ul className="mt-4 space-y-3">
                <li className="rounded-lg border border-rose-100 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-900">
                  <p className="font-medium">Lab results ready</p>
                  <p className="text-xs text-rose-800/80">Vikram Singh · 10 mins ago</p>
                </li>
                <li className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-950">
                  <p className="font-medium">New OPD appointment booked</p>
                  <p className="text-xs text-amber-900/80">Neha Shah · 2:30 PM</p>
                </li>
              </ul>
            </div>
          </aside>
        </div>
    </div>
  );
}
