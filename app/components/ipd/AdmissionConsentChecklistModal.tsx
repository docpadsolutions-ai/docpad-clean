"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../../lib/supabase";
import { IPD_ADMISSION_CONSENT_CATALOG } from "./ipdConsentCatalog";
import { devBypassIpdConsents, IPD_DEFAULT_HOSPITAL_ID } from "../../lib/ipdConstants";
import {
  duplicateActiveAdmissionMessage,
  linkPreAdmissionAssessmentToAdmission,
  parseFirstWardBedFromAvailability,
  rpcAdmitPatient,
} from "../../lib/ipdData";
import { personInitialsDisplay } from "../../lib/personInitialsDisplay";
import RequestCustomConsentModal, { type CustomConsentFormPayload } from "./RequestCustomConsentModal";

export type AdmissionConsentChecklistModalProps = {
  open: boolean;
  onClose: () => void;
  /** Navigates to new IPD encounter after successful admit */
  onAdmitted: (admissionId: string) => void;
  patientName: string;
  patientAgeYears: number | null;
  patientSex: string | null;
  docpadId: string | null;
  wardBedLabel: string;
  diagnosisLine: string;
  opdEncounterId: string;
  patientId: string;
  /** Current user's `practitioners.id` — required for admit_patient */
  admittingDoctorId: string;
  hospitalId?: string;
  /** After pre-admission "Save Progress" */
  preAdmissionAssessmentId?: string | null;
  pPrimaryDiagnosisIcd10?: string | null;
  pPrimaryDiagnosisDisplay?: string | null;
};

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return personInitialsDisplay(p[0].slice(0, 2));
  return personInitialsDisplay(p[0][0] + p[p.length - 1][0]);
}

export default function AdmissionConsentChecklistModal({
  open,
  onClose,
  onAdmitted,
  patientName,
  patientAgeYears,
  patientSex,
  docpadId,
  wardBedLabel,
  diagnosisLine,
  opdEncounterId,
  patientId,
  admittingDoctorId,
  hospitalId = IPD_DEFAULT_HOSPITAL_ID,
  preAdmissionAssessmentId = null,
  pPrimaryDiagnosisIcd10 = null,
  pPrimaryDiagnosisDisplay = null,
}: AdmissionConsentChecklistModalProps) {
  const bypass = devBypassIpdConsents();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Local “obtained” flags for UI before rows exist in DB */
  const [localObtained, setLocalObtained] = useState<Record<string, boolean>>({});
  const [wardLabel, setWardLabel] = useState(wardBedLabel);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [stagedCustomConsents, setStagedCustomConsents] = useState<CustomConsentFormPayload[]>([]);

  useEffect(() => {
    setWardLabel(wardBedLabel);
  }, [wardBedLabel]);

  useEffect(() => {
    if (!open) {
      setLocalObtained({});
      setErr(null);
      setStagedCustomConsents([]);
      setCustomModalOpen(false);
      return;
    }
    void (async () => {
      const { data, error } = await supabase.rpc("get_bed_availability", {
        p_hospital_id: hospitalId,
      });
      if (error || data == null) return;
      const first = parseFirstWardBedFromAvailability(data);
      if (first?.label) setWardLabel(first.label);
    })();
  }, [open, hospitalId]);

  const completedCount = useMemo(() => {
    return IPD_ADMISSION_CONSENT_CATALOG.filter((c) => localObtained[c.key]).length;
  }, [localObtained]);

  const mandatoryOk = useMemo(() => {
    if (bypass) return true;
    return IPD_ADMISSION_CONSENT_CATALOG.filter((c) => c.mandatory).every((c) => localObtained[c.key]);
  }, [bypass, localObtained]);

  const handleComplete = useCallback(async () => {
    setErr(null);
    if (!mandatoryOk && !bypass) {
      setErr("Complete all mandatory consents or enable dev bypass.");
      return;
    }
    if (!admittingDoctorId.trim()) {
      setErr("Practitioner profile not loaded — cannot admit (admitting doctor id missing).");
      return;
    }
    setBusy(true);
    try {
      const { admissionId, error, duplicateActiveAdmission } = await rpcAdmitPatient(supabase, {
        p_hospital_id: hospitalId,
        p_patient_id: patientId,
        p_opd_encounter_id: opdEncounterId,
        p_admitting_doctor_id: admittingDoctorId.trim(),
        p_admitting_department_id: null,
        p_admission_type: "elective",
        p_primary_diagnosis_icd10: pPrimaryDiagnosisIcd10,
        p_primary_diagnosis_display: pPrimaryDiagnosisDisplay,
        p_pre_admission_assessment_id: preAdmissionAssessmentId?.trim() || undefined,
      });
      if (duplicateActiveAdmission) {
        const dupId = duplicateActiveAdmission.id;
        toast.warning("Already admitted", {
          description: duplicateActiveAdmissionMessage(duplicateActiveAdmission.admissionNumber),
          ...(dupId
            ? {
                action: {
                  label: "Open in IPD",
                  onClick: () => {
                    window.location.assign(`/ipd/admissions/${encodeURIComponent(dupId)}`);
                  },
                },
              }
            : {}),
        });
        onClose();
        return;
      }
      if (error || !admissionId) {
        setErr(error?.message ?? "Admission failed");
        return;
      }
      const preId = preAdmissionAssessmentId?.trim();
      if (preId) {
        const { error: linkErr } = await linkPreAdmissionAssessmentToAdmission(
          supabase,
          admissionId,
          preId,
        );
        if (linkErr) {
          setErr(linkErr.message);
          return;
        }
      }
      for (const c of stagedCustomConsents) {
        const notesParts: string[] = [];
        if (c.clinicalReason.trim()) notesParts.push(`Clinical reason: ${c.clinicalReason.trim()}`);
        const { error: ce } = await supabase.from("ipd_consents").insert({
          hospital_id: hospitalId,
          admission_id: admissionId,
          patient_id: patientId,
          consent_type: "custom",
          is_custom: true,
          custom_title: c.customTitle.trim(),
          custom_description: c.customDescription.trim(),
          status: "pending",
          requested_by: admittingDoctorId.trim(),
          requested_at: new Date().toISOString(),
          notes: notesParts.length ? notesParts.join("\n") : null,
          fhir_json: { urgency: c.urgency },
        });
        if (ce) {
          setErr(ce.message);
          return;
        }
      }
      onAdmitted(admissionId);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [
    admittingDoctorId,
    bypass,
    hospitalId,
    mandatoryOk,
    onAdmitted,
    onClose,
    opdEncounterId,
    patientId,
    pPrimaryDiagnosisDisplay,
    pPrimaryDiagnosisIcd10,
    preAdmissionAssessmentId,
    stagedCustomConsents,
    patientId,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        className="relative flex max-h-[min(92vh,840px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        role="dialog"
        aria-labelledby="ipd-admit-modal-title"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <h2 id="ipd-admit-modal-title" className="text-sm font-bold uppercase tracking-wide">
            Admission consent checklist
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {bypass ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            <span className="mr-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-950 dark:bg-amber-800 dark:text-amber-50">
              Dev mode
            </span>
            Consent requirements bypassed for development. Set{" "}
            <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">NEXT_PUBLIC_DEV_BYPASS_CONSENTS=false</code>{" "}
            to re-enable.
          </div>
        ) : null}

        <div className="overflow-y-auto px-5 py-4">
          {err ? (
            <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              {err}
            </p>
          ) : null}

          <div className="rounded-xl border border-sky-200/80 bg-sky-50/80 p-4 dark:border-sky-900/50 dark:bg-sky-950/30">
            <div className="flex gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
                {initials(patientName)}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{patientName || "Patient"}</p>
                <p className="text-xs text-muted-foreground">
                  {patientAgeYears != null ? `${patientAgeYears}Y` : "—"}
                  {patientSex ? ` / ${patientSex}` : ""}
                  {docpadId ? ` • ${docpadId}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Admitting to: <span className="font-medium text-foreground">{wardLabel}</span>
                </p>
                {diagnosisLine ? (
                  <p className="mt-1 text-xs">
                    <span className="text-muted-foreground">Diagnosis:</span>{" "}
                    <span className="font-medium text-foreground">{diagnosisLine}</span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Mandatory consents
              </h3>
              <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">Required</span>
            </div>
            <ul className="space-y-2">
              {IPD_ADMISSION_CONSENT_CATALOG.map((c) => (
                <li
                  key={c.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        c.mandatory ? "bg-red-500" : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">{c.name}</p>
                      {c.description ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{c.description}</p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setLocalObtained((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      localObtained[c.key]
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                        : "border-primary text-primary hover:bg-primary/5"
                    }`}
                  >
                    {localObtained[c.key] ? "Recorded" : "Obtain consent"}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <details className="mt-5 rounded-xl border border-dashed border-amber-200/80 bg-amber-50/40 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/20">
            <summary className="cursor-pointer list-none text-sm font-medium text-amber-950 hover:underline dark:text-amber-100 [&::-webkit-details-marker]:hidden">
              Need an additional consent? → + Add Custom Consent
            </summary>
            <div className="mt-3 space-y-2 pb-1">
              {stagedCustomConsents.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Optional. Request a hospital-specific consent; it will be saved when you complete admission.
                </p>
              ) : (
                <ul className="space-y-2">
                  {stagedCustomConsents.map((c, idx) => (
                    <li
                      key={`${c.customTitle}-${idx}`}
                      className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{c.customTitle}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{c.customDescription}</p>
                        <p className="mt-1 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                          {c.urgency === "urgent" ? "Urgent" : "Routine"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() =>
                          setStagedCustomConsents((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setCustomModalOpen(true)}
                className="w-full rounded-lg border border-amber-300/80 bg-white px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100/80 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50 dark:hover:bg-amber-900/50"
              >
                + Add Custom Consent
              </button>
            </div>
          </details>

          <RequestCustomConsentModal
            open={customModalOpen}
            onClose={() => setCustomModalOpen(false)}
            mode="stage"
            onStage={(payload) => setStagedCustomConsents((prev) => [...prev, payload])}
          />

          <div className="mt-4">
            <div className="mb-1 flex gap-0.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-sm ${
                    i < completedCount ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Progress: {completedCount} of 6 consents completed
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || (!mandatoryOk && !bypass) || !admittingDoctorId.trim()}
            onClick={() => void handleComplete()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Working…" : "Complete admission ✓"}
          </button>
        </div>
      </div>
    </div>
  );
}
