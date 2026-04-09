"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ABHAStatusIndicator } from "@/components/abdm/ABHAStatusIndicator";
import { supabase } from "../supabase";
import AddProblemListModal from "./AddProblemListModal";
import ActiveProblemsPanel from "./patient-summary/active-problems-panel";
import VitalsWidget from "./patient-summary/vitals-widget";
import ClinicalHighlightsCard from "./ClinicalHighlightsCard";
import CurrentMedicationsCard from "./CurrentMedicationsCard";
import SummaryQuickActions from "./SummaryQuickActions";
import HealthTimeline from "./HealthTimeline";
import EncounterHistorySection from "./EncounterHistorySection";
import PatientSummaryAllergyBanner from "./PatientSummaryAllergyBanner";
import { usePatientSummaryComplete } from "../hooks/usePatientSummary";
import type { PatientSummaryRow } from "../hooks/usePatientSummaryHighlights";
import type { HealthTimelineNode } from "../lib/fhirEncounterTimeline";
import { sortTimelineByPeriodStart } from "../lib/fhirEncounterTimeline";

function isHealthTimelineNode(v: unknown): v is HealthTimelineNode {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const period = o.period;
  return (
    typeof o.id === "string" &&
    o.resourceType === "Encounter" &&
    typeof o._kind === "string" &&
    typeof o._displayLabel === "string" &&
    typeof o._source === "string" &&
    period != null &&
    typeof period === "object"
  );
}

function mergeTimelineNodes(
  live: HealthTimelineNode[],
  rpcRaw: unknown[],
): HealthTimelineNode[] {
  const fromRpc = rpcRaw.map((raw, i) => (isHealthTimelineNode(raw) ? raw : null)).filter(Boolean) as HealthTimelineNode[];
  const seen = new Set<string>();
  const out: HealthTimelineNode[] = [];
  for (const n of live) {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      out.push(n);
    }
  }
  for (const n of fromRpc) {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      out.push(n);
    }
  }
  out.sort(sortTimelineByPeriodStart);
  return out;
}

function pickHeaderString(o: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!o) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

type CareTeamDoctorLine = { title: string; subtitle: string | null };

function doctorLineFromUnknown(d: unknown, index: number): CareTeamDoctorLine | null {
  if (d == null) return null;
  if (typeof d === "string") {
    const t = d.trim();
    return t ? { title: t, subtitle: null } : null;
  }
  if (typeof d !== "object") {
    const t = String(d).trim();
    return t ? { title: t, subtitle: null } : null;
  }
  const o = d as Record<string, unknown>;
  const nested =
    o.practitioner && typeof o.practitioner === "object"
      ? (o.practitioner as Record<string, unknown>)
      : null;
  const name =
    pickHeaderString(o, [
      "full_name",
      "fullName",
      "name",
      "doctor_name",
      "doctorName",
      "display_name",
      "practitioner_name",
    ]) ?? pickHeaderString(nested, ["full_name", "fullName", "name", "display_name"]);
  const subtitle =
    pickHeaderString(o, ["specialty", "specialisation", "specialization", "role", "designation", "user_role"]) ??
    pickHeaderString(nested, ["specialty", "role", "user_role"]);
  if (!name && !subtitle) {
    return { title: `Doctor ${index + 1}`, subtitle: null };
  }
  return { title: name || "Doctor", subtitle: subtitle ?? null };
}

function facilityLineFromUnknown(f: unknown, index: number): string | null {
  if (f == null) return null;
  if (typeof f === "string") {
    const t = f.trim();
    return t || null;
  }
  if (typeof f !== "object") {
    const t = String(f).trim();
    return t || null;
  }
  const o = f as Record<string, unknown>;
  const name = pickHeaderString(o, [
    "name",
    "facility_name",
    "hospital_name",
    "organization_name",
    "org_name",
    "display_name",
    "title",
  ]);
  const loc = pickHeaderString(o, ["city", "location", "address", "branch"]);
  const type = pickHeaderString(o, ["type", "facility_type", "kind"]);
  const parts = [name, type, loc].filter(Boolean) as string[];
  if (parts.length) return parts.join(" · ");
  return `Facility ${index + 1}`;
}

export default function PatientSummaryDashboard({
  patientId,
  liveOpdTimelineNodes,
  encountersLoading,
  encountersError,
  summaryRow,
  summaryLoading,
  summaryError,
  onRefreshHighlightsTimestamp,
  summaryOrgId,
  currentEncounterFinalized = false,
  summaryEncounterId = null,
  summaryReloadToken = 0,
  onLiveOpdClick,
  onNavigate,
  onViewAllergyDetails,
}: {
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
  /** Increment after encounter save so RPC-backed summary refetches. */
  summaryReloadToken?: number;
  /** Tab / route navigation from quick actions (patientId included in params by the panel). */
  onNavigate?: (view: string, params?: Record<string, unknown>) => void;
  onViewAllergyDetails?: () => void;
}) {
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
          alert("Organization context is missing; cannot add to problem list.");
          return;
        }
        setProblemModalOpen(true);
        return;
      }
      onNavigate?.(view, params);
    },
    [orgOk, onNavigate],
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

  const mergedTimelineNodes = useMemo(
    () => mergeTimelineNodes(liveOpdTimelineNodes, complete?.timelineNodes ?? []),
    [liveOpdTimelineNodes, complete?.timelineNodes],
  );

  const timelineLoading = completeLoading || encountersLoading;
  const timelineError = completeError?.message ?? encountersError ?? null;
  const medicationsError = complete?.medicationListError ?? completeError?.message ?? null;

  const careTeamDoctorLines = useMemo(() => {
    const raw = complete?.careTeam?.doctors ?? [];
    return raw
      .map((d, i) => doctorLineFromUnknown(d, i))
      .filter(Boolean) as CareTeamDoctorLine[];
  }, [complete?.careTeam?.doctors]);

  const careTeamFacilityLines = useMemo(() => {
    const raw = complete?.careTeam?.facilities ?? [];
    return raw.map((f, i) => facilityLineFromUnknown(f, i)).filter(Boolean) as string[];
  }, [complete?.careTeam?.facilities]);

  if (!patientId.trim()) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">No patient selected for this summary.</div>
    );
  }

  if (completeLoading && !complete) {
    return (
      <div className="patient-summary-root space-y-4 p-6">
        <PatientSummaryAllergyBanner patientId={patientId.trim()} onViewDetails={onViewAllergyDetails} />
        <ActiveProblemsPanel patientId={patientId.trim()} reloadToken={activeProblemsReloadKey} />
        <VitalsWidget patientId={patientId.trim()} reloadToken={vitalsReloadKey} onNavigate={handleQuickNavigate} />
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="h-40 animate-pulse rounded-xl bg-gray-100 lg:col-span-5" />
          <div className="h-40 animate-pulse rounded-xl bg-gray-100 lg:col-span-4" />
          <div className="h-40 animate-pulse rounded-xl bg-gray-100 lg:col-span-3" />
        </div>
        <p className="text-center text-xs text-gray-500">Loading patient summary…</p>
      </div>
    );
  }

  if (completeError && !complete) {
    return (
      <div className="patient-summary-root space-y-4 p-6" role="alert">
        <PatientSummaryAllergyBanner patientId={patientId.trim()} onViewDetails={onViewAllergyDetails} />
        <ActiveProblemsPanel patientId={patientId.trim()} reloadToken={activeProblemsReloadKey} />
        <VitalsWidget patientId={patientId.trim()} reloadToken={vitalsReloadKey} onNavigate={handleQuickNavigate} />
        <h2 className="text-lg font-bold text-gray-900">Summary unavailable</h2>
        <p className="mt-2 text-sm text-red-600">{completeError.message}</p>
        <p className="mt-2 text-xs text-gray-500">
          Ensure RPCs such as{" "}
          <code className="rounded bg-gray-100 px-1">get_patient_header_data</code> are deployed. Active problems load
          directly from <code className="rounded bg-gray-100 px-1">active_problems</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="patient-summary-root space-y-6 p-4 sm:p-6">
      <PatientSummaryAllergyBanner patientId={patientId.trim()} onViewDetails={onViewAllergyDetails} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Global patient summary</p>
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

      {timelineError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {timelineError}
        </div>
      )}

      {timelineLoading ? (
        <div className="h-32 animate-pulse rounded-xl bg-gray-100" aria-busy />
      ) : (
        <HealthTimeline nodes={mergedTimelineNodes} onLiveOpdClick={onLiveOpdClick} />
      )}

      {patientId.trim() ? (
        <EncounterHistorySection
          patientId={patientId.trim()}
          currentEncounterId={summaryEncounterId}
          onNavigate={onNavigate}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-span-5">
          <ActiveProblemsPanel patientId={patientId.trim()} reloadToken={activeProblemsReloadKey} />
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Care team</h3>
            {completeLoading ? (
              <div className="mt-3 h-20 animate-pulse rounded-lg bg-gray-100" aria-busy />
            ) : careTeamDoctorLines.length === 0 && careTeamFacilityLines.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No care team on file for this patient.</p>
            ) : (
              <div className="mt-3 space-y-4">
                {careTeamDoctorLines.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Doctors</p>
                    <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 bg-slate-50/50">
                      {careTeamDoctorLines.map((row, i) => (
                        <li key={`care-doc-${i}`} className="px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg">
                          <p className="text-sm font-semibold text-gray-900">{row.title}</p>
                          {row.subtitle ? (
                            <p className="mt-0.5 text-xs text-gray-500">{row.subtitle}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {careTeamFacilityLines.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Hospitals &amp; facilities
                    </p>
                    <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 bg-slate-50/50">
                      {careTeamFacilityLines.map((line, i) => (
                        <li
                          key={`care-fac-${i}`}
                          className="px-3 py-2.5 text-sm font-medium text-gray-800 first:rounded-t-lg last:rounded-b-lg"
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-100 bg-slate-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Allergies &amp; alerts</p>
            <p className="mt-2 text-sm text-gray-600">Link EMR alerts here when available.</p>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-4">
          <ClinicalHighlightsCard
            row={summaryRow}
            loading={summaryLoading}
            error={summaryError}
            onRefreshTimestamp={onRefreshHighlightsTimestamp}
          />
          <VitalsWidget patientId={patientId.trim()} reloadToken={vitalsReloadKey} onNavigate={handleQuickNavigate} />
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-3">
          <CurrentMedicationsCard requests={medicationRequests} loading={completeLoading} error={medicationsError} />
          <SummaryQuickActions patientId={patientId} onNavigate={handleQuickNavigate} />
        </div>
      </div>

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
