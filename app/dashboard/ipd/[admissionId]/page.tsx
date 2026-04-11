"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, FileText, Stethoscope } from "lucide-react";
import { supabase } from "../../../../lib/supabase";
import IpdDailyNotesWorkspace from "./IpdDailyNotesWorkspace";
import { normalizeIpdAdmissionBundle, rpcGetIpdAdmission } from "../../../lib/ipdData";
import { IPD_DEFAULT_HOSPITAL_ID } from "../../../lib/ipdConstants";
import { buildAdmissionCardView } from "../../../lib/ipdAdmissionDisplay";
import IpdAdmissionConsentsTab from "./IpdAdmissionConsentsTab";
import ScheduleSurgeryModal from "./ScheduleSurgeryModal";
import { DischargeSummaryModal } from "../../../components/ipd/discharge-summary-modal";

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

  const [tab, setTab] = useState<"daily" | "consents">("daily");
  const [surgeryModalOpen, setSurgeryModalOpen] = useState(false);
  const [dischargeModalOpen, setDischargeModalOpen] = useState(false);

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
  const hospitalId = s(admissionRow?.hospital_id) || IPD_DEFAULT_HOSPITAL_ID;
  const hasScheduledSurgery = Boolean(s(admissionRow?.surgery_id));

  if (!admissionId) {
    return (
      <div className="bg-white p-8 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-200">
        Invalid admission.
      </div>
    );
  }

  if (loading && !admissionData) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-200">
        Loading inpatient encounter…
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white p-4 text-gray-900 dark:bg-gray-900 dark:text-white sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground dark:text-white sm:text-2xl">
              ⚡ Inpatient Encounter
            </h1>
            <p className="text-xs text-muted-foreground dark:text-gray-200">Ward workflow & daily progress</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-sky-200/80 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400">
              {card.specialtyBadge}
            </span>
            <button
              type="button"
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted dark:border-white/10 dark:bg-tscolors-surface-elevated dark:text-gray-100 dark:hover:bg-tscolors-surface-card"
              onClick={() => {}}
            >
              View Timeline
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-background px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-50 dark:border-purple-500/40 dark:bg-transparent dark:text-purple-300 dark:hover:bg-purple-500/10"
              onClick={() => {}}
            >
              <Stethoscope className="h-3.5 w-3.5" />
              Request Consult
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 dark:bg-purple-600 dark:hover:bg-purple-500"
              onClick={() => setDischargeModalOpen(true)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Discharge Patient
            </button>
          </div>
        </div>

        {loadErr ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200">
            {loadErr}
          </p>
        ) : null}

        {/* Admission card */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:border-white/10 dark:bg-tscolors-surface-card sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground dark:text-white">{card.titleLine}</h2>
              <span className="mt-1 inline-block rounded-full border border-sky-200/80 bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-900 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400">
                {card.specialtyBadge}
              </span>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted dark:border-white/10 dark:bg-tscolors-surface-elevated dark:text-gray-100 dark:hover:bg-tscolors-surface-card"
              onClick={() => {}}
            >
              Edit Header
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground dark:text-gray-300">
                Ward &amp; Bed
              </p>
              <p className="text-sm font-medium text-foreground dark:text-white">{card.wardBed || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground dark:text-gray-300">
                Admission date
              </p>
              <p className="text-sm font-medium text-foreground dark:text-white">{card.admissionDateDisplay}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-wide text-muted-foreground dark:text-gray-300">
                SURGERY DATE
              </p>
              <p className="text-sm font-medium text-foreground dark:text-white">{card.surgeryDateDisplay}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground dark:text-gray-300">
                Allergy status
              </p>
              {card.hasAllergies ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  {card.allergyLabels.map((a, i) => (
                    <span
                      key={`${a}-${i}`}
                      className="inline-flex rounded-full border border-red-500/25 bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-900 dark:bg-red-500/20 dark:text-red-200"
                    >
                      {a}
                    </span>
                  ))}
                </span>
              ) : (
                <p className="inline-flex rounded-full border border-emerald-500/25 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200">
                  No known drug allergies
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground dark:text-gray-300">Chief complaint</p>
              <p className="mt-0.5 leading-relaxed text-foreground dark:text-white">{card.chiefComplaint}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground dark:text-gray-300">
                History of present illness
              </p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground dark:text-gray-200">{card.hpi}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground dark:text-gray-300">
                  Symptom category
                </p>
                <span className="mt-1 inline-block rounded-full border border-white/10 bg-muted px-2 py-0.5 text-xs font-medium text-foreground dark:bg-white/10 dark:text-gray-100">
                  {card.symptomCategory}
                </span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground dark:text-gray-300">Diagnosis</p>
                <p className="mt-0.5 font-medium text-foreground dark:text-white">{card.diagnosis}</p>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground dark:text-gray-300">Baseline exam</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground dark:text-gray-200">{card.baselineExam}</p>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 border-b border-border dark:border-white/10">
            <button
              type="button"
              onClick={() => setTab("daily")}
              className={`relative px-4 py-2 text-sm font-semibold ${
                tab === "daily"
                  ? "text-primary dark:text-white"
                  : "text-muted-foreground hover:text-foreground dark:text-gray-300 dark:hover:text-white"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                Daily Notes
              </span>
              {tab === "daily" ? (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-tscolors-soap-subjective" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setTab("consents")}
              className={`relative px-4 py-2 text-sm font-semibold ${
                tab === "consents"
                  ? "text-primary dark:text-white"
                  : "text-muted-foreground hover:text-foreground dark:text-gray-300 dark:hover:text-white"
              }`}
            >
              Consents
              {pendingMandatoryConsentCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-bold text-slate-950">
                  {pendingMandatoryConsentCount}
                </span>
              ) : null}
              {tab === "consents" ? (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-tscolors-soap-subjective" />
              ) : null}
            </button>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-sky-300 bg-background px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 dark:border-blue-500/35 dark:bg-transparent dark:text-blue-400 dark:hover:bg-blue-500/10"
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
          />
        ) : (
          <div className="rounded-2xl border border-slate-700/80 bg-[#0f172a] p-4 sm:p-6">
            <IpdAdmissionConsentsTab
              admissionId={admissionId}
              hospitalId={hospitalId}
              admissionData={admissionData}
              onRefetchAdmission={refetchAdmissionOnly}
            />
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground dark:text-gray-300">
          <Link href="/dashboard/ipd" className="underline hover:text-foreground dark:hover:text-white">
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
      </div>
    </div>
  );
}
