"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ABHAStatusIndicator } from "@/components/abdm/ABHAStatusIndicator";
import { supabase } from "@/lib/supabase";
import AddProblemListModal from "@/components/AddProblemListModal";
import ActiveProblemsPanel from "@/components/patient-summary/active-problems-panel";
import PatientSummaryRecentVitals from "@/components/patient-summary/PatientSummaryRecentVitals";
import PatientSummaryOpdTimeline from "@/components/patient-summary/PatientSummaryOpdTimeline";
import PatientClinicalImagesSection from "@/components/clinical-attachments/PatientClinicalImagesSection";
import CurrentMedicationsCard from "@/components/CurrentMedicationsCard";
import SummaryQuickActions from "@/components/SummaryQuickActions";
import EncounterHistorySection from "@/components/EncounterHistorySection";
import PatientSummaryAllergyBanner from "@/components/PatientSummaryAllergyBanner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { usePatientSummaryComplete } from "@/hooks/usePatientSummary";
import type { PatientSummaryRow } from "@/hooks/usePatientSummaryHighlights";
import type { HealthTimelineNode } from "@/lib/fhirEncounterTimeline";
import { useToast } from "@/components/ui/toast-provider";
import AiSummaryCard from "@/components/AiSummaryCard";

type PatientSummaryDashboardProps = {
  patientId: string;
  liveOpdTimelineNodes: HealthTimelineNode[];
  encountersLoading: boolean;
  encountersError: string | null;
  onLiveOpdClick: (opdEncounterId: string) => void;
  summaryRow: PatientSummaryRow | null;
  summaryLoading: boolean;
  summaryError: string | null;
  onRefreshHighlightsTimestamp: (currentHighlights: string) => Promise<{ error: Error | null }>;
  summaryOrgId: string | null;
  currentEncounterFinalized?: boolean;
  summaryEncounterId?: string | null;
  summaryReloadToken?: number;
  onNavigate?: (view: string, params?: Record<string, unknown>) => void;
  onViewAllergyDetails?: () => void;
};

export default function PatientSummaryDashboard(props: PatientSummaryDashboardProps) {
  const {
    patientId,
    summaryOrgId,
    currentEncounterFinalized = false,
    summaryEncounterId = null,
    summaryReloadToken = 0,
    onNavigate,
    onViewAllergyDetails,
  } = props;
  const { toast } = useToast();
  const [problemModalOpen, setProblemModalOpen] = useState(false);
  const [problemPanelNonce, setProblemPanelNonce] = useState(0);
  const [patientRow, setPatientRow] = useState<{
    full_name: string;
    sex: string | null;
    age_years: number | null;
    abha_id: string | null;
  } | null>(null);

  const orgOk = Boolean(summaryOrgId?.trim());
  const activeProblemsReloadKey = `${summaryReloadToken}-${problemPanelNonce}`;
  const vitalsReloadKey = String(summaryReloadToken);

  const handleQuickNavigate = useCallback(
    (view: string, params?: Record<string, unknown>) => {
      if (view === "add-problem") {
        if (!orgOk) {
          toast.warning({
            title: "Organization required",
            body: "Organization context is missing; cannot add to problem list.",
          });
          return;
        }
        setProblemModalOpen(true);
        return;
      }
      onNavigate?.(view, params);
    },
    [orgOk, onNavigate, toast],
  );

  const { data: complete, loading: completeLoading, error: completeError, refresh } = usePatientSummaryComplete(
    patientId?.trim() ? patientId.trim() : null,
  );

  useEffect(() => {
    if (summaryReloadToken > 0) {
      void refresh();
    }
  }, [summaryReloadToken, refresh]);

  useEffect(() => {
    const pid = patientId?.trim();
    if (!pid) {
      setPatientRow(null);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("patients")
        .select("full_name, sex, age_years, abha_id")
        .eq("id", pid)
        .maybeSingle();
      if (!data) {
        setPatientRow(null);
        return;
      }
      setPatientRow({
        full_name: data.full_name != null ? String(data.full_name) : "",
        sex: data.sex != null ? String(data.sex) : null,
        age_years: data.age_years != null && !Number.isNaN(Number(data.age_years)) ? Number(data.age_years) : null,
        abha_id: data.abha_id != null ? String(data.abha_id) : null,
      });
    })();
  }, [patientId]);

  const medicationRequests = useMemo(() => complete?.medications ?? [], [complete?.medications]);

  const patientData = useMemo(() => {
    const id = patientId.trim();
    if (!id) return null;
    return {
      id,
      full_name: patientRow?.full_name ?? null,
      sex: patientRow?.sex ?? null,
      age_years: patientRow?.age_years ?? null,
      abha_id: patientRow?.abha_id ?? null,
    };
  }, [patientId, patientRow]);

  const medicationsError = complete?.medicationListError ?? completeError?.message ?? null;

  if (!patientId.trim()) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">No patient selected for this summary.</div>
    );
  }

  if (completeLoading && !complete) {
    return (
      <div className="patient-summary-root space-y-4 bg-white p-4 sm:p-6">
        <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-14 animate-pulse rounded-lg bg-red-100/80" />
        <div className="h-36 animate-pulse rounded-xl bg-gray-100" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
        </div>
        <div className="h-28 animate-pulse rounded-xl bg-gray-100" />
        <p className="text-center text-xs text-gray-500">Loading patient summary…</p>
      </div>
    );
  }

  if (completeError && !complete) {
    return (
      <div className="patient-summary-root space-y-4 bg-white p-6">
        <PatientSummaryAllergyBanner patientId={patientId.trim()} onViewDetails={onViewAllergyDetails} />
        <AlertBanner
          severity="high"
          title="Summary unavailable"
          body={
            <>
              <p>{completeError?.message || "An unexpected error occurred"}</p>
              <p className="mt-2 text-xs text-slate-600">
                Ensure RPCs such as{" "}
                <code className="rounded bg-gray-100 px-1">get_patient_header_data</code> are deployed. Active problems
                load directly from <code className="rounded bg-gray-100 px-1">active_problems</code>.
              </p>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="patient-summary-root space-y-5 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Patient summary</p>
          {patientData ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-lg font-bold tracking-tight text-gray-900">
                {patientData.full_name?.trim() || "Patient"}
              </h2>
              <ABHAStatusIndicator
                abhaId={patientData.abha_id}
                linkPatient={patientData}
                onLinked={(abha) => {
                  setPatientRow((prev) =>
                    prev
                      ? { ...prev, abha_id: abha }
                      : {
                          full_name: patientData.full_name || "Patient",
                          sex: patientData.sex,
                          age_years: patientData.age_years,
                          abha_id: abha,
                        },
                  );
                }}
              />
            </div>
          ) : null}
        </div>
        {currentEncounterFinalized ? (
          <span
            className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800"
            title="This visit is closed in the record"
          >
            Finalized
          </span>
        ) : null}
      </div>

      <AiSummaryCard patientId={patientId.trim()} />

      <PatientSummaryAllergyBanner patientId={patientId.trim()} onViewDetails={onViewAllergyDetails} />

      <PatientSummaryOpdTimeline patientId={patientId.trim()} />

      <PatientClinicalImagesSection patientId={patientId.trim()} reloadToken={summaryReloadToken} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 space-y-4">
          <ActiveProblemsPanel
            patientId={patientId.trim()}
            reloadToken={activeProblemsReloadKey}
            onAdd={() => handleQuickNavigate("add-problem")}
          />
        </div>
        <div className="min-w-0">
          {patientId.trim() ? (
            <EncounterHistorySection
              patientId={patientId.trim()}
              currentEncounterId={summaryEncounterId}
              onNavigate={onNavigate}
            />
          ) : null}
        </div>
        <div className="min-w-0 space-y-4">
          <CurrentMedicationsCard
            requests={medicationRequests}
            loading={completeLoading}
            error={medicationsError}
            onPastRx={() => handleQuickNavigate("prescriptions")}
          />
          <SummaryQuickActions patientId={patientId} onNavigate={handleQuickNavigate} />
        </div>
      </div>

      <PatientSummaryRecentVitals patientId={patientId.trim()} reloadToken={vitalsReloadKey} />

      {orgOk && summaryOrgId && patientId.trim() ? (
        <AddProblemListModal
          open={problemModalOpen}
          onClose={() => setProblemModalOpen(false)}
          patientId={patientId.trim()}
          orgId={summaryOrgId}
          onSuccess={() => {
            void refresh();
            setProblemPanelNonce((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
