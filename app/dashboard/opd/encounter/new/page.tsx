"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { fetchAuthOrgId } from "../../../../lib/authOrg";
import { createOpdEncounterForPatient } from "../../../../lib/createOpdEncounterForPatient";
import { supabase } from "../../../../supabase";

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function NewEncounterBootstrapInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Starting new encounter…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const rawPid = searchParams.get("patientId")?.trim() ?? "";
    if (!rawPid || !isLikelyUuid(rawPid)) {
      router.replace("/dashboard/opd/new");
      return;
    }

    let cancelled = false;

    void (async () => {
      const { orgId } = await fetchAuthOrgId();
      if (cancelled) return;
      if (!orgId?.trim()) {
        setError("Your account is not linked to an organization.");
        setMessage("");
        return;
      }

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid = authData.user?.id?.trim() ?? "";
      if (!uid) {
        setError(authErr?.message?.trim() ? `Could not verify sign-in: ${authErr.message}` : "You must be signed in.");
        setMessage("");
        return;
      }

      const result = await createOpdEncounterForPatient(rawPid, orgId, uid, null);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setMessage("");
        return;
      }

      const newId = result.encounterId?.trim() ?? "";
      if (!newId) {
        setError("Encounter created, but couldn't find the new ID to redirect.");
        setMessage("");
        return;
      }

      router.replace(`/dashboard/opd/encounter/${newId}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4">
      {error ? (
        <>
          <p role="alert" className="max-w-md text-center text-sm font-medium text-red-700">
            {error}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/dashboard/opd/new" className="text-sm font-semibold text-blue-600 hover:underline">
              Search for a patient
            </Link>
            <span className="text-gray-300">·</span>
            <Link href="/dashboard/opd" className="text-sm font-semibold text-gray-600 hover:underline">
              OPD home
            </Link>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-600">{message}</p>
      )}
    </div>
  );
}

export default function NewEncounterFromPatientPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">Loading…</div>
      }
    >
      <NewEncounterBootstrapInner />
    </Suspense>
  );
}
