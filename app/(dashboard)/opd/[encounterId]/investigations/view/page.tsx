"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import InvestigationsTabContent from "../../../../../components/patient-investigations/InvestigationsTabContent";
import {
  practitionerDisplayNameFromRow,
} from "../../../../../lib/practitionerAuthLookup";
import { supabase } from "../../../../../supabase";

export default function InvestigationsViewPage() {
  const params = useParams();
  const router = useRouter();
  const encounterId =
    typeof params.encounterId === "string"
      ? params.encounterId
      : Array.isArray(params.encounterId)
        ? params.encounterId[0] ?? ""
        : "";

  const [patientId, setPatientId] = useState<string>("");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [doctorDisplayName, setDoctorDisplayName] = useState<string>("Doctor");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const goOrderPage = useCallback(() => {
    if (!encounterId) return;
    router.push(`/opd/${encounterId}/investigations`);
  }, [encounterId, router]);

  useEffect(() => {
    if (!encounterId) {
      setLoading(false);
      setError("Missing encounter.");
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: enc, error: encErr } = await supabase
        .from("opd_encounters")
        .select(
          `
          patient_id,
          hospital_id,
          practitioner:practitioners!doctor_id(full_name, first_name, last_name)
        `,
        )
        .eq("id", encounterId)
        .maybeSingle();

      if (cancelled) return;
      if (encErr || !enc) {
        setError(encErr?.message ?? "Encounter not found.");
        setPatientId("");
        setHospitalId(null);
        setLoading(false);
        return;
      }

      const pid = enc.patient_id != null ? String(enc.patient_id).trim() : "";
      setPatientId(pid);
      const hid = enc.hospital_id != null && String(enc.hospital_id).trim() !== "" ? String(enc.hospital_id).trim() : null;
      setHospitalId(hid);

      const prRaw = enc.practitioner;
      const pr = Array.isArray(prRaw) ? prRaw[0] : prRaw;
      const name =
        pr && typeof pr === "object"
          ? practitionerDisplayNameFromRow(pr as { full_name?: unknown; first_name?: unknown; last_name?: unknown })
          : null;
      if (name) setDoctorDisplayName(`Dr. ${name}`);

      setError(pid ? null : "Encounter has no patient.");
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [encounterId]);

  if (!encounterId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 p-6 text-sm text-gray-600">
        Invalid encounter link.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <Link
          href={`/dashboard/opd/encounter/${encounterId}?tab=investigations`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Back to encounter
        </Link>
        <h1 className="mt-2 text-lg font-bold text-gray-900">Investigations</h1>
        <p className="text-xs text-gray-500">Results and workflow for this visit.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        </div>
      ) : error ? (
        <div className="mx-auto max-w-lg p-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>
        </div>
      ) : (
        <InvestigationsTabContent
          patientId={patientId}
          encounterId={encounterId}
          hospitalId={hospitalId}
          doctorDisplayName={doctorDisplayName}
          onRequestOrderMore={goOrderPage}
        />
      )}
    </div>
  );
}
