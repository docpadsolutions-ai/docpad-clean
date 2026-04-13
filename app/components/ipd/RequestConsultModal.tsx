"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchClinicalDepartmentsForHospital } from "@/app/lib/clinicalDepartments";
import { rpcGetDoctorsByDepartment, rpcRequestConsult } from "@/app/lib/ipdConsults";
import VoiceDictationButton from "@/app/components/VoiceDictationButton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function buildAttachmentSuffix(ids: string[], fullFile: boolean): string {
  const parts: string[] = [];
  if (ids.length > 0) parts.push(`[Investigations attached: ${ids.join(",")}]`);
  if (fullFile) parts.push("[Full patient file attached]");
  return parts.length > 0 ? `\n\n${parts.join(" ")}` : "";
}

/** Parse `consult_id` from `request_consult` RPC return value. */
function consultIdFromRpcData(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === "string") return s(data) || null;
  if (typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const id = s(o.consult_id ?? o.id ?? o.p_consult_id);
    return id || null;
  }
  if (Array.isArray(data) && data[0] != null && typeof data[0] === "object") {
    return consultIdFromRpcData(data[0]);
  }
  return null;
}

function formatResultedAtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

type DeptRow = { id: string; name: string };

type Urgency = "Routine" | "Urgent" | "STAT";

type InvRow = {
  id: string;
  test_name: string | null;
  test_category: string | null;
  result_status: string | null;
  status: string | null;
  resulted_at: string | null;
  clinical_indication: string | null;
};

export type RequestConsultModalProps = {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  admissionId: string;
  patientId: string;
  /** Optional link to current progress note */
  progressNoteId?: string | null;
  onSubmitted?: () => void;
};

export function RequestConsultModal({
  open,
  onClose,
  hospitalId,
  admissionId,
  patientId,
  progressNoteId = null,
  onSubmitted,
}: RequestConsultModalProps) {
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [deptId, setDeptId] = useState("");
  const [doctors, setDoctors] = useState<Record<string, unknown>[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("Routine");
  const [reason, setReason] = useState("");
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [attachInvOpen, setAttachInvOpen] = useState(false);
  const [investigations, setInvestigations] = useState<InvRow[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [selectedInvestigationIds, setSelectedInvestigationIds] = useState<string[]>([]);
  const [attachFullFile, setAttachFullFile] = useState(false);

  useEffect(() => {
    if (!open || !hospitalId) return;
    let cancelled = false;
    setLoadingDepts(true);
    void (async () => {
      const { data: rows, error } = await fetchClinicalDepartmentsForHospital(supabase, hospitalId);
      if (cancelled) return;
      setLoadingDepts(false);
      if (error) {
        toast.error(error.message);
        setDepartments([]);
        return;
      }
      setDepartments(rows);
      setDeptId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? "";
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hospitalId]);

  const loadDoctors = useCallback(async (dId: string) => {
    if (!dId) {
      setDoctors([]);
      setDoctorId("");
      return;
    }
    setLoadingDocs(true);
    const { data, error } = await rpcGetDoctorsByDepartment(supabase, dId);
    setLoadingDocs(false);
    if (error) {
      toast.error(error.message);
      setDoctors([]);
      setDoctorId("");
      return;
    }
    setDoctors(data);
    setDoctorId(data[0] ? s(data[0].id ?? data[0].doctor_id ?? data[0].practitioner_id) : "");
  }, []);

  useEffect(() => {
    if (!open || !deptId) return;
    void loadDoctors(deptId);
  }, [open, deptId, loadDoctors]);

  useEffect(() => {
    if (!open) {
      setReason("");
      setUrgency("Routine");
      setAttachInvOpen(false);
      setInvestigations([]);
      setSelectedInvestigationIds([]);
      setAttachFullFile(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !attachInvOpen || !patientId) return;
    let cancelled = false;
    setLoadingInv(true);
    void (async () => {
      const { data, error } = await supabase
        .from("investigations")
        .select(
          "id, test_name, test_category, result_status, status, resulted_at, clinical_indication",
        )
        .eq("patient_id", patientId)
        .in("status", ["resulted", "reported", "reviewed"])
        .order("resulted_at", { ascending: false });
      if (cancelled) return;
      setLoadingInv(false);
      if (error) {
        toast.error(error.message);
        setInvestigations([]);
        return;
      }
      const rows = (data ?? []) as InvRow[];
      const allowed = new Set(["resulted", "reported", "reviewed"]);
      setInvestigations(rows.filter((row) => allowed.has(s(row.status).toLowerCase())));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, attachInvOpen, patientId]);

  const toggleAttachInvestigations = () => {
    setAttachInvOpen((o) => !o);
  };

  const selectedDoctor = useMemo(() => doctors.find((d) => s(d.id ?? d.doctor_id ?? d.practitioner_id) === doctorId), [doctors, doctorId]);

  const consultingSpecialty = useMemo(() => {
    const sp =
      s(selectedDoctor?.specialty) ||
      s(selectedDoctor?.specialty_name) ||
      s(selectedDoctor?.department_specialty) ||
      "";
    return sp || null;
  }, [selectedDoctor]);

  const handleSubmit = async () => {
    const r = reason.trim();
    if (!r) {
      toast.error("Reason for consult is required.");
      return;
    }
    if (!patientId) {
      toast.error("Patient ID is missing.");
      return;
    }
    if (!doctorId) {
      toast.error("Select a consulting doctor.");
      return;
    }
    setSubmitting(true);
    const { data: rpcData, error } = await rpcRequestConsult(supabase, {
      p_admission_id: admissionId,
      p_patient_id: patientId,
      p_consulting_doctor_id: doctorId,
      p_consulting_department_id: deptId || null,
      p_consulting_specialty: consultingSpecialty,
      p_reason_for_consult: r,
      p_urgency: urgency.toLowerCase(),
      p_progress_note_id: progressNoteId,
    });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }

    const suffix = buildAttachmentSuffix(selectedInvestigationIds, attachFullFile);
    if (suffix) {
      const consultId = consultIdFromRpcData(rpcData);
      if (!consultId) {
        setSubmitting(false);
        toast.success("Consult requested");
        toast.warning("Attachment notes could not be appended (consult id not returned).");
        onSubmitted?.();
        onClose();
        return;
      }
      const { error: upErr } = await supabase
        .from("ipd_consult_requests")
        .update({ reason_for_consult: `${r}${suffix}` })
        .eq("id", consultId);
      if (upErr) {
        setSubmitting(false);
        toast.error(upErr.message);
        return;
      }
    }

    setSubmitting(false);
    toast.success("Consult requested");
    onSubmitted?.();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">Request consult</h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <Label className="text-slate-700">Department</Label>
            <select
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={deptId}
              disabled={loadingDepts}
              onChange={(e) => setDeptId(e.target.value)}
            >
              {departments.length === 0 ? (
                <option value="">No departments</option>
              ) : (
                departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <Label className="text-slate-700">Consulting doctor</Label>
            <select
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={doctorId}
              disabled={loadingDocs || !deptId}
              onChange={(e) => setDoctorId(e.target.value)}
            >
              {doctors.length === 0 ? (
                <option value="">{loadingDocs ? "Loading…" : "No doctors in department"}</option>
              ) : (
                doctors.map((d) => {
                  const id = s(d.id ?? d.doctor_id ?? d.practitioner_id);
                  const name =
                    s(d.full_name) || s(d.name) || s(d.display_name) || "Doctor";
                  const sp = s(d.specialty) || s(d.specialty_name) || "";
                  return (
                    <option key={id || name} value={id}>
                      {sp ? `${name} · ${sp}` : name}
                    </option>
                  );
                })
              )}
            </select>
          </div>

          <div>
            <Label className="text-slate-700">Urgency</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["Routine", "Urgent", "STAT"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                    urgency === u
                      ? u === "STAT"
                        ? "bg-red-600 text-white ring-2 ring-red-400"
                        : u === "Urgent"
                          ? "bg-orange-500 text-white"
                          : "bg-sky-600 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-slate-700">Reason for consult</Label>
            <div className="relative mt-1.5">
              <Textarea
                className="min-h-[100px] resize-y border-slate-300 bg-white pr-11 pb-10 text-slate-900"
                placeholder="Clinical question, background, and what you need from the consultant…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
              <div className="pointer-events-auto absolute bottom-2 right-2 z-10">
                <VoiceDictationButton
                  contextType="ipd_consult_request"
                  ipdVoiceBaseText={reason}
                  specialty={consultingSpecialty ?? undefined}
                  variant="slate"
                  micVisual="lucide"
                  hideLiveTranscriptPill
                  onTranscriptUpdate={(text) => setReason(text)}
                  className="scale-95"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={toggleAttachInvestigations}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800"
            >
              <span>Attach Investigations (optional)</span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-500 transition-transform", attachInvOpen && "rotate-180")} />
            </button>
            {attachInvOpen ? (
              <div className="border-t border-slate-200 px-3 py-3">
                {!patientId ? (
                  <p className="text-xs text-slate-500">Patient ID is required to load investigations.</p>
                ) : loadingInv ? (
                  <p className="text-xs text-slate-500">Loading…</p>
                ) : investigations.length === 0 ? (
                  <p className="text-xs text-slate-500">No resulted investigations to attach.</p>
                ) : (
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {investigations.map((inv) => {
                      const id = s(inv.id);
                      const name = s(inv.test_name) || "Investigation";
                      const cat = s(inv.test_category) || "—";
                      const rs = s(inv.result_status) || "—";
                      const line = `${name} — ${cat} (${rs}) · ${formatResultedAtDate(inv.resulted_at)}`;
                      const checked = selectedInvestigationIds.includes(id);
                      return (
                        <li key={id}>
                          <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-800">
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-slate-300"
                              checked={checked}
                              onChange={(e) => {
                                const on = e.target.checked;
                                setSelectedInvestigationIds((prev) =>
                                  on ? [...prev, id] : prev.filter((x) => x !== id),
                                );
                              }}
                            />
                            <span className="min-w-0 leading-snug">{line}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-300"
              checked={attachFullFile}
              onChange={(e) => setAttachFullFile(e.target.checked)}
            />
            <span>Attach full patient file for this admission</span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" className="bg-violet-600 hover:bg-violet-500" disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </div>
    </div>
  );
}
