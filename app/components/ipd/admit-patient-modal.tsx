"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  type BedAvailabilityRow,
  fetchBedAvailability,
  groupBedsByWard,
  unwrapRpcRecord,
} from "@/app/lib/ipdAdmission";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

const ADMISSION_TYPES = ["Elective", "Emergency", "Day Care", "Referral"] as const;
export type AdmissionTypePill = (typeof ADMISSION_TYPES)[number];

/** DB `admit_patient.p_admission_type` — constraint: elective | emergency | daycare | referral | transfer_in */
const ADMISSION_TYPE_DB: Record<AdmissionTypePill, "elective" | "emergency" | "daycare" | "referral"> = {
  Elective: "elective",
  Emergency: "emergency",
  "Day Care": "daycare",
  Referral: "referral",
};

type PractitionerRow = {
  id: string;
  full_name: string;
  specialty: string;
  role: string;
  primary_department_id: string | null;
  /** From `departments` join (`d.name` as department_name). */
  department_name: string | null;
};

function departmentNameFromJoinRow(row: Record<string, unknown>): string | null {
  const dep = row.departments;
  if (dep == null) return null;
  if (Array.isArray(dep)) {
    const d0 = dep[0] as { name?: unknown } | undefined;
    return d0 ? s(d0.name) || null : null;
  }
  if (typeof dep === "object") {
    return s((dep as { name?: unknown }).name) || null;
  }
  return null;
}

function bedRowId(row: BedAvailabilityRow): string {
  return s(row.bed_id ?? row.id);
}

function isBedMaintenance(row: BedAvailabilityRow): boolean {
  const st = s(row.status).toLowerCase();
  return st === "maintenance" || row.maintenance === true;
}

function isBedHeld(row: BedAvailabilityRow): boolean {
  return s(row.status).toLowerCase() === "held";
}

function isBedOccupied(row: BedAvailabilityRow): boolean {
  if (isBedMaintenance(row) || isBedHeld(row)) return false;
  const st = s(row.status).toLowerCase();
  if (st === "occupied") return true;
  if (row.is_available === false || row.available === false) return true;
  if (st === "available" || st === "free" || st === "empty") return false;
  return st === "occupied" || st === "taken";
}

function isBedSelectable(row: BedAvailabilityRow): boolean {
  if (isBedMaintenance(row) || isBedHeld(row)) return false;
  return !isBedOccupied(row);
}

function parseAdmitResult(data: unknown): { admissionId: string; admissionNumber: string } | null {
  const row = unwrapRpcRecord<Record<string, unknown>>(data);
  if (!row) return null;
  const id = s(row.admission_id ?? row.id ?? row.p_admission_id);
  const num = s(row.admission_number ?? row.admission_no ?? row.ipd_number ?? row.number);
  if (!id) return null;
  return { admissionId: id, admissionNumber: num || "—" };
}

export type AdmitPatientModalProps = {
  open: boolean;
  /** When empty, step 1 starts with patient search for this hospital. */
  patientId: string | null;
  hospitalId: string;
  sourceOpdEncounterId?: string;
  preAdmissionAssessmentId?: string;
  /** When set, opens step 2 and selects this available bed once beds load (e.g. from /reception?wardId&bedId). */
  prefillWardId?: string | null;
  prefillBedId?: string | null;
  onSuccess: (admissionId: string, admissionNumber: string) => void;
  onClose: () => void;
};

export function AdmitPatientModal({
  open,
  patientId,
  hospitalId,
  sourceOpdEncounterId,
  preAdmissionAssessmentId,
  prefillWardId = null,
  prefillBedId = null,
  onSuccess,
  onClose,
}: AdmitPatientModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [admissionType, setAdmissionType] = useState<AdmissionTypePill>("Elective");
  const [doctorQuery, setDoctorQuery] = useState("");
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  /** Admitting department — derived from selected practitioner’s `primary_department_id`, not a separate department picker. */
  const [departmentId, setDepartmentId] = useState("");
  const [diagnosisDisplay, setDiagnosisDisplay] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [opdDiagnosisHintVisible, setOpdDiagnosisHintVisible] = useState(false);
  const [expectedDischarge, setExpectedDischarge] = useState("");

  const [practitioners, setPractitioners] = useState<PractitionerRow[]>([]);
  const [patientName, setPatientName] = useState<string | null>(null);
  const [resolvedPatientId, setResolvedPatientId] = useState<string | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<{ id: string; label: string }[]>([]);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [bedRows, setBedRows] = useState<BedAvailabilityRow[]>([]);
  const [bedsLoading, setBedsLoading] = useState(false);
  const [bedError, setBedError] = useState<string | null>(null);
  const [expandedWards, setExpandedWards] = useState<Set<string>>(new Set());

  const [selectedWardId, setSelectedWardId] = useState<string | null>(null);
  const [selectedWardName, setSelectedWardName] = useState("");
  const [selectedBedId, setSelectedBedId] = useState<string | null>(null);
  const [selectedBedNumber, setSelectedBedNumber] = useState("");
  const [selectedBedType, setSelectedBedType] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** When `sourceOpdEncounterId` already has an active IPD admission — blocks step 2+. */
  const [existingOpdAdmission, setExistingOpdAdmission] = useState<{ id: string; admission_number: string } | null>(null);
  const [existingOpdAdmissionCheckLoading, setExistingOpdAdmissionCheckLoading] = useState(false);
  /** Shown after successful admit (pending billing — no navigation to IPD). */
  const [admissionInitiated, setAdmissionInitiated] = useState<{
    admissionNumber: string;
    bedNumber: string;
    wardName: string;
  } | null>(null);
  const prefillBedAppliedRef = useRef(false);

  const reset = useCallback(() => {
    setStep(1);
    setAdmissionType("Elective");
    setDoctorQuery("");
    setDoctorOpen(false);
    setDoctorId("");
    setDepartmentId("");
    setDiagnosisDisplay("");
    setDiagnosisCode("");
    setOpdDiagnosisHintVisible(false);
    setExpectedDischarge("");
    setPractitioners([]);
    setPatientName(null);
    setResolvedPatientId(null);
    setPatientSearch("");
    setPatientResults([]);
    setPatientSearchLoading(false);
    setBedRows([]);
    setBedsLoading(false);
    setBedError(null);
    setExpandedWards(new Set());
    setSelectedWardId(null);
    setSelectedWardName("");
    setSelectedBedId(null);
    setSelectedBedNumber("");
    setSelectedBedType("");
    setSubmitting(false);
    setSubmitError(null);
    setExistingOpdAdmission(null);
    setExistingOpdAdmissionCheckLoading(false);
    setAdmissionInitiated(null);
    prefillBedAppliedRef.current = false;
  }, []);

  const effectivePatientId = (resolvedPatientId ?? patientId ?? "").trim();

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (patientId?.trim()) {
      setResolvedPatientId(patientId.trim());
    }
  }, [open, patientId, reset]);

  useEffect(() => {
    if (!open || !sourceOpdEncounterId?.trim()) return;
    const encId = sourceOpdEncounterId.trim();
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("opd_encounters")
        .select("working_diagnosis, diagnosis_icd10, diagnosis_term")
        .eq("id", encId)
        .maybeSingle();
      if (cancelled) return;
      if (error || data == null) return;
      const row = data as Record<string, unknown>;
      const wd = s(row.working_diagnosis);
      const dt = s(row.diagnosis_term);
      const icd10 = s(row.diagnosis_icd10);
      const primaryDisplay = wd || dt;
      if (primaryDisplay) setDiagnosisDisplay(primaryDisplay);
      if (icd10) setDiagnosisCode(icd10);
      if (primaryDisplay || icd10) {
        setOpdDiagnosisHintVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceOpdEncounterId]);

  useEffect(() => {
    if (!doctorId) {
      setDepartmentId("");
      return;
    }
    const p = practitioners.find((x) => x.id === doctorId);
    setDepartmentId(p?.primary_department_id ? s(p.primary_department_id) : "");
  }, [doctorId, practitioners]);

  useEffect(() => {
    if (!open || !effectivePatientId) return;
    let cancelled = false;
    void (async () => {
      const [{ data: pRow }, { data: prRows }] = await Promise.all([
        supabase
          .from("patients")
          .select("first_name, last_name, full_name")
          .eq("id", effectivePatientId)
          .maybeSingle(),
        supabase
          .from("practitioners")
          .select(
            `
            id,
            full_name,
            role,
            specialty,
            primary_department_id,
            departments!left (
              name
            )
          `.replace(/\s+/g, " "),
          )
          .eq("hospital_id", hospitalId)
          .eq("is_active", true)
          .in("role", ["doctor", "admin"])
          .order("full_name"),
      ]);
      if (cancelled) return;
      const pn = pRow as { first_name?: unknown; last_name?: unknown; full_name?: unknown } | null;
      const name =
        s(pn?.full_name) ||
        [s(pn?.first_name), s(pn?.last_name)].filter(Boolean).join(" ").trim() ||
        null;
      setPatientName(name);
      setPractitioners(
        (prRows ?? []).map((r) => {
          const row = r as unknown as Record<string, unknown>;
          const pd = row.primary_department_id;
          return {
            id: s(row.id),
            full_name: s(row.full_name) || "Doctor",
            specialty: s(row.specialty),
            role: s(row.role),
            primary_department_id: pd == null || pd === "" ? null : s(pd),
            department_name: departmentNameFromJoinRow(row),
          };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, effectivePatientId, hospitalId]);

  useEffect(() => {
    if (!open || !hospitalId || effectivePatientId) {
      setPatientResults([]);
      return;
    }
    const q = patientSearch.trim();
    if (q.length < 2) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    setPatientSearchLoading(true);
    const t = window.setTimeout(() => {
      void (async () => {
        const esc = q.replace(/[%_]/g, "\\$&");
        const pat = `%${esc}%`;
        const { data, error } = await supabase
          .from("patients")
          .select("id, full_name, first_name, last_name, docpad_id")
          .eq("hospital_id", hospitalId)
          .ilike("full_name", pat)
          .limit(15);
        if (cancelled) return;
        setPatientSearchLoading(false);
        if (error) {
          setPatientResults([]);
          return;
        }
        setPatientResults(
          (data ?? []).map((r) => {
            const row = r as {
              id: unknown;
              full_name?: unknown;
              first_name?: unknown;
              last_name?: unknown;
              docpad_id?: unknown;
            };
            const label =
              s(row.full_name) ||
              [s(row.first_name), s(row.last_name)].filter(Boolean).join(" ").trim() ||
              s(row.docpad_id) ||
              "Patient";
            return { id: s(row.id), label };
          }),
        );
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, hospitalId, effectivePatientId, patientSearch]);

  const filteredDoctors = useMemo(() => {
    const q = doctorQuery.trim().toLowerCase();
    if (!q) return practitioners;
    return practitioners.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) || (p.specialty && p.specialty.toLowerCase().includes(q)),
    );
  }, [doctorQuery, practitioners]);

  const selectedDoctor = useMemo(
    () => practitioners.find((p) => p.id === doctorId) ?? null,
    [doctorId, practitioners],
  );

  const wardGroups = useMemo(() => {
    const map = groupBedsByWard(bedRows);
    return Array.from(map.values()).map((w) => {
      const avail = w.beds.filter(isBedSelectable).length;
      return { ...w, availableCount: avail };
    });
  }, [bedRows]);

  useEffect(() => {
    if (!open || step !== 2 || !hospitalId) return;
    let cancelled = false;
    void (async () => {
      setBedsLoading(true);
      setBedError(null);
      try {
        const rows = await fetchBedAvailability(supabase, hospitalId);
        if (cancelled) return;
        setBedRows(rows);
        const firstWid = rows.find((r) => s(r.ward_id))?.ward_id;
        if (firstWid) {
          setExpandedWards(new Set([s(firstWid)]));
        }
      } catch (e: unknown) {
        if (!cancelled) setBedError(e instanceof Error ? e.message : "Could not load beds.");
      } finally {
        if (!cancelled) setBedsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, hospitalId]);

  const toggleWard = (wid: string) => {
    setExpandedWards((prev) => {
      const next = new Set(prev);
      if (next.has(wid)) next.delete(wid);
      else next.add(wid);
      return next;
    });
  };

  const selectBed = useCallback((row: BedAvailabilityRow) => {
    if (!isBedSelectable(row)) return;
    const bid = bedRowId(row);
    if (!bid) return;
    setSelectedWardId(s(row.ward_id));
    setSelectedWardName(s(row.ward_name));
    setSelectedBedId(bid);
    setSelectedBedNumber(s(row.bed_number));
    setSelectedBedType(s(row.bed_type));
  }, []);

  useEffect(() => {
    if (!open) return;
    if (sourceOpdEncounterId?.trim() && existingOpdAdmission) return;
    const pw = prefillWardId?.trim();
    const pb = prefillBedId?.trim();
    if (pw && pb) setStep(2);
  }, [open, prefillWardId, prefillBedId, sourceOpdEncounterId, existingOpdAdmission]);

  /** Block bed selection when this OPD encounter already has an active admission. */
  useEffect(() => {
    if (!open || !sourceOpdEncounterId?.trim()) {
      setExistingOpdAdmission(null);
      setExistingOpdAdmissionCheckLoading(false);
      return;
    }
    const encId = sourceOpdEncounterId.trim();
    let cancelled = false;
    setExistingOpdAdmissionCheckLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("ipd_admissions")
        .select("id, admission_number, status")
        .eq("opd_encounter_id", encId)
        .not("status", "in", "(cancelled,entered-in-error,finished)")
        .maybeSingle();
      if (cancelled) return;
      setExistingOpdAdmissionCheckLoading(false);
      if (error) {
        setExistingOpdAdmission(null);
        return;
      }
      if (data && typeof data === "object") {
        const row = data as { id?: unknown; admission_number?: unknown };
        const id = s(row.id);
        if (id) {
          setExistingOpdAdmission({
            id,
            admission_number: s(row.admission_number) || "—",
          });
          return;
        }
      }
      setExistingOpdAdmission(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceOpdEncounterId]);

  /** If duplicate is detected while on a later step, return to step 1. */
  useEffect(() => {
    if (open && existingOpdAdmission && step > 1) setStep(1);
  }, [open, existingOpdAdmission, step]);

  useEffect(() => {
    if (!open || step !== 2 || bedsLoading || bedError || !bedRows.length) return;
    const pw = prefillWardId?.trim();
    const pb = prefillBedId?.trim();
    if (!pw || !pb || prefillBedAppliedRef.current) return;
    const row = bedRows.find(
      (r) => s(r.ward_id) === pw && bedRowId(r) === pb && isBedSelectable(r),
    );
    if (row) {
      selectBed(row);
      setExpandedWards(new Set([pw]));
      prefillBedAppliedRef.current = true;
    }
  }, [
    open,
    step,
    bedsLoading,
    bedError,
    bedRows,
    prefillWardId,
    prefillBedId,
    selectBed,
  ]);

  const duplicateOpdAdmissionBlocked = Boolean(sourceOpdEncounterId?.trim() && existingOpdAdmission);
  const canGoStep2 = Boolean(
    effectivePatientId &&
      doctorId &&
      !duplicateOpdAdmissionBlocked &&
      !existingOpdAdmissionCheckLoading,
  );
  const canGoStep3 = selectedBedId && selectedWardId;

  const handleConfirm = async () => {
    setSubmitError(null);
    if (!selectedBedId || !selectedWardId || !doctorId) {
      setSubmitError("Select doctor and bed.");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("admit_patient", {
      p_hospital_id: hospitalId,
      p_patient_id: effectivePatientId,
      p_opd_encounter_id: sourceOpdEncounterId ?? null,
      p_admitting_doctor_id: doctorId,
      p_admitting_department_id: departmentId.trim() || null,
      p_ward_id: selectedWardId,
      p_bed_id: selectedBedId,
      p_admission_type: ADMISSION_TYPE_DB[admissionType],
      p_primary_diagnosis_icd10: diagnosisCode.trim() || null,
      p_primary_diagnosis_display: diagnosisDisplay.trim() || null,
      p_pre_admission_assessment_id: preAdmissionAssessmentId ?? null,
    });
    if (error) {
      setSubmitting(false);
      setSubmitError(error.message);
      return;
    }
    const parsed = parseAdmitResult(data);
    if (!parsed) {
      setSubmitting(false);
      setSubmitError("Admission created but response was unexpected. Check IPD list.");
      return;
    }
    onSuccess(parsed.admissionId, parsed.admissionNumber);
    setSubmitting(false);
    setAdmissionInitiated({
      admissionNumber: parsed.admissionNumber,
      bedNumber: selectedBedNumber || "—",
      wardName: selectedWardName || "—",
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className="relative z-10 flex max-h-[min(90vh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">New admission</h2>
            <p className="mt-0.5 text-xs text-gray-600">
              {patientName ? patientName : "Patient"} · Step {step} of 3
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-gray-100 px-5 py-3">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                  step === n
                    ? "bg-blue-600 text-white"
                    : step > n
                      ? "bg-gray-200 text-gray-700"
                      : "bg-gray-200 text-gray-600",
                )}
              >
                {step > n ? <Check className="h-4 w-4" /> : n}
              </div>
              {n < 3 ? (
                <div className="hidden h-px w-8 bg-gray-200 sm:block" aria-hidden />
              ) : null}
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {admissionInitiated ? (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-950">
              <h3 className="text-base font-bold">
                Admission Initiated — {admissionInitiated.admissionNumber}
              </h3>
              <p className="text-sm leading-relaxed">
                Bed {admissionInitiated.bedNumber} in {admissionInitiated.wardName} is reserved. Please direct the patient
                to reception for payment.
              </p>
            </div>
          ) : (
            <>
          {step === 1 ? (
            <div className="space-y-4">
              {duplicateOpdAdmissionBlocked && existingOpdAdmission ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                  <p>
                    This patient is already admitted under{" "}
                    <span className="font-semibold">{existingOpdAdmission.admission_number}</span>. Cannot create a
                    duplicate admission.
                  </p>
                  <Link
                    href={`/ipd/admissions/${encodeURIComponent(existingOpdAdmission.id)}`}
                    className="mt-2 inline-flex items-center text-sm font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
                  >
                    Open IPD File →
                  </Link>
                </div>
              ) : null}
              {!patientId?.trim() && !resolvedPatientId ? (
                <div>
                  <Label className="text-gray-700">Patient</Label>
                  <input
                    type="search"
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder="Search by name or DocPad ID (min. 2 characters)…"
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  />
                  {patientSearchLoading ? (
                    <p className="mt-2 text-xs text-gray-600">Searching…</p>
                  ) : patientResults.length > 0 ? (
                    <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                      {patientResults.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                            onClick={() => {
                              setResolvedPatientId(p.id);
                              setPatientName(p.label);
                              setPatientSearch("");
                              setPatientResults([]);
                            }}
                          >
                            {p.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : patientSearch.trim().length >= 2 ? (
                    <p className="mt-2 text-xs text-gray-600">No patients found.</p>
                  ) : null}
                </div>
              ) : !patientId?.trim() && resolvedPatientId ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-sm font-medium text-gray-900">{patientName ?? "Patient"}</span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-blue-600 hover:underline"
                    onClick={() => {
                      setResolvedPatientId(null);
                      setPatientName(null);
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : null}

              <div>
                <Label className="text-gray-700">Admission type</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ADMISSION_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setAdmissionType(t)}
                      className={cn(
                        "rounded-full border px-4 py-1.5 text-sm font-semibold transition",
                        admissionType === t
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <Label className="text-gray-700">Admitting doctor</Label>
                <button
                  type="button"
                  className={cn(
                    "mt-1.5 flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm",
                    doctorOpen && "ring-2 ring-blue-500/30",
                    selectedDoctor ? "text-gray-900" : "text-gray-500",
                  )}
                  onClick={() => setDoctorOpen((o) => !o)}
                >
                  <span className="truncate">
                    {selectedDoctor ? (
                      <>
                        {selectedDoctor.full_name}
                        {selectedDoctor.specialty ? (
                          <span className="text-gray-600"> · {selectedDoctor.specialty}</span>
                        ) : null}
                      </>
                    ) : (
                      "Search and select…"
                    )}
                  </span>
                  <Search className="h-4 w-4 shrink-0 text-gray-500" />
                </button>
                {doctorOpen ? (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-xl">
                    <div className="border-b border-gray-100 p-2">
                      <input
                        type="search"
                        value={doctorQuery}
                        onChange={(e) => setDoctorQuery(e.target.value)}
                        placeholder="Filter by name or specialty…"
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
                        autoFocus
                      />
                    </div>
                    <ul className="max-h-48 overflow-y-auto py-1">
                      {filteredDoctors.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-gray-600">No matches</li>
                      ) : (
                        filteredDoctors.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                              onClick={() => {
                                setDoctorId(p.id);
                                setDoctorOpen(false);
                                setDoctorQuery("");
                              }}
                            >
                              <span className="font-medium">{p.full_name}</span>
                              {p.specialty ? (
                                <span className="block text-xs text-gray-600">{p.specialty}</span>
                              ) : null}
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : null}
              </div>

              {selectedDoctor ? (
                <div>
                  <span className="text-xs text-gray-500 uppercase">Department</span>
                  <p className="text-sm font-medium text-gray-800">
                    {selectedDoctor.department_name ?? "— Not assigned"}
                  </p>
                </div>
              ) : null}

              <div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-gray-700">Primary diagnosis (display)</Label>
                    <input
                      type="text"
                      value={diagnosisDisplay}
                      onChange={(e) => {
                        setOpdDiagnosisHintVisible(false);
                        setDiagnosisDisplay(e.target.value);
                      }}
                      placeholder="Clinical wording"
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-700">ICD-10 code</Label>
                    <input
                      type="text"
                      value={diagnosisCode}
                      onChange={(e) => {
                        setOpdDiagnosisHintVisible(false);
                        setDiagnosisCode(e.target.value);
                      }}
                      placeholder="e.g. I10"
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                    />
                  </div>
                </div>
                {opdDiagnosisHintVisible ? (
                  <p className="mt-1.5 text-xs text-gray-400">Auto-filled from OPD encounter · edit if needed</p>
                ) : null}
              </div>

              <div>
                <Label className="text-gray-700">Expected discharge (optional)</Label>
                <input
                  type="date"
                  value={expectedDischarge}
                  onChange={(e) => setExpectedDischarge(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3 pb-24">
              {bedsLoading ? (
                <p className="text-sm text-gray-600">Loading bed availability…</p>
              ) : bedError ? (
                <p className="text-sm text-red-600">{bedError}</p>
              ) : wardGroups.length === 0 ? (
                <p className="text-sm text-gray-600">No ward data returned.</p>
              ) : (
                wardGroups.map((ward) => {
                  const wid = ward.wardId;
                  const openW = expandedWards.has(wid);
                  return (
                    <div key={wid} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                      <button
                        type="button"
                        onClick={() => toggleWard(wid)}
                        className="flex w-full items-center justify-between gap-2 bg-gray-50 px-3 py-2.5 text-left"
                      >
                        <span className="font-semibold text-gray-900">
                          {ward.wardName}
                          {ward.wardType ? (
                            <span className="font-normal text-gray-600"> · {ward.wardType}</span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                            {ward.availableCount} available
                          </span>
                          <ChevronDown
                            className={cn("h-4 w-4 text-gray-600 transition", openW ? "rotate-180" : "")}
                            aria-hidden
                          />
                        </span>
                      </button>
                      {openW ? (
                        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4">
                          {ward.beds.map((row) => {
                            const bid = bedRowId(row);
                            const held = isBedHeld(row);
                            const occ = isBedOccupied(row);
                            const maint = isBedMaintenance(row);
                            const sel = bid && selectedBedId === bid;
                            const clickable = isBedSelectable(row);
                            return (
                              <button
                                key={bid || `${wid}-${s(row.bed_number)}`}
                                type="button"
                                disabled={!clickable}
                                onClick={() => selectBed(row)}
                                className={cn(
                                  "relative rounded-lg border px-2 py-2 text-left text-xs transition",
                                  maint
                                    ? "cursor-not-allowed border-amber-200 bg-amber-50 text-amber-900"
                                    : held
                                      ? "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-950"
                                      : occ
                                        ? "cursor-not-allowed border-red-200 bg-red-50 text-red-900"
                                        : "border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300",
                                  sel && "ring-2 ring-blue-500",
                                )}
                              >
                                {sel ? (
                                  <span className="absolute right-1 top-1 text-blue-600">
                                    <Check className="h-4 w-4" />
                                  </span>
                                ) : null}
                                <p className="font-semibold">{s(row.bed_number) || "—"}</p>
                                <p className="text-[11px] opacity-80">{s(row.bed_type) || "Bed"}</p>
                                {maint ? <p className="mt-1 font-medium">Maintenance</p> : null}
                                {held ? <p className="mt-1 font-medium">Reserved</p> : null}
                                {occ ? <p className="mt-1 font-medium">Occupied</p> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-gray-600">Patient</dt>
                    <dd className="font-semibold text-gray-900">{patientName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-600">Type</dt>
                    <dd className="text-gray-900">{admissionType}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-600">Doctor</dt>
                    <dd className="text-gray-900">{selectedDoctor?.full_name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-600">Department</dt>
                    <dd className="text-gray-900">{selectedDoctor?.department_name ?? "— Not assigned"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-gray-600">Diagnosis</dt>
                    <dd className="text-gray-900">
                      {diagnosisDisplay || "—"}
                      {diagnosisCode ? (
                        <span className="text-gray-600"> ({diagnosisCode})</span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-gray-600">Ward / bed</dt>
                    <dd className="font-medium text-gray-900">
                      {selectedWardName} — Bed {selectedBedNumber} ({selectedBedType || "—"})
                    </dd>
                  </div>
                  {expectedDischarge ? (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium text-gray-600">Expected discharge</dt>
                      <dd className="text-gray-900">{expectedDischarge}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                After confirming, the patient will be sent to reception for admission deposit collection. The bed will be
                allocated once payment is received.
              </div>

              {submitError ? (
                <p className="text-sm text-red-600">{submitError}</p>
              ) : null}
            </div>
          ) : null}
            </>
          )}
        </div>

        {step === 2 && selectedBedId && !admissionInitiated ? (
          <div className="sticky bottom-0 border-t border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-900 backdrop-blur">
            Selected: {selectedWardName} — Bed {selectedBedNumber} ({selectedBedType || "—"})
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-5 py-4">
          <div className="flex gap-2">
            {step > 1 && !admissionInitiated ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
                disabled={submitting}
              >
                Back
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            {step === 1 ? (
              <Button type="button" onClick={() => setStep(2)} disabled={!canGoStep2}>
                {existingOpdAdmissionCheckLoading ? "Checking…" : "Continue"}
              </Button>
            ) : null}
            {step === 2 ? (
              <Button type="button" onClick={() => setStep(3)} disabled={!canGoStep3}>
                Review
              </Button>
            ) : null}
            {step === 3 && !admissionInitiated ? (
              <Button type="button" onClick={handleConfirm} disabled={submitting}>
                {submitting ? "Confirming…" : "Confirm admission"}
              </Button>
            ) : null}
            {admissionInitiated ? (
              <Button
                type="button"
                onClick={() => {
                  setAdmissionInitiated(null);
                  onClose();
                }}
              >
                Done
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
