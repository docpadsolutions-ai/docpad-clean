"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, FileText, Pill, Stethoscope } from "lucide-react";
import { supabase } from "../../../../lib/supabase";
import IpdDailyNotesWorkspace from "./IpdDailyNotesWorkspace";
import { normalizeIpdAdmissionBundle, rpcGetIpdAdmission } from "../../../lib/ipdData";
import { IPD_DEFAULT_HOSPITAL_ID } from "../../../lib/ipdConstants";
import { buildAdmissionCardView } from "../../../lib/ipdAdmissionDisplay";
import IpdAdmissionConsentsTab from "./IpdAdmissionConsentsTab";
import IpdTreatmentsTab from "./IpdTreatmentsTab";
import ScheduleSurgeryModal from "./ScheduleSurgeryModal";
import { DischargeSummaryModal } from "../../../components/ipd/discharge-summary-modal";
import { RequestConsultModal } from "../../../components/ipd/RequestConsultModal";
import { DiagnosisWithIcd } from "../../../components/clinical/DiagnosisWithIcd";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export default function IpdAdmissionPage() {
  const params = useParams();
  const admissionId = typeof params?.admissionId === "string" ? params.admissionId : "";

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [admissionData, setAdmissionData] = useState<Record<string, unknown> | null>(null);

  const [tab, setTab] = useState<"daily" | "treatments" | "consents">("daily");
  const [surgeryModalOpen, setSurgeryModalOpen] = useState(false);
  const [dischargeModalOpen, setDischargeModalOpen] = useState(false);
  const [consultModalOpen, setConsultModalOpen] = useState(false);
  const [consultRefreshKey, setConsultRefreshKey] = useState(0);

  const reloadAdmissionBundle = useCallback(async () => {
    if (!admissionId) return;
    setLoading(true);
    setLoadErr(null);
    try {
      const { data: raw, error: e1 } = await rpcGetIpdAdmission(supabase, admissionId);
      if (e1) throw e1;
      setAdmissionData(normalizeIpdAdmissionBundle(raw));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load admission");
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  /** Refresh `get_ipd_admission` only (no full-page loading) — used by daily notes. */
  const refetchAdmissionOnly = useCallback(async () => {
    if (!admissionId) return;
    const { data: raw, error } = await rpcGetIpdAdmission(supabase, admissionId);
    if (error) {
      setLoadErr(error.message);
      return;
    }
    setAdmissionData(normalizeIpdAdmissionBundle(raw));
  }, [admissionId]);

  useEffect(() => {
    void reloadAdmissionBundle();
  }, [reloadAdmissionBundle]);

  /** Pending mandatory consents only — badge hidden at 0 */
  const pendingMandatoryConsentCount = useMemo(() => {
    const list = admissionData?.consents;
    if (!Array.isArray(list)) return 0;
    return (list as Record<string, unknown>[]).filter((c) => {
      if (!Boolean(c.is_mandatory ?? c.mandatory)) return false;
      const st = s(c.status).toLowerCase();
      const pending = st !== "signed" && st !== "obtained" && st !== "completed" && st !== "waived";
      return pending;
    }).length;
  }, [admissionData]);

  const mergedAdmissionForCard = useMemo(() => {
    if (!admissionData) return null;
    const adm = asRec(admissionData.admission) ?? {};
    return {
      ...adm,
      patient: admissionData.patient,
      pre_admission: admissionData.pre_admission,
      ward: admissionData.ward,
      bed: admissionData.bed,
    } as Record<string, unknown>;
  }, [admissionData]);

  const card = useMemo(() => buildAdmissionCardView(mergedAdmissionForCard), [mergedAdmissionForCard]);

  const admissionRow = asRec(admissionData?.admission);
  const patientRow = asRec(admissionData?.patient);
  const hospitalId = s(admissionRow?.hospital_id) || IPD_DEFAULT_HOSPITAL_ID;
  const patientId = s(admissionRow?.patient_id) || s(patientRow?.id);
  const hasScheduledSurgery = Boolean(s(admissionRow?.surgery_id));

  if (!admissionId) {
    return (
      <div className="bg-white p-8 text-sm text-gray-900">
        Invalid admission.
      </div>
    );
  }

  if (loading && !admissionData) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-white text-gray-900">
        Loading inpatient encounter…
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white p-4 text-gray-900 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              ⚡ Inpatient Encounter
            </h1>
            <p className="text-xs text-muted-foreground">Ward workflow & daily progress</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-sky-200/80 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900">
              {card.specialtyBadge}
            </span>
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
              onClick={() => {}}
            >
              View Timeline
            </button>
            <button
              type="button"
              disabled={!patientId}
              title={!patientId ? "Patient linkage required for consult requests" : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-background px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setConsultModalOpen(true)}
            >
              <Stethoscope className="h-3.5 w-3.5" />
              Request Consult
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500"
              onClick={() => setDischargeModalOpen(true)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Discharge Patient
            </button>
          </div>
        </div>

        {loadErr ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {loadErr}
          </p>
        ) : null}

        {/* Admission card */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">{card.titleLine}</h2>
              <span className="mt-1 inline-block rounded-full border border-sky-200/80 bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-900">
                {card.specialtyBadge}
              </span>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
              onClick={() => {}}
            >
              Edit Header
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Ward &amp; Bed
              </p>
              <p className="text-sm font-medium text-foreground">{card.wardBed || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Admission date
              </p>
              <p className="text-sm font-medium text-foreground">{card.admissionDateDisplay}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-wide text-muted-foreground">
                SURGERY DATE
              </p>
              <p className="text-sm font-medium text-foreground">{card.surgeryDateDisplay}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Allergy status
              </p>
              {card.hasAllergies ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  {card.allergyLabels.map((a, i) => (
                    <span
                      key={`${a}-${i}`}
                      className="inline-flex rounded-full border border-red-500/25 bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-900"
                    >
                      {a}
                    </span>
                  ))}
                </span>
              ) : (
                <p className="inline-flex rounded-full border border-emerald-500/25 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                  No known drug allergies
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Chief complaint</p>
              <p className="mt-0.5 leading-relaxed text-foreground">{card.chiefComplaint}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">
                History of present illness
              </p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">{card.hpi}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  Symptom category
                </p>
                <span className="mt-1 inline-block rounded-full border border-white/10 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                  {card.symptomCategory}
                </span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground">Diagnosis</p>
                <p className="mt-0.5 text-foreground">
                  <DiagnosisWithIcd text={card.diagnosis} icd10={card.diagnosisIcd10} />
                </p>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Baseline exam</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">{card.baselineExam}</p>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 border-b border-border">
            <button
              type="button"
              onClick={() => setTab("daily")}
              className={`relative px-4 py-2 text-sm font-semibold ${
                tab === "daily"
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                Daily Notes
              </span>
              {tab === "daily" ? (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setTab("treatments")}
              className={`relative px-4 py-2 text-sm font-semibold ${
                tab === "treatments"
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Pill className="h-4 w-4" />
                Treatments
              </span>
              {tab === "treatments" ? (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setTab("consents")}
              className={`relative px-4 py-2 text-sm font-semibold ${
                tab === "consents"
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Consents
              {pendingMandatoryConsentCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-bold text-slate-950">
                  {pendingMandatoryConsentCount}
                </span>
              ) : null}
              {tab === "consents" ? (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              ) : null}
            </button>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-sky-300 bg-background px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50"
            onClick={() => setSurgeryModalOpen(true)}
          >
            <Calendar className="h-3.5 w-3.5" />
            {hasScheduledSurgery ? "Edit Surgery ✏" : "Schedule Surgery"}
          </button>
        </div>

        {tab === "daily" ? (
          <IpdDailyNotesWorkspace
            admissionId={admissionId}
            hospitalId={hospitalId}
            admissionData={admissionData}
            onRefetchAdmission={refetchAdmissionOnly}
            consultRefreshKey={consultRefreshKey}
          />
        ) : tab === "treatments" ? (
          patientId ? (
            <IpdTreatmentsTab
              admissionId={admissionId}
              hospitalId={hospitalId}
              patientId={patientId}
              admissionData={admissionData}
              onRefetchAdmission={refetchAdmissionOnly}
            />
          ) : (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
              Patient linkage is missing for this admission. Treatments cannot be recorded.
            </p>
          )
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
            <IpdAdmissionConsentsTab
              admissionId={admissionId}
              hospitalId={hospitalId}
              admissionData={admissionData}
              onRefetchAdmission={refetchAdmissionOnly}
            />
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          <Link href="/dashboard/ipd" className="underline hover:text-foreground">
            Back to IPD
          </Link>
        </p>

        <ScheduleSurgeryModal
          open={surgeryModalOpen}
          onOpenChange={setSurgeryModalOpen}
          admissionId={admissionId}
          hospitalId={hospitalId}
          admissionData={admissionData}
          onScheduled={refetchAdmissionOnly}
        />

        <DischargeSummaryModal
          isOpen={dischargeModalOpen}
          admissionId={admissionId}
          admissionData={admissionData}
          onClose={() => setDischargeModalOpen(false)}
          onDischarged={() => {
            setDischargeModalOpen(false);
            void reloadAdmissionBundle();
          }}
        />

        <RequestConsultModal
          open={consultModalOpen && Boolean(patientId)}
          onClose={() => setConsultModalOpen(false)}
          hospitalId={hospitalId}
          admissionId={admissionId}
          patientId={patientId || ""}
          progressNoteId={null}
          onSubmitted={() => {
            setConsultRefreshKey((k) => k + 1);
            void refetchAdmissionOnly();
          }}
        />
      </div>
    </div>
  );
}
