"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PatientPrivacyPanel from "@/components/privacy/PatientPrivacyPanel";

export default function PatientPrivacyPage() {
  const params = useParams();
  const patientId = typeof params.patientId === "string" ? params.patientId : "";
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("patients")
        .select("full_name, docpad_id")
        .eq("id", patientId)
        .maybeSingle();
      if (cancelled || !data) return;
      setLabel([data.full_name, data.docpad_id].filter(Boolean).join(" · "));
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <Link href="/dashboard/patients" className="text-xs font-semibold text-blue-700 hover:underline">
            &lt; All patients
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {label || "Patient"}
          </h1>
          <p className="text-sm text-slate-600">
            What this patient has agreed to, and anything they have asked us to do about their data.
          </p>
        </header>

        {patientId ? (
          <PatientPrivacyPanel patientId={patientId} />
        ) : (
          <p className="text-sm text-red-700">No patient selected.</p>
        )}
      </div>
    </div>
  );
}
