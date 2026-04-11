"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../../../lib/supabase";
import { rpcMarkSurgeryDay } from "../../../lib/ipdData";
import {
  practitionerPrimaryLine,
  searchPractitioners,
  type PractitionerRoleFilter,
  type PractitionerSearchRow,
} from "../../../lib/ipdSearchPractitioners";
import { readIndiaRefsetKeyFromEnv } from "@/app/lib/snomedUiConfig";
import SnomedSearch from "../../../components/SnomedSearch";
import VoiceDictationButton from "../../../components/VoiceDictationButton";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { cn } from "../../../../lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const PAGE_OVERLAY = "bg-black/55";
const CARD = "rounded-xl border border-slate-600/80 bg-[#1e293b] p-4";

const LATERALITY_OPTS = [
  { value: "Left", label: "Left" },
  { value: "Right", label: "Right" },
  { value: "Bilateral", label: "Bilateral" },
  { value: "Not applicable", label: "Not applicable" },
] as const;

const ANAESTHESIA_OPTS = [
  "General",
  "Spinal",
  "Epidural",
  "Local",
  "Regional",
  "Sedation",
] as const;

type Selection = { id: string; label: string; fullName: string };

function findNoteIdForSurgeryDate(admissionData: Record<string, unknown> | null, surgeryDateIso: string): string | null {
  const raw = admissionData?.progress_notes;
  if (!Array.isArray(raw)) return null;
  const day = surgeryDateIso.slice(0, 10);
  for (const n of raw) {
    const r = n as Record<string, unknown>;
    const nd = s(r.note_date).slice(0, 10);
    if (nd === day) {
      const id = s(r.id);
      return id || null;
    }
  }
  return null;
}

function timeToDb(t: string): string | null {
  const x = t.trim();
  if (!x) return null;
  if (/^\d{2}:\d{2}$/.test(x)) return `${x}:00`;
  return x;
}

function PractitionerSearchField({
  label,
  roleFilter,
  hospitalId,
  value,
  onChange,
  disabled,
  required,
}: {
  label: string;
  roleFilter?: PractitionerRoleFilter;
  hospitalId: string;
  value: Selection | null;
  onChange: (next: Selection | null) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PractitionerSearchRow[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (value?.label) setQ(value.label);
  }, [value?.id, value?.label]);

  const runSearch = useCallback(
    async (term: string) => {
      const list = await searchPractitioners(supabase, hospitalId, term, roleFilter);
      setResults(list);
      setOpen(term.trim().length >= 1 && list.length > 0);
    },
    [hospitalId, roleFilter],
  );

  return (
    <div ref={wrapRef} className="relative space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
        {required ? <span className="text-red-400"> *</span> : null}
      </Label>
      <input
        type="text"
        disabled={disabled}
        placeholder="Type to search…"
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          onChange(null);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void runSearch(v), 250);
        }}
        onFocus={() => {
          if (q.trim().length >= 1) void runSearch(q);
        }}
        className="w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none ring-0 placeholder:text-slate-600 focus:border-sky-500"
      />
      {value?.id ? (
        <p className="text-[11px] text-sky-300">
          Selected: {value.label}
          <button
            type="button"
            className="ml-2 text-slate-400 underline hover:text-white"
            onClick={() => {
              onChange(null);
              setQ("");
            }}
          >
            Clear
          </button>
        </p>
      ) : null}
      {open && results.length > 0 ? (
        <div
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-600 bg-[#1e293b] py-1 shadow-xl"
          style={{ top: "100%" }}
        >
          {results.map((r) => {
            const fn = s(r.full_name) || "—";
            const sp = s(r.specialty);
            const line = practitionerPrimaryLine(r);
            return (
              <button
                key={r.id}
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-slate-700/80"
                onClick={() => {
                  onChange({ id: r.id, label: line, fullName: fn });
                  setQ(line);
                  setOpen(false);
                }}
              >
                <span className="block text-[13px] text-slate-100">{fn}</span>
                <span className="block text-[11px] text-slate-500">{sp || "—"}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export type ScheduleSurgeryModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admissionId: string;
  hospitalId: string;
  admissionData: Record<string, unknown> | null;
  onScheduled: () => void | Promise<void>;
};

export default function ScheduleSurgeryModal({
  open,
  onOpenChange,
  admissionId,
  hospitalId,
  admissionData,
  onScheduled,
}: ScheduleSurgeryModalProps) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [loadingRow, setLoadingRow] = useState(false);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);

  const admission = asRec(admissionData?.admission);
  const patient = asRec(admissionData?.patient);
  const preAdmission = asRec(admissionData?.pre_admission);
  const doctor = asRec(admissionData?.doctor);
  const patientId = s(patient?.id ?? admission?.patient_id);
  const surgeryIdExisting = s(admission?.surgery_id);
  const snomedIndia = readIndiaRefsetKeyFromEnv();

  const [procedureName, setProcedureName] = useState("");
  const [procedureSnomed, setProcedureSnomed] = useState("");
  const [procedureIcd10, setProcedureIcd10] = useState<string | null>(null);
  const [procedureQuery, setProcedureQuery] = useState("");
  const [laterality, setLaterality] = useState<string>("Not applicable");
  const [surgeryDate, setSurgeryDate] = useState("");
  const [estimatedMins, setEstimatedMins] = useState<string>("");
  const [otNumber, setOtNumber] = useState("");
  const [startTime, setStartTime] = useState("");
  const [anaesthesiaType, setAnaesthesiaType] = useState<string>("General");
  const [anaesthetist, setAnaesthetist] = useState<Selection | null>(null);
  const [primarySurgeon, setPrimarySurgeon] = useState<Selection | null>(null);
  const [assistantSurgeon, setAssistantSurgeon] = useState<Selection | null>(null);
  const [scrubNurse, setScrubNurse] = useState<Selection | null>(null);
  const [siteMarking, setSiteMarking] = useState(false);
  const [consentVerified, setConsentVerified] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase.from("practitioners").select("id").eq("user_id", uid).maybeSingle();
      if (prof?.id) setPractitionerId(String(prof.id));
    })();
  }, []);

  const resetFormFromAdmission = useCallback(() => {
    const sd = s(admission?.surgery_date);
    setSurgeryDate(sd ? sd.slice(0, 10) : "");
    const dn = doctor?.full_name != null ? s(doctor.full_name) : "";
    const did = s(doctor?.id);
    if (did && dn) {
      setPrimarySurgeon({ id: did, label: `${dn} · admitting`, fullName: dn });
    } else {
      setPrimarySurgeon(null);
    }
    setProcedureName("");
    setProcedureSnomed("");
    setProcedureIcd10(null);
    setProcedureQuery("");
    setLaterality("Not applicable");
    setEstimatedMins("");
    setOtNumber("");
    setStartTime("");
    setAnaesthesiaType("General");
    setAnaesthetist(null);
    setAssistantSurgeon(null);
    setScrubNurse(null);
    setSiteMarking(false);
    setConsentVerified(false);
  }, [admission?.surgery_date, doctor]);

  const loadSurgeryRow = useCallback(
    async (sid: string) => {
      setLoadingRow(true);
      const { data, error } = await supabase.from("ot_surgeries").select("*").eq("id", sid).maybeSingle();
      setLoadingRow(false);
      if (error || !data || typeof data !== "object") {
        if (error) toast.error(error.message);
        resetFormFromAdmission();
        return;
      }
      const row = data as Record<string, unknown>;
      setProcedureName(s(row.procedure_name));
      setProcedureSnomed(s(row.procedure_snomed));
      const icd = row.procedure_icd10;
      setProcedureIcd10(icd != null && String(icd).trim() !== "" ? String(icd) : null);
      setProcedureQuery("");
      setLaterality(s(row.laterality) || "Not applicable");
      const sd = s(row.surgery_date);
      setSurgeryDate(sd ? sd.slice(0, 10) : "");
      const em = row.estimated_duration_mins;
      setEstimatedMins(em != null && em !== "" ? String(em) : "");
      setOtNumber(s(row.ot_number));
      const st = s(row.start_time);
      if (st && st.includes("T")) {
        const d = new Date(st);
        if (!Number.isNaN(d.getTime())) {
          const hh = String(d.getHours()).padStart(2, "0");
          const mm = String(d.getMinutes()).padStart(2, "0");
          setStartTime(`${hh}:${mm}`);
        }
      } else if (/^\d{2}:\d{2}/.test(st)) {
        setStartTime(st.slice(0, 5));
      } else {
        setStartTime("");
      }
      setAnaesthesiaType(s(row.anaesthesia_type) || "General");
      setSiteMarking(Boolean(row.site_marking_confirmed));
      setConsentVerified(Boolean(row.consent_verified));

      const pick = async (pid: unknown, labelFallback: string): Promise<Selection | null> => {
        const id = s(pid);
        if (!id) return null;
        const { data: pr } = await supabase.from("practitioners").select("id, full_name, specialty").eq("id", id).maybeSingle();
        if (pr && typeof pr === "object") {
          const p = pr as Record<string, unknown>;
          const fn = s(p.full_name);
          const sp = s(p.specialty);
          const line = sp ? `${fn} · ${sp}` : fn;
          return { id, label: line || labelFallback, fullName: fn || labelFallback };
        }
        return { id, label: labelFallback, fullName: labelFallback };
      };

      setAnaesthetist(await pick(row.anaesthetist_id, "Anaesthetist"));
      setPrimarySurgeon(await pick(row.primary_surgeon_id, "Surgeon"));
      setAssistantSurgeon(await pick(row.assistant_surgeon_id, "Assistant"));
      setScrubNurse(await pick(row.scrub_nurse_id, "Nurse"));
    },
    [resetFormFromAdmission],
  );

  useEffect(() => {
    if (!open) return;
    if (surgeryIdExisting) {
      void loadSurgeryRow(surgeryIdExisting);
    } else {
      resetFormFromAdmission();
    }
  }, [open, surgeryIdExisting, loadSurgeryRow, resetFormFromAdmission]);

  const close = () => onOpenChange(false);

  const handleSubmit = async () => {
    if (!procedureName.trim()) {
      toast.error("Procedure name is required.");
      return;
    }
    if (!surgeryDate.trim()) {
      toast.error("Surgery date is required.");
      return;
    }
    if (!patientId) {
      toast.error("Missing patient on admission.");
      return;
    }
    if (!anaesthetist?.id) {
      toast.error("Anaesthetist is required.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id ?? null;
    if (!uid) {
      toast.error("Not signed in.");
      return;
    }

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        hospital_id: hospitalId,
        admission_id: admissionId,
        patient_id: patientId,
        procedure_name: procedureName.trim(),
        procedure_snomed: procedureSnomed.trim() || null,
        procedure_icd10: procedureIcd10?.trim() || null,
        laterality,
        surgery_date: surgeryDate,
        estimated_duration_mins: (() => {
          const n = parseInt(estimatedMins.replace(/\D/g, ""), 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        ot_number: otNumber.trim() || null,
        start_time: timeToDb(startTime),
        anaesthesia_type: anaesthesiaType,
        anaesthetist_id: anaesthetist.id,
        primary_surgeon_id: primarySurgeon?.id ?? null,
        assistant_surgeon_id: assistantSurgeon?.id ?? null,
        scrub_nurse_id: scrubNurse?.id ?? null,
        site_marking_confirmed: siteMarking,
        consent_verified: consentVerified,
        status: "scheduled",
      };

      let surgeryRowId: string;

      if (surgeryIdExisting) {
        const { data, error } = await supabase
          .from("ot_surgeries")
          .update({
            ...payload,
            updated_at: new Date().toISOString(),
          })
          .eq("id", surgeryIdExisting)
          .eq("hospital_id", hospitalId)
          .select("id")
          .single();
        if (error) throw error;
        surgeryRowId = s((data as Record<string, unknown>).id) || surgeryIdExisting;
      } else {
        const { data, error } = await supabase
          .from("ot_surgeries")
          .insert({
            ...payload,
            created_by: uid,
          })
          .select("id")
          .single();
        if (error) throw error;
        surgeryRowId = s((data as Record<string, unknown>).id);
        if (!surgeryRowId) throw new Error("No surgery id returned.");
      }

      const { error: admErr } = await supabase
        .from("ipd_admissions")
        .update({
          surgery_date: surgeryDate,
          surgery_id: surgeryRowId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", admissionId);
      if (admErr) throw admErr;

      const noteId = findNoteIdForSurgeryDate(admissionData, surgeryDate);
      if (noteId) {
        const markResult = await rpcMarkSurgeryDay(supabase, {
          noteId,
          surgeryDate: surgeryDate.slice(0, 10),
        });
        if (markResult.error) console.warn("mark_surgery_day:", markResult.error.message);
      }

      const dFmt = new Date(surgeryDate + "T12:00:00");
      const pretty = Number.isNaN(dFmt.getTime())
        ? surgeryDate
        : dFmt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

      const doctorName = s(doctor?.full_name) || "Doctor";
      const patientFullName = s(patient?.full_name) || s(patient?.name) || "Patient";
      const anaesthetistName = anaesthetist.fullName || anaesthetist.label.split(" · ")[0] || "Anaesthetist";

      const { data: existingPac } = await supabase.from("pac_requests").select("id").eq("surgery_id", surgeryRowId).maybeSingle();

      if (!existingPac && anaesthetist.id) {
        const bodyText = `Dr. ${doctorName} has scheduled ${procedureName.trim()} for ${patientFullName} on ${pretty}. Please complete pre-anaesthetic checkup before surgery.`;
        const { data: notifRow, error: notifErr } = await supabase
          .from("notifications")
          .insert({
            hospital_id: hospitalId,
            recipient_id: anaesthetist.id,
            sender_id: uid,
            type: "pac_request",
            priority: "high",
            title: "PAC requested — surgery scheduled",
            body: bodyText,
            data: {
              admission_id: admissionId,
              surgery_id: surgeryRowId,
              patient_id: patientId,
              patient_name: patientFullName,
              procedure: procedureName.trim(),
              surgery_date: surgeryDate,
              requesting_doctor: doctorName,
            },
            action_url: `/ipd/${admissionId}`,
          })
          .select("id")
          .single();
        if (notifErr) throw notifErr;
        const notifId = s((notifRow as Record<string, unknown>).id);
        const { error: pacErr } = await supabase.from("pac_requests").insert({
          hospital_id: hospitalId,
          admission_id: admissionId,
          surgery_id: surgeryRowId,
          patient_id: patientId,
          requesting_doctor_id: uid,
          anaesthetist_id: anaesthetist.id,
          notification_id: notifId,
          status: "pending",
        });
        if (pacErr) throw pacErr;
        toast.success(`Surgery scheduled for ${pretty}. PAC request sent to ${anaesthetistName}.`);
      } else {
        toast.success(`Surgery scheduled for ${pretty}.`);
      }

      await onScheduled();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save surgery.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-[80] flex items-center justify-center p-4 ${PAGE_OVERLAY}`} role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={() => close()} />
      <div
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(92vh,800px)] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-slate-600 bg-[#0f172a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-700 px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold text-white">
            Schedule Surgery
          </h2>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={() => close()}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadingRow ? <p className="text-sm text-slate-400">Loading surgery…</p> : null}

          <div className={CARD}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-sky-400">Procedure details</p>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-[11px] uppercase text-slate-400">Procedure name *</Label>
                  <VoiceDictationButton
                    contextType="ipd_progress_note"
                    ipdVoiceField="plan"
                    specialty={s(preAdmission?.specialty) || s(admission?.specialty)}
                    doctorId={practitionerId ?? undefined}
                    indiaRefset={snomedIndia ?? undefined}
                    ipdVoiceBaseText={procedureName}
                    variant="slate"
                    onTranscriptUpdate={(text) => {
                      setProcedureName(text);
                      setProcedureSnomed("");
                      setProcedureIcd10(null);
                    }}
                    className="scale-90"
                  />
                </div>
                {procedureName.trim() ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <span
                      title={
                        procedureSnomed.trim()
                          ? `SNOMED CT: ${procedureSnomed.trim()}`
                          : "No SNOMED code — pick from search below"
                      }
                      className="inline-flex max-w-full items-stretch overflow-hidden rounded-full border border-sky-900/40 bg-[#1e3a5f] shadow-sm"
                    >
                      <span className="min-w-0 px-2.5 py-1.5 text-[12px] font-medium text-white">{procedureName.trim()}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setProcedureName("");
                          setProcedureSnomed("");
                          setProcedureIcd10(null);
                          setProcedureQuery("");
                        }}
                        className="shrink-0 border-0 border-l border-white/20 bg-transparent px-2 py-1.5 text-white/50 transition hover:bg-red-900/40 hover:text-white"
                        aria-label="Remove procedure"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    </span>
                  </div>
                ) : null}
                <p className="mb-1 text-[10px] font-medium text-slate-500">Search SNOMED procedure</p>
                <SnomedSearch
                  placeholder="e.g. Total knee replacement…"
                  hierarchy="procedure"
                  allowFreeTextNoCode
                  variant="slate"
                  value={procedureQuery}
                  onChange={setProcedureQuery}
                  indiaRefset={snomedIndia ?? undefined}
                  onSelect={(concept) => {
                    setProcedureName(concept.term.trim());
                    setProcedureSnomed(concept.conceptId.trim());
                    setProcedureIcd10(concept.icd10?.trim() ? concept.icd10 : null);
                    setProcedureQuery("");
                  }}
                />
                <Input
                  value={procedureName}
                  onChange={(e) => {
                    setProcedureName(e.target.value);
                    setProcedureSnomed("");
                    setProcedureIcd10(null);
                  }}
                  placeholder="Or type display name manually…"
                  className="mt-2 border-slate-600 bg-slate-900/60 text-white placeholder:text-slate-600"
                />
              </div>
              <div>
                <Label className="text-[11px] uppercase text-slate-400">Laterality</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {LATERALITY_OPTS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setLaterality(o.value)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition",
                        laterality === o.value
                          ? "bg-sky-600 text-white"
                          : "border border-slate-600 text-slate-400 hover:border-slate-500",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] uppercase text-slate-400">Surgery date *</Label>
                  <Input
                    type="date"
                    value={surgeryDate}
                    onChange={(e) => setSurgeryDate(e.target.value)}
                    className="mt-1 border-slate-600 bg-slate-900/60 text-white"
                  />
                </div>
                <div>
                  <Label className="text-[11px] uppercase text-slate-400">Estimated duration</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={estimatedMins}
                      onChange={(e) => setEstimatedMins(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="e.g. 120"
                      className="border-slate-600 bg-slate-900/60 text-white"
                    />
                    <span className="shrink-0 text-sm text-slate-500">mins</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] uppercase text-slate-400">OT number</Label>
                  <Input
                    value={otNumber}
                    onChange={(e) => setOtNumber(e.target.value)}
                    placeholder="OT-1"
                    className="mt-1 border-slate-600 bg-slate-900/60 text-white"
                  />
                </div>
                <div>
                  <Label className="text-[11px] uppercase text-slate-400">Planned start time</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 border-slate-600 bg-slate-900/60 text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className={CARD}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-emerald-400">Anaesthesia</p>
            <div className="space-y-3">
              <div>
                <Label className="text-[11px] uppercase text-slate-400">Type</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ANAESTHESIA_OPTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAnaesthesiaType(a)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition",
                        anaesthesiaType === a
                          ? "bg-emerald-600 text-white"
                          : "border border-slate-600 text-slate-400 hover:border-slate-500",
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <PractitionerSearchField
                label="Anaesthetist"
                roleFilter="anaes"
                required
                hospitalId={hospitalId}
                value={anaesthetist}
                onChange={setAnaesthetist}
                disabled={loadingRow}
              />
              {anaesthetist?.id ? (
                <p className="text-[11px] leading-relaxed text-amber-200/80">
                  A PAC request will be sent to this anaesthetist on scheduling.
                </p>
              ) : null}
            </div>
          </div>

          <div className={CARD}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-violet-400">Surgical team</p>
            <div className="space-y-3">
              <PractitionerSearchField
                label="Primary surgeon"
                hospitalId={hospitalId}
                value={primarySurgeon}
                onChange={setPrimarySurgeon}
                disabled={loadingRow}
              />
              <PractitionerSearchField
                label="Assistant surgeon (optional)"
                hospitalId={hospitalId}
                value={assistantSurgeon}
                onChange={setAssistantSurgeon}
                disabled={loadingRow}
              />
              <PractitionerSearchField
                label="Scrub nurse (optional)"
                roleFilter="nurs"
                hospitalId={hospitalId}
                value={scrubNurse}
                onChange={setScrubNurse}
                disabled={loadingRow}
              />
            </div>
          </div>

          <div className={CARD}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-amber-400">NABH safety</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-500"
                checked={siteMarking}
                onChange={(e) => setSiteMarking(e.target.checked)}
              />
              Site marking confirmed
            </label>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-500"
                checked={consentVerified}
                onChange={(e) => setConsentVerified(e.target.checked)}
              />
              Consent verified
            </label>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              NatSSIPS checklist to be completed on day of surgery
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <Button type="button" variant="outline" className="border-slate-600 text-slate-300" onClick={() => close()}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-purple-600 text-white hover:bg-purple-500"
            disabled={busy || loadingRow}
            onClick={() => void handleSubmit()}
          >
            {busy ? "Saving…" : surgeryIdExisting ? "Save changes" : "Schedule Surgery"}
          </Button>
        </div>
      </div>
    </div>
  );
}
