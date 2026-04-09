"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchAuthOrgId } from "../lib/authOrg";
import {
  practitionerDisplayNameFromRow,
  practitionerRoleRawFromRow,
  practitionersOrFilterForAuthUid,
} from "../lib/practitionerAuthLookup";
import { parsePractitionerRoleColumn, type UserRole } from "../lib/userRole";
import { DocPadLogoMark } from "../components/DocPadLogoMark";
import { supabase } from "../supabase";

function ClipboardListIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <path d="M12 11h5M12 16h5M12 20h4" />
      <path d="M8.5 11l1.5 1.5 3-3M8.5 16l1.5 1.5 3-3" />
    </svg>
  );
}

function BedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 18V6a2 2 0 012-2h2" />
      <path d="M2 18h20" />
      <path d="M6 18V9a2 2 0 012-2h7l5 5v6" />
      <circle cx="17" cy="7" r="2" />
    </svg>
  );
}

export default function DashboardPage() {
  const [welcomeLine, setWelcomeLine] = useState("Welcome, Doctor");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationLoading, setOrganizationLoading] = useState(true);
  /** Normalized practitioner role after login (in-memory; no routing). */
  const practitionerRoleRef = useRef<UserRole | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setOrganizationLoading(true);

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId || cancelled) {
        setOrganizationLoading(false);
        return;
      }

      const { data: profile, error } = await supabase
        .from("practitioners")
        .select("first_name, last_name, full_name, role, user_role")
        .or(practitionersOrFilterForAuthUid(userId))
        .maybeSingle();

      if (cancelled) return;

      if (error || !profile) {
        setOrganizationLoading(false);
        return;
      }

      practitionerRoleRef.current = parsePractitionerRoleColumn(
        practitionerRoleRawFromRow(profile as { user_role?: unknown; role?: unknown }),
      );

      const full = practitionerDisplayNameFromRow(
        profile as { full_name?: unknown; first_name?: unknown; last_name?: unknown },
      );

      if (full) {
        setWelcomeLine(`Welcome, Dr. ${full}`);
      }

      const { orgId: oid } = await fetchAuthOrgId();
      if (oid != null && oid !== "") {
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", oid)
          .maybeSingle();

        if (!cancelled && org?.name) {
          setOrganizationName(String(org.name).trim());
        }
      }

      if (!cancelled) setOrganizationLoading(false);
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <DocPadLogoMark className="h-11 w-11" />
            <span className="text-xl font-bold tracking-tight text-gray-900">
              DocPad
            </span>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">{welcomeLine}</p>
            {organizationLoading ? (
              <p className="text-xs text-gray-400">Loading organization…</p>
            ) : organizationName ? (
              <p className="text-xs text-gray-500">{organizationName}</p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12 lg:px-8 lg:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 lg:text-4xl">
            Customize your DocPad experience
          </h1>
          <p className="mt-3 text-base text-gray-500 lg:text-lg">
            Select the features you need. You can change this anytime in
            Settings.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          <Link
            href="/dashboard/opd"
            className="block cursor-pointer rounded-xl border border-gray-100 bg-white p-8 text-inherit shadow-sm no-underline transition-all hover:shadow-md"
          >
            <article>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <ClipboardListIcon className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-lg font-bold text-gray-900">
                Outpatient Management (OPD)
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                Manage OPD visits, consultations, follow-ups, and clinic notes
              </p>
            </article>
          </Link>

          <Link
            href="/dashboard/ipd"
            className="block cursor-pointer rounded-xl border border-gray-100 bg-white p-8 text-inherit shadow-sm no-underline transition-all hover:shadow-md"
          >
            <article>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <BedIcon className="h-7 w-7" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-gray-900">
                  Inpatient Management (IPD)
                </h2>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  Coming Soon
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                Manage admissions, daily rounds, ward patients, and discharge
                summaries
              </p>
            </article>
          </Link>
        </div>
      </main>
    </div>
  );
}
