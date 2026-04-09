"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { EligibilitySummaryCard, type CoverageSummary } from "@/app/components/insurance/EligibilitySummaryCard";
import { InsuranceCardCaptureFlow } from "@/app/components/insurance/InsuranceCardCaptureFlow";

function normalizeCompanyEmbed(raw: unknown): { name: string } | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && typeof first === "object" && "name" in first) {
      return { name: String((first as { name: unknown }).name ?? "") };
    }
    return null;
  }
  if (typeof raw === "object" && "name" in raw) {
    return { name: String((raw as { name: unknown }).name ?? "") };
  }
  return null;
}

export default function PatientInsurancePage() {
  const params = useParams();
  const patientId = typeof params.patientId === "string" ? params.patientId : "";

  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [patientLabel, setPatientLabel] = useState<string>("");
  const [patientHospital, setPatientHospital] = useState<string | null>(null);
  const [rows, setRows] = useState<CoverageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  const loadCoverages = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    const { data: pRow, error: pErr } = await supabase
      .from("patients")
      .select("full_name, hospital_id")
      .eq("id", patientId)
      .maybeSingle();
    if (pErr || !pRow) {
      setError(pErr?.message ?? "Patient not found.");
      setRows([]);
      setLoading(false);
      return;
    }
    setPatientLabel(String((pRow as { full_name?: string | null }).full_name ?? "Patient"));
    setPatientHospital((pRow as { hospital_id?: string | null }).hospital_id ?? null);

    const { data, error: qErr } = await supabase
      .from("patient_insurance_coverage")
      .select(
        `
        id,
        insurance_name_raw,
        policy_number,
        member_id,
        valid_until,
        remaining_balance,
        coverage_limit,
        insurance_companies ( name )
      `,
      )
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });

    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      const raw = (data ?? []) as Record<string, unknown>[];
      setRows(
        raw.map((r) => ({
          id: String(r.id),
          insurance_name_raw: r.insurance_name_raw != null ? String(r.insurance_name_raw) : null,
          policy_number: r.policy_number != null ? String(r.policy_number) : null,
          member_id: r.member_id != null ? String(r.member_id) : null,
          valid_until: r.valid_until != null ? String(r.valid_until).slice(0, 10) : null,
          remaining_balance: r.remaining_balance != null ? Number(r.remaining_balance) : null,
          coverage_limit: r.coverage_limit != null ? Number(r.coverage_limit) : null,
          insurance_companies: normalizeCompanyEmbed(r.insurance_companies),
        })),
      );
    }
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    void loadCoverages();
  }, [loadCoverages]);

  const orgMismatch =
    hospitalId && patientHospital != null && patientHospital !== "" && hospitalId !== patientHospital
      ? "This patient belongs to another organization."
      : null;

  if (!patientId) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">Invalid patient.</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/dashboard/patients"
              className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              ← Patients queue
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Insurance coverage</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{patientLabel}</p>
          </div>
          {!showCapture && hospitalId && !orgMismatch ? (
            <Button type="button" onClick={() => setShowCapture(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add from card
            </Button>
          ) : null}
        </div>

        {!hospitalId ? <p className="text-sm text-slate-500">Loading your hospital context…</p> : null}
        {orgMismatch ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{orgMismatch}</p> : null}
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {showCapture && hospitalId && !orgMismatch ? (
          <InsuranceCardCaptureFlow
            patientId={patientId}
            hospitalId={hospitalId}
            onSaved={() => {
              setShowCapture(false);
              void loadCoverages();
            }}
            onCancel={() => setShowCapture(false)}
          />
        ) : null}

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Saved plans</h2>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              No insurance on file. Use <strong>Add from card</strong> to capture the ID card.
            </p>
          ) : (
            <ul className="space-y-4">
              {rows.map((r) => (
                <li key={r.id}>
                  <EligibilitySummaryCard row={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
