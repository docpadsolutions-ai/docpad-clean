"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Resolver, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { fetchHospitalIdFromPractitionerAuthId } from "@/lib/authOrg";
import {
  patientIdsWithSimilarNamePeer,
  similarFullNamesToSelected,
  similarPatientNamesWarningBody,
} from "@/lib/patientNameSimilarity";
import { useToast } from "@/components/ui/toast-provider";
import { composePreauthClinicalSummary } from "@/lib/buildEncounterClinicalSummary";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function numFromInput(v: unknown): number {
  if (v === "" || v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const procedureRowSchema = z.object({
  procedureName: z.string(),
  snomedCode: z.string(),
  estimatedCost: z.number().min(0),
});

const diagnosisRowSchema = z.object({
  icd10Code: z.string(),
  description: z.string(),
});

const preauthFormSchema = z.object({
  patientId: z.string().min(1, "Select a patient").uuid("Select a patient"),
  coverageId: z.string().default(""),
  encounterId: z.string().default(""),
  estimatedAmount: z.number().min(0),
  clinicalSummary: z.string().max(50000).default(""),
  procedures: z.array(procedureRowSchema),
  diagnoses: z.array(diagnosisRowSchema),
});

export type PreauthFormValues = z.infer<typeof preauthFormSchema>;

type CoverageRpcRow = {
  coverage_id: string;
  insurance_company_id: string | null;
  policy_number: string;
  insurance_company_name: string;
  tpa_name: string;
  sum_insured: number;
  balance: number;
  valid_until: string | null;
};

type EncounterOpt = {
  id: string;
  encounter_date: string | null;
  created_at: string | null;
  diagnosis_term: string | null;
  diagnosis_icd10: string | null;
};

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function buildProceduresJson(rows: PreauthFormValues["procedures"]): Record<string, unknown>[] {
  return rows
    .filter((r) => r.procedureName.trim() !== "" || r.snomedCode.trim() !== "" || r.estimatedCost > 0)
    .map((r) => ({
      procedure_name: r.procedureName.trim(),
      snomed_code: r.snomedCode.trim() || null,
      estimated_cost: r.estimatedCost,
    }));
}

function buildDiagnosisJson(rows: PreauthFormValues["diagnoses"]): Record<string, unknown>[] {
  return rows
    .filter((r) => r.icd10Code.trim() !== "" || r.description.trim() !== "")
    .map((r) => ({
      icd10_code: r.icd10Code.trim(),
      description: r.description.trim() || null,
    }));
}

function parseProceduresJson(raw: unknown): PreauthFormValues["procedures"] {
  if (!Array.isArray(raw) || raw.length === 0) return [{ procedureName: "", snomedCode: "", estimatedCost: 0 }];
  return raw.map((item) => {
    const o = item as Record<string, unknown>;
    return {
      procedureName: String(o.procedure_name ?? o.procedureName ?? ""),
      snomedCode: String(o.snomed_code ?? o.snomedCode ?? ""),
      estimatedCost: n(o.estimated_cost ?? o.estimatedCost ?? 0),
    };
  });
}

function parseDiagnosisJson(raw: unknown): PreauthFormValues["diagnoses"] {
  if (!Array.isArray(raw) || raw.length === 0) return [{ icd10Code: "", description: "" }];
  return raw.map((item) => {
    const o = item as Record<string, unknown>;
    return {
      icd10Code: String(o.icd10_code ?? o.icd10Code ?? ""),
      description: String(o.description ?? ""),
    };
  });
}

function parseDiagnosisFromEncounter(enc: Record<string, unknown>): PreauthFormValues["diagnoses"] {
  const icdRaw = enc.diagnosis_icd10 != null ? String(enc.diagnosis_icd10) : "";
  const termRaw = enc.diagnosis_term != null ? String(enc.diagnosis_term) : "";
  const icds = icdRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const terms = termRaw.split(",").map((s) => s.trim()).filter(Boolean);

  if (icds.length === 0 && terms.length === 0) {
    const wd = enc.working_diagnosis != null ? String(enc.working_diagnosis).trim() : "";
    if (wd) return [{ icd10Code: "", description: wd }];
    return [{ icd10Code: "", description: "" }];
  }

  const count = Math.max(icds.length, terms.length);
  const rows: PreauthFormValues["diagnoses"] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ icd10Code: icds[i] ?? "", description: terms[i] ?? "" });
  }
  return rows;
}

function parseProceduresFromEncounter(enc: Record<string, unknown>): PreauthFormValues["procedures"] {
  const raw = enc.plan_procedures_snomed;
  if (raw == null) {
    const plain = enc.plan_procedures != null ? String(enc.plan_procedures) : "";
    if (!plain.trim()) return [{ procedureName: "", snomedCode: "", estimatedCost: 0 }];
    return plain.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ procedureName: name, snomedCode: "", estimatedCost: 0 }));
  }
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { /* ignore */ } }
  if (!Array.isArray(arr) || arr.length === 0) return [{ procedureName: "", snomedCode: "", estimatedCost: 0 }];
  return arr.map((item) => {
    if (typeof item === "string") return { procedureName: item, snomedCode: "", estimatedCost: 0 };
    const o = item as Record<string, unknown>;
    return {
      procedureName: String(o.name ?? o.procedure_name ?? o.display ?? ""),
      snomedCode: String(o.code ?? o.snomed_code ?? o.snomedCode ?? ""),
      estimatedCost: 0,
    };
  });
}

function formatEncounterLabel(e: EncounterOpt): string {
  const dateStr = e.encounter_date ?? e.created_at?.slice(0, 10) ?? "—";
  let label = dateStr;
  try {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) label = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { /* use raw */ }
  const dx = e.diagnosis_term?.trim();
  const icd = e.diagnosis_icd10?.trim();
  if (dx) label += ` — ${dx}`;
  if (icd) label += ` (ICD: ${icd.split(",")[0]})`;
  return label;
}

const sectionHeader = "text-lg font-semibold text-slate-900 dark:text-white";
const formLabel = "mb-1.5 block text-sm font-medium text-slate-800 dark:text-gray-200";
const formControl =
  "border border-gray-700 bg-gray-800 text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:[&_[data-placeholder]]:text-gray-500";
const helperText = "text-sm text-slate-600 dark:text-gray-400";
const valueText = "text-slate-900 dark:text-white";
const tableHeaderBar =
  "mb-2 hidden gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs font-medium uppercase text-slate-700 sm:grid sm:items-center dark:bg-gray-800 dark:text-gray-400";
const insCard = "shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:shadow-none";
const insSecondaryBtn =
  "border border-gray-700 bg-gray-800 text-white hover:bg-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700";
const insErrorBanner = "rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-red-400";
const insSelectContent = "border border-gray-700 bg-gray-900 text-white";
const metaLabel = "text-sm font-medium text-slate-600 dark:text-gray-200";

export type PreauthFormVariant = "create" | "edit" | "view";

export function PreauthForm({
  variant,
  preauthId,
  title,
  description,
}: {
  variant: PreauthFormVariant;
  preauthId?: string | null;
  title: string;
  description?: string;
}) {
  const { toast: appToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const readOnly = variant === "view";
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientOptions, setPatientOptions] = useState<{ id: string; full_name: string }[]>([]);
  const [pickFlashId, setPickFlashId] = useState<string | null>(null);
  const [patientLabel, setPatientLabel] = useState("");
  const [coverages, setCoverages] = useState<CoverageRpcRow[]>([]);
  const [coveragesLoading, setCoveragesLoading] = useState(false);
  const [encounters, setEncounters] = useState<EncounterOpt[]>([]);
  const [encountersLoading, setEncountersLoading] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const urlEncounterBootstrappedRef = useRef<string | null>(null);
  const urlAdmissionBootstrappedRef = useRef<string | null>(null);
  const pendingCoverageIdRef = useRef<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(variant !== "create");
  const [detailError, setDetailError] = useState<string | null>(null);

  const form = useForm<PreauthFormValues>({
    resolver: zodResolver(preauthFormSchema) as Resolver<PreauthFormValues>,
    defaultValues: {
      patientId: "",
      coverageId: "",
      encounterId: "",
      estimatedAmount: 0,
      clinicalSummary: "",
      procedures: [{ procedureName: "", snomedCode: "", estimatedCost: 0 }],
      diagnoses: [{ icd10Code: "", description: "" }],
    },
  });

  const { register, control, handleSubmit, watch, setValue, reset, formState: { errors } } = form;

  const procFields = useFieldArray({ control, name: "procedures" });
  const dxFields = useFieldArray({ control, name: "diagnoses" });

  const patientId = watch("patientId");
  const coverageIdWatch = watch("coverageId");
  const encounterIdWatch = watch("encounterId");

  const patientSearchSimilarIds = useMemo(
    () =>
      patientIdsWithSimilarNamePeer(
        patientOptions.map((o) => ({ id: o.id, fullName: o.full_name ?? "" })),
      ),
    [patientOptions],
  );

  const selectPatient = useCallback(
    (id: string, label: string, opts?: { encounterId?: string }) => {
      if (variant === "create") {
        draftIdRef.current = null;
        setDraftId(null);
      }
      setPatientLabel(label);
      setPatientSearch(label);
      setPatientOptions([]);
      setValue("patientId", id, { shouldValidate: true });
      if (opts?.encounterId?.trim()) {
        setValue("encounterId", opts.encounterId.trim());
      } else {
        setValue("encounterId", "");
      }
    },
    [setValue, variant],
  );

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  useEffect(() => {
    if (variant === "create" || !preauthId?.trim()) {
      setDetailLoading(false);
      return;
    }

    void (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const { data, error } = await supabase.rpc("get_preauth_by_id", { p_id: preauthId.trim() });
        if (error) throw new Error(error.message);
        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
        if (!row || row.id == null) {
          throw new Error("Preauthorization not found.");
        }

        if (variant === "edit" && String(row.status ?? "").toLowerCase() !== "draft") {
          router.replace(`/billing/insurance/preauth/${preauthId.trim()}`);
          return;
        }

        const pid = String(row.patient_id ?? "");
        const pname = String(row.patient_full_name ?? "Patient");
        const covId = row.patient_insurance_coverage_id != null ? String(row.patient_insurance_coverage_id) : "";
        pendingCoverageIdRef.current = covId || null;

        setPatientLabel(pname);
        setPatientSearch(pname);
        draftIdRef.current = String(row.id);
        setDraftId(String(row.id));

        reset({
          patientId: pid,
          coverageId: "",
          encounterId: row.encounter_id != null ? String(row.encounter_id) : "",
          estimatedAmount: n(row.estimated_amount ?? row.requested_amount),
          clinicalSummary: row.clinical_summary != null ? String(row.clinical_summary) : "",
          procedures: parseProceduresJson(row.procedures_json),
          diagnoses: parseDiagnosisJson(row.diagnosis_codes_json),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load preauth";
        setDetailError(msg);
        toast.error(msg);
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [variant, preauthId, reset, router]);

  useEffect(() => {
    if (variant !== "create" || !hospitalId) return;
    const eid = searchParams.get("encounterId")?.trim() ?? "";
    if (!eid) {
      urlEncounterBootstrappedRef.current = null;
      return;
    }
    if (urlEncounterBootstrappedRef.current === eid) return;

    void (async () => {
      const { data: enc, error: encErr } = await supabase.from("opd_encounters").select("*").eq("id", eid).maybeSingle();
      if (encErr || !enc) {
        toast.error(encErr?.message ?? "Encounter not found.");
        return;
      }
      const row = enc as Record<string, unknown>;
      const hid = row.hospital_id != null ? String(row.hospital_id) : "";
      if (hid !== hospitalId) {
        toast.error("Encounter is not in your hospital.");
        return;
      }
      const pid = row.patient_id != null ? String(row.patient_id) : "";
      if (!pid) {
        toast.error("Encounter has no patient.");
        return;
      }
      const { data: pat } = await supabase.from("patients").select("full_name").eq("id", pid).maybeSingle();
      const label = pat?.full_name != null && String(pat.full_name).trim() !== "" ? String(pat.full_name).trim() : "Patient";
      selectPatient(pid, label, { encounterId: eid });
      urlEncounterBootstrappedRef.current = eid;
    })();
  }, [hospitalId, searchParams, selectPatient, variant]);

  useEffect(() => {
    if (variant !== "create" || !hospitalId) return;
    const aid = searchParams.get("admissionId")?.trim() ?? "";
    if (!aid) {
      urlAdmissionBootstrappedRef.current = null;
      return;
    }
    if (urlAdmissionBootstrappedRef.current === aid) return;

    void (async () => {
      const { data: adm, error: admErr } = await supabase
        .from("ipd_admissions")
        .select("patient_id, hospital_id")
        .eq("id", aid)
        .maybeSingle();
      if (admErr || !adm) {
        toast.error(admErr?.message ?? "Admission not found.");
        return;
      }
      const row = adm as Record<string, unknown>;
      const hid = row.hospital_id != null ? String(row.hospital_id) : "";
      if (hid !== hospitalId) {
        toast.error("Admission is not in your hospital.");
        return;
      }
      const pid = row.patient_id != null ? String(row.patient_id) : "";
      if (!pid) {
        toast.error("Admission has no patient.");
        return;
      }
      const { data: pat } = await supabase.from("patients").select("full_name").eq("id", pid).maybeSingle();
      const label =
        pat?.full_name != null && String(pat.full_name).trim() !== "" ? String(pat.full_name).trim() : "Patient";
      selectPatient(pid, label, {});
      urlAdmissionBootstrappedRef.current = aid;
    })();
  }, [hospitalId, searchParams, selectPatient, variant]);

  /** Clinical auto-fill from encounter (Task 3) — populates all fields */
  const autoFillRef = useRef<string | null>(null);
  useEffect(() => {
    if (variant !== "create") return;
    const encounterId = encounterIdWatch?.trim() ?? "";
    if (!encounterId || !patientId || !hospitalId) return;
    if (autoFillRef.current === encounterId) return;

    void (async () => {
      autoFillRef.current = encounterId;
      const [{ data, error }, { data: invData }] = await Promise.all([
        supabase.from("opd_encounters").select("*").eq("id", encounterId).maybeSingle(),
        supabase.from("invoices").select("total_amount").eq("encounter_id", encounterId).limit(10),
      ]);
      if (error || !data) return;
      const row = data as Record<string, unknown>;
      if (String(row.patient_id ?? "") !== patientId) return;
      if (String(row.hospital_id ?? "") !== hospitalId) return;

      const summary = composePreauthClinicalSummary(row);
      if (summary) setValue("clinicalSummary", summary);

      const dxRows = parseDiagnosisFromEncounter(row);
      setValue("diagnoses", dxRows);

      const procRows = parseProceduresFromEncounter(row);
      setValue("procedures", procRows);

      const invoiceTotal = ((invData ?? []) as { total_amount: unknown }[]).reduce((acc, r) => acc + n(r.total_amount), 0);
      if (invoiceTotal > 0) setValue("estimatedAmount", invoiceTotal);
    })();
  }, [encounterIdWatch, patientId, hospitalId, setValue, variant]);

  useEffect(() => {
    if (variant !== "create" || readOnly) return;
    if (!hospitalId || patientSearch.trim().length < 2) {
      setPatientOptions([]);
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        const { data } = await supabase
          .from("patients")
          .select("id, full_name")
          .eq("hospital_id", hospitalId)
          .ilike("full_name", `%${patientSearch.trim()}%`)
          .limit(12);
        setPatientOptions(
          ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({
            id: p.id,
            full_name: p.full_name?.trim() ? String(p.full_name) : "—",
          })),
        );
      })();
    }, 250);
    return () => window.clearTimeout(t);
  }, [patientSearch, hospitalId, variant, readOnly]);

  const loadCoverageAndEncounters = useCallback(
    async (pid: string) => {
      if (!hospitalId) {
        setCoverages([]);
        setEncounters([]);
        return;
      }

      setCoveragesLoading(true);
      setEncountersLoading(true);
      setCoverages([]);
      setEncounters([]);
      setValue("coverageId", "");

      try {
        const preferredCov = pendingCoverageIdRef.current;
        const [{ data: covData, error: covErr }, { data: encData, error: encErr }] = await Promise.all([
          supabase.rpc("get_patient_insurance_coverage", { p_patient_id: pid }),
          supabase
            .from("opd_encounters")
            .select("id, encounter_date, created_at, diagnosis_term, diagnosis_icd10")
            .eq("patient_id", pid)
            .eq("hospital_id", hospitalId)
            .order("encounter_date", { ascending: false, nullsFirst: false })
            .limit(10),
        ]);

        if (covErr) throw new Error(covErr.message);
        const rows = ((covData ?? []) as Record<string, unknown>[]).map((r) => ({
          coverage_id: String(r.coverage_id),
          insurance_company_id: r.insurance_company_id != null ? String(r.insurance_company_id) : null,
          policy_number: String(r.policy_number ?? ""),
          insurance_company_name: String(r.insurance_company_name ?? "—"),
          tpa_name: String(r.tpa_name ?? ""),
          sum_insured: n(r.sum_insured),
          balance: n(r.balance),
          valid_until: r.valid_until != null ? String(r.valid_until).slice(0, 10) : null,
        })) as CoverageRpcRow[];
        setCoverages(rows);

        if (preferredCov && rows.some((r) => r.coverage_id === preferredCov)) {
          setValue("coverageId", preferredCov);
          pendingCoverageIdRef.current = null;
        } else if (rows.length === 1) {
          setValue("coverageId", rows[0].coverage_id);
          pendingCoverageIdRef.current = null;
        }

        if (encErr) throw new Error(encErr.message);
        setEncounters(
          ((encData ?? []) as Record<string, unknown>[]).map((e) => ({
            id: String(e.id),
            encounter_date: e.encounter_date != null ? String(e.encounter_date).slice(0, 10) : null,
            created_at: e.created_at != null ? String(e.created_at) : null,
            diagnosis_term: e.diagnosis_term != null ? String(e.diagnosis_term) : null,
            diagnosis_icd10: e.diagnosis_icd10 != null ? String(e.diagnosis_icd10) : null,
          })),
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load patient data");
      } finally {
        setCoveragesLoading(false);
        setEncountersLoading(false);
      }
    },
    [hospitalId, setValue],
  );

  useEffect(() => {
    if (!patientId || !hospitalId) return;
    void loadCoverageAndEncounters(patientId);
  }, [patientId, hospitalId, loadCoverageAndEncounters]);

  const selectedCoverage = useMemo(
    () => coverages.find((c) => c.coverage_id === coverageIdWatch) ?? null,
    [coverages, coverageIdWatch],
  );

  async function runUpsert(values: PreauthFormValues): Promise<string> {
    if (!hospitalId) {
      throw new Error("No hospital context.");
    }
    if (coverages.length > 0 && !values.coverageId?.trim()) {
      throw new Error("Select an insurance policy.");
    }

    const encounterUuid = values.encounterId?.trim() || null;
    if (encounterUuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(encounterUuid)) {
      throw new Error("Invalid encounter selection.");
    }

    const cov = coverages.find((c) => c.coverage_id === values.coverageId?.trim());
    const companyId = cov?.insurance_company_id ?? null;
    const coverageId = values.coverageId?.trim() || null;

    const payload = {
      p_preauth_id: draftIdRef.current,
      p_patient_id: values.patientId,
      p_encounter_id: encounterUuid,
      p_insurance_company_id: companyId,
      p_coverage_id: coverageId,
      p_estimated_amount: values.estimatedAmount,
      p_procedures: buildProceduresJson(values.procedures),
      p_diagnosis: buildDiagnosisJson(values.diagnoses),
      p_clinical_summary: values.clinicalSummary.trim() ? values.clinicalSummary.trim() : null,
    };

    const { data, error } = await supabase.rpc("upsert_preauth_request", payload);
    if (error) throw new Error(error.message);
    const id = data != null ? String(data) : "";
    if (!id) throw new Error("Preauth save did not return an id.");
    draftIdRef.current = id;
    return id;
  }

  const saveDraft = handleSubmit(async (values) => {
    if (readOnly) return;
    setSaving(true);
    try {
      const id = await runUpsert(values);
      setDraftId(id);
      toast.success("Draft saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  });

  const submitFinal = handleSubmit(async (values) => {
    if (readOnly) return;
    if (values.estimatedAmount <= 0) {
      toast.error("Enter an estimated amount greater than zero to submit.");
      return;
    }
    setSaving(true);
    try {
      const id = await runUpsert(values);
      setDraftId(id);
      const { error: subErr } = await supabase.rpc("submit_preauth_request", { p_id: id });
      if (subErr) throw new Error(subErr.message);
      toast.success("Preauthorization submitted.");
      router.push("/billing/insurance");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSaving(false);
    }
  });

  if (detailLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 p-6 dark:bg-transparent dark:text-gray-300">
        Loading…
      </div>
    );
  }

  if (detailError && variant !== "create") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p className={insErrorBanner}>{detailError}</p>
        <Button type="button" variant="outline" className={insSecondaryBtn} asChild>
          <Link href="/billing/insurance">Back to insurance</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-transparent">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <Link href="/billing/insurance" className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-300">
            ← Insurance
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {description ? <p className={cn("mt-1", helperText)}>{description}</p> : null}
          {readOnly ? (
            <p className={cn("mt-1 text-amber-800 dark:text-amber-200", helperText)}>Read-only view.</p>
          ) : null}
        </header>

        {/* ──────── Patient section ──────── */}
        <Card className={insCard}>
          <CardHeader className="border-b border-slate-200 dark:border-gray-800">
            <CardTitle className={sectionHeader}>Patient</CardTitle>
            <CardDescription className={`${helperText} dark:text-gray-400`}>
              {variant === "create" ? "Search by name, then confirm coverage below." : "Patient for this preauthorization."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="patient-search" className={formLabel}>Find patient</Label>
              <Input
                id="patient-search"
                className={cn("h-9 w-full rounded-md", formControl)}
                placeholder="Type at least 2 characters…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                autoComplete="off"
                disabled={readOnly || variant !== "create"}
              />
              {variant === "create" && patientOptions.length > 0 ? (
                <ul className="mt-2 max-h-40 overflow-auto rounded-md border border-gray-700 bg-gray-800 dark:border-gray-700">
                  {patientOptions.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700 ${
                          patientSearchSimilarIds.has(p.id) ? "border-l-4 border-amber-300/90 bg-amber-50/50" : ""
                        } ${pickFlashId === p.id ? "patient-row-select-flash" : ""}`}
                        onClick={() => {
                          const entries = patientOptions.map((o) => ({ id: o.id, fullName: o.full_name ?? "" }));
                          const body = similarPatientNamesWarningBody(
                            p.full_name ?? "Patient",
                            similarFullNamesToSelected(p.id, p.full_name ?? "", entries),
                          );
                          if (body) {
                            appToast.warning({ title: "Similar patient names", body });
                          }
                          setPickFlashId(p.id);
                          window.setTimeout(() => setPickFlashId((cur) => (cur === p.id ? null : cur)), 500);
                          selectPatient(p.id, p.full_name);
                        }}
                      >
                        {p.full_name}
                        {patientSearchSimilarIds.has(p.id) ? (
                          <span className="ml-1 text-amber-600" title="Similar name in this list" aria-label="Similar name warning">⚠️</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <input type="hidden" {...register("patientId")} />
              {errors.patientId ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.patientId.message}</p> : null}
              {patientId && patientLabel ? (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Selected: {patientLabel}</p>
              ) : null}
            </div>

            {/* Coverage display */}
            {!patientId ? (
              <p className={helperText}>Select a patient to load insurance and encounters.</p>
            ) : coveragesLoading ? (
              <p className={helperText}>Loading coverage…</p>
            ) : coverages.length === 0 ? (
              <p className="text-sm text-amber-800 dark:text-amber-200">No active insurance on file for this patient.</p>
            ) : (
              <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/80 p-4 dark:border-gray-700">
                <Label className={formLabel}>Active insurance</Label>
                {coverages.length > 1 ? (
                  <Select
                    value={coverageIdWatch || "__none__"}
                    onValueChange={(v) => setValue("coverageId", v === "__none__" ? "" : v)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className={cn("h-9 w-full rounded-md", formControl)}>
                      <SelectValue placeholder="Select policy" />
                    </SelectTrigger>
                    <SelectContent className={insSelectContent}>
                      <SelectItem value="__none__">Choose…</SelectItem>
                      {coverages.map((c) => (
                        <SelectItem key={c.coverage_id} value={c.coverage_id}>
                          {c.insurance_company_name} — {c.policy_number || "No policy #"}{c.tpa_name?.trim() ? ` (TPA: ${c.tpa_name})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {selectedCoverage ? (
                  <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className={metaLabel}>Policy number</dt>
                      <dd className={cn("font-medium", valueText)}>{selectedCoverage.policy_number || "—"}</dd>
                    </div>
                    <div>
                      <dt className={metaLabel}>Insurance company</dt>
                      <dd className={cn("font-medium", valueText)}>{selectedCoverage.insurance_company_name}</dd>
                    </div>
                    <div>
                      <dt className={metaLabel}>TPA</dt>
                      <dd className={cn("font-medium", valueText)}>{selectedCoverage.tpa_name?.trim() ? selectedCoverage.tpa_name : "—"}</dd>
                    </div>
                    <div>
                      <dt className={metaLabel}>Sum insured</dt>
                      <dd className={cn("font-medium tabular-nums", valueText)}>{formatInr(selectedCoverage.sum_insured)}</dd>
                    </div>
                    <div>
                      <dt className={metaLabel}>Balance</dt>
                      <dd className={cn("font-medium tabular-nums", valueText)}>{formatInr(selectedCoverage.balance)}</dd>
                    </div>
                    {selectedCoverage.valid_until ? (
                      <div>
                        <dt className={metaLabel}>Valid until</dt>
                        <dd className={cn("font-medium", valueText)}>{selectedCoverage.valid_until}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : coverages.length > 1 ? (
                  <p className={cn("mt-2 text-xs", helperText)}>Select a policy to see details.</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          {/* ──────── Encounter + request details ──────── */}
          <Card className={insCard}>
            <CardHeader className="border-b border-slate-200 dark:border-gray-800">
              <CardTitle className={sectionHeader}>Request details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Encounter selector (Task 3) */}
              <div>
                <Label className={formLabel}>Encounter</Label>
                {!patientId ? (
                  <p className={helperText}>Select a patient first.</p>
                ) : encountersLoading ? (
                  <p className={helperText}>Loading encounters…</p>
                ) : encounters.length === 0 ? (
                  <p className={helperText}>No encounters found for this patient.</p>
                ) : (
                  <Select
                    value={watch("encounterId") || "__none__"}
                    onValueChange={(v) => {
                      const val = v === "__none__" ? "" : v;
                      autoFillRef.current = null;
                      setValue("encounterId", val);
                    }}
                    disabled={readOnly}
                  >
                    <SelectTrigger className={cn("h-auto min-h-[2.25rem] w-full rounded-md py-1.5", formControl)}>
                      <SelectValue placeholder="Select encounter to auto-fill…" />
                    </SelectTrigger>
                    <SelectContent className={insSelectContent}>
                      <SelectItem value="__none__">None</SelectItem>
                      {encounters.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {formatEncounterLabel(e)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div>
                <Label htmlFor="est-amt" className={formLabel}>Estimated amount (₹)</Label>
                <Input
                  id="est-amt"
                  className={cn("h-9 w-full rounded-md", formControl)}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  disabled={readOnly}
                  {...register("estimatedAmount", { setValueAs: numFromInput })}
                />
                {errors.estimatedAmount ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.estimatedAmount.message}</p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="clinical" className={formLabel}>Clinical summary</Label>
                <Textarea
                  id="clinical"
                  className={cn("min-h-[120px] w-full rounded-md px-3 py-2 text-sm", formControl)}
                  rows={8}
                  placeholder="Relevant history, indications, clinical findings, and plan…"
                  disabled={readOnly}
                  {...register("clinicalSummary")}
                />
              </div>
            </CardContent>
          </Card>

          {/* ──────── Procedures (Task 3: tighter, max-w) ──────── */}
          <Card className={insCard}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-200 dark:border-gray-800">
              <div>
                <CardTitle className={sectionHeader}>Requested procedures</CardTitle>
                <CardDescription className={`${helperText} dark:text-gray-400`}>
                  Procedure name, SNOMED CT code, estimated cost per line.
                </CardDescription>
              </div>
              {!readOnly ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={insSecondaryBtn}
                  onClick={() => procFields.append({ procedureName: "", snomedCode: "", estimatedCost: 0 })}
                >
                  Add row
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className={cn(tableHeaderBar, "sm:grid-cols-[minmax(0,1fr)_max-content_max-content_auto]")}>
                <span>Procedure name</span>
                <span className="w-[180px]">SNOMED code</span>
                <span className="w-[120px]">Est. cost (₹)</span>
                <div className="hidden min-w-[4rem] sm:block" aria-hidden />
              </div>
              {procFields.fields.map((field, i) => (
                <div
                  key={field.id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-gray-700 sm:flex-row sm:items-end"
                >
                  <div className="min-w-0 flex-1">
                    <Label className={cn(formLabel, "sm:hidden")}>Procedure name</Label>
                    <Input className={cn("h-9 w-full rounded-md", formControl)} placeholder="Procedure name" disabled={readOnly} {...register(`procedures.${i}.procedureName`)} />
                  </div>
                  <div className="w-full sm:max-w-[180px]">
                    <Label className={cn(formLabel, "sm:hidden")}>SNOMED code</Label>
                    <Input className={cn("h-9 w-full rounded-md font-mono text-sm", formControl)} placeholder="SNOMED code" disabled={readOnly} {...register(`procedures.${i}.snomedCode`)} />
                  </div>
                  <div className="w-full sm:max-w-[120px]">
                    <Label className={cn(formLabel, "sm:hidden")}>Est. cost (₹)</Label>
                    <Input className={cn("h-9 w-full rounded-md", formControl)} type="number" min={0} step="0.01" placeholder="0" disabled={readOnly} {...register(`procedures.${i}.estimatedCost`, { setValueAs: numFromInput })} />
                  </div>
                  {!readOnly ? (
                    <Button type="button" variant="outline" size="sm" className={insSecondaryBtn} disabled={procFields.fields.length <= 1} onClick={() => procFields.remove(i)}>Remove</Button>
                  ) : <div className="hidden min-w-[4rem] sm:block" aria-hidden />}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* ──────── Diagnosis codes ──────── */}
          <Card className={insCard}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-200 dark:border-gray-800">
              <div>
                <CardTitle className={sectionHeader}>Diagnosis codes</CardTitle>
                <CardDescription className={`${helperText} dark:text-gray-400`}>ICD-10 code and description per row.</CardDescription>
              </div>
              {!readOnly ? (
                <Button type="button" size="sm" variant="secondary" className={insSecondaryBtn} onClick={() => dxFields.append({ icd10Code: "", description: "" })}>
                  Add row
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className={cn(tableHeaderBar, "sm:grid-cols-[10rem_minmax(0,1fr)_auto]")}>
                <span>ICD-10</span>
                <span>Description</span>
                <div className="hidden min-w-[4rem] sm:block" aria-hidden />
              </div>
              {dxFields.fields.map((field, i) => (
                <div key={field.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-gray-700 sm:flex-row sm:items-end">
                  <div className="w-full sm:w-40">
                    <Label className={cn(formLabel, "sm:hidden")}>ICD-10</Label>
                    <Input className={cn("h-9 w-full rounded-md font-mono text-sm uppercase", formControl)} placeholder="e.g. K35.9" disabled={readOnly} {...register(`diagnoses.${i}.icd10Code`)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Label className={cn(formLabel, "sm:hidden")}>Description</Label>
                    <Input className={cn("h-9 w-full rounded-md", formControl)} placeholder="Diagnosis description" disabled={readOnly} {...register(`diagnoses.${i}.description`)} />
                  </div>
                  {!readOnly ? (
                    <Button type="button" variant="outline" size="sm" className={insSecondaryBtn} disabled={dxFields.fields.length <= 1} onClick={() => dxFields.remove(i)}>Remove</Button>
                  ) : <div className="hidden min-w-[4rem] sm:block" aria-hidden />}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* ──────── Supporting documents ──────── */}
          <Card className={insCard}>
            <CardHeader className="border-b border-slate-200 dark:border-gray-800">
              <CardTitle className={sectionHeader}>Supporting documents</CardTitle>
              <CardDescription className={`${helperText} dark:text-gray-400`}>Phase 2 — not active yet.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-8 text-sm text-slate-400 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-500">
                Document upload coming in Phase 2
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" className={insSecondaryBtn} asChild>
              <Link href="/billing/insurance">Cancel</Link>
            </Button>
            {!readOnly ? (
              <>
                <Button type="button" variant="secondary" className={insSecondaryBtn} disabled={saving} onClick={() => void saveDraft()}>
                  {saving ? "Saving…" : "Save draft"}
                </Button>
                <Button type="button" disabled={saving} onClick={() => void submitFinal()}>
                  {saving ? "Submitting…" : "Submit preauth"}
                </Button>
              </>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
