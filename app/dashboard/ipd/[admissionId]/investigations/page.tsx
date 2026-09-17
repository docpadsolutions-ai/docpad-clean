"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import IPDPendingResultsPanel from "@/components/investigations/ipd-pending-results-panel";
import { supabase } from "@/lib/supabase";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export default function IpdAdmissionInvestigationsPage() {
  const params = useParams();
  const admissionId = typeof params?.admissionId === "string" ? params.admissionId : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [admissionLabel, setAdmissionLabel] = useState<string>("");
  const [practitionerId, setPractitionerId] = useState<string | null>(null);

  const loadAdmission = useCallback(async () => {
    if (!admissionId) {
      setError("Missing admission.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("ipd_admissions")
      .select("id, patient_id, hospital_id, admission_number")
      .eq("id", admissionId)
      .maybeSingle();
    if (qErr) {
      setError(qErr.message);
      setPatientId(null);
      setHospitalId(null);
      setLoading(false);
      return;
    }
    if (!data) {
      setError("Admission not found.");
      setPatientId(null);
      setHospitalId(null);
      setLoading(false);
      return;
    }
    const row = data as Record<string, unknown>;
    setPatientId(s(row.patient_id) || null);
    setHospitalId(s(row.hospital_id) || null);
    const num = s(row.admission_number);
    setAdmissionLabel(num ? `Admission ${num}` : admissionId.slice(0, 8));
    setLoading(false);
  }, [admissionId]);

  useEffect(() => {
    void loadAdmission();
  }, [loadAdmission]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid || cancelled) {
        if (!cancelled) setPractitionerId(null);
        return;
      }
      const { data: prof } = await supabase.from("practitioners").select("id").eq("user_id", uid).maybeSingle();
      if (!cancelled) setPractitionerId(prof?.id ? String(prof.id) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!admissionId) {
    return (
      <div className="bg-white p-8 text-sm text-gray-900">
        Invalid admission.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white text-gray-900">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <header>
          <Link
            href={`/dashboard/ipd/${encodeURIComponent(admissionId)}`}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            ← Inpatient encounter
          </Link>
          <h1 className="mt-2 text-xl font-bold tracking-tight">Investigations</h1>
          <p className="mt-1 text-sm text-muted-foreground">{admissionLabel}</p>
        </header>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : patientId && hospitalId ? (
          <IPDPendingResultsPanel
            admissionId={admissionId}
            patientId={patientId}
            hospitalId={hospitalId}
            practitionerId={practitionerId}
            onRefresh={() => void loadAdmission()}
          />
        ) : (
          <p className="text-sm text-amber-800">Patient or hospital context is missing for this admission.</p>
        )}
      </div>
    </div>
  );
}
