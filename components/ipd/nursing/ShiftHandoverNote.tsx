"use client";

import { format } from "date-fns";
import { CheckCircle2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";

export type NursingShiftUi = "Morning" | "Afternoon" | "Night";

export type ShiftHandoverNoteProps = {
  admissionId: string;
  patientId: string;
  hospitalId: string;
  nursePractitionerId: string;
  patientName: string;
  bedLabel: string;
  wardName: string;
  shiftUi: NursingShiftUi;
  /** Calendar date for this shift (yyyy-mm-dd), usually today local. */
  shiftDateYmd: string;
  className?: string;
};

type PendingTaskChip = {
  task_id: string;
  task_name: string;
  task_category?: string;
  priority?: string;
};

function shiftUiToRpcKey(s: NursingShiftUi): string {
  return s.toLowerCase();
}

/** Next shift after the current panel shift (for default incoming shift). */
function nextShiftAfter(current: NursingShiftUi): NursingShiftUi {
  if (current === "Morning") return "Afternoon";
  if (current === "Afternoon") return "Night";
  return "Morning";
}

function stripAutoHandoverLines(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^Incoming shift:\s*/i.test(t)) return false;
      if (/^Handover to:\s*/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

function parseIncomingShiftFromConcerns(raw: string): NursingShiftUi | null {
  for (const line of raw.split("\n")) {
    const m = line.match(/Incoming shift:\s*(Morning|Afternoon|Night)/i);
    if (m) {
      const w = m[1];
      if (/^morning$/i.test(w)) return "Morning";
      if (/^afternoon$/i.test(w)) return "Afternoon";
      if (/^night$/i.test(w)) return "Night";
    }
  }
  return null;
}

function parseHandoverToFreeFromConcerns(raw: string): string {
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*Handover to:\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return "";
}

type NurseOption = { id: string; full_name: string };

function shiftBadgeClass(s: NursingShiftUi): string {
  if (s === "Morning") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  if (s === "Afternoon") return "bg-orange-100 text-orange-900 ring-1 ring-orange-200";
  return "bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200";
}

const MOBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: "independent", label: "Independent" },
  { value: "assisted", label: "Assisted / supervised" },
  { value: "bedbound", label: "Bedbound" },
  { value: "chairbound", label: "Chairbound" },
  { value: "nwb", label: "NWB (non–weight-bearing)" },
  { value: "pwb", label: "Partial weight-bearing" },
  { value: "unknown", label: "Unknown" },
];

function asStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asJsonArray(v: unknown): unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return [];
}

function parseHandoverRow(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

export function ShiftHandoverNote({
  admissionId,
  patientId,
  hospitalId,
  nursePractitionerId,
  patientName,
  bedLabel,
  wardName,
  shiftUi,
  shiftDateYmd,
  className,
}: ShiftHandoverNoteProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [handoverId, setHandoverId] = useState<string | null>(null);

  const [situation, setSituation] = useState("");
  const [background, setBackground] = useState("");
  const [assessment, setAssessment] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [painScore, setPainScore] = useState(0);
  const [mobilityStatus, setMobilityStatus] = useState("independent");
  const [ivAccess, setIvAccess] = useState("");
  const [drainStatus, setDrainStatus] = useState("");
  const [specialConcerns, setSpecialConcerns] = useState("");
  const [vitalsJson, setVitalsJson] = useState<Record<string, unknown>>({});
  const [pendingTaskChips, setPendingTaskChips] = useState<PendingTaskChip[]>([]);
  const [pendingInvChips, setPendingInvChips] = useState<string[]>([]);
  const [invInput, setInvInput] = useState("");

  const [handoverBy, setHandoverBy] = useState<string | null>(null);
  const [isSigned, setIsSigned] = useState(false);
  const [receivedTime, setReceivedTime] = useState<string | null>(null);

  const [currentNurseFullName, setCurrentNurseFullName] = useState("");
  const [incomingNurses, setIncomingNurses] = useState<NurseOption[]>([]);
  const [handoverToId, setHandoverToId] = useState("");
  const [handoverToFreeText, setHandoverToFreeText] = useState("");
  const [incomingShiftUi, setIncomingShiftUi] = useState<NursingShiftUi>(() => nextShiftAfter(shiftUi));

  const loadLatestVitals = useCallback(async () => {
    const { data, error } = await supabase
      .from("ipd_nursing_vitals")
      .select("*")
      .eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      setVitalsJson({});
      return;
    }
    setVitalsJson(data as Record<string, unknown>);
  }, [admissionId]);

  const loadPendingTasksFromQueue = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_nursing_shift_tasks", {
      p_shift: shiftUiToRpcKey(shiftUi),
      p_date: shiftDateYmd,
    });
    if (error || !data) return;
    const rows = Array.isArray(data) ? data : [];
    const mine: PendingTaskChip[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      if (asStr(o.admission_id) !== admissionId) continue;
      mine.push({
        task_id: asStr(o.task_id),
        task_name: asStr(o.task_name) || "Task",
        task_category: asStr(o.task_category),
        priority: asStr(o.priority),
      });
    }
    setPendingTaskChips(mine.filter((t) => t.task_id));
  }, [admissionId, shiftDateYmd, shiftUi]);

  const loadHandover = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_latest_handover", {
      p_admission_id: admissionId,
      p_shift_date: shiftDateYmd,
      p_shift_type: shiftUiToRpcKey(shiftUi),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = parseHandoverRow(data);
    if (!row) {
      setHandoverId(null);
      setHandoverBy(null);
      setIsSigned(false);
      setReceivedTime(null);
      setSituation("");
      setBackground("");
      setAssessment("");
      setRecommendation("");
      setPainScore(0);
      setMobilityStatus("independent");
      setIvAccess("");
      setDrainStatus("");
      setSpecialConcerns("");
      setHandoverToId("");
      setHandoverToFreeText("");
      setIncomingShiftUi(nextShiftAfter(shiftUi));
      setPendingInvChips([]);
      setPendingTaskChips([]);
      void loadLatestVitals();
      void loadPendingTasksFromQueue();
      return;
    }

    setHandoverId(asStr(row.id) || null);
    setHandoverBy(asStr(row.handover_by) || null);
    setIsSigned(Boolean(row.is_signed_by_receiver));
    setReceivedTime(row.received_time != null ? String(row.received_time) : null);
    setSituation(asStr(row.situation));
    setBackground(asStr(row.background));
    setAssessment(asStr(row.assessment));
    setRecommendation(asStr(row.recommendation));
    const ps = row.pain_score;
    setPainScore(
      ps != null && ps !== "" && Number.isFinite(Number(ps)) ? Number(ps) : 0,
    );
    setMobilityStatus(asStr(row.mobility_status) || "independent");
    setIvAccess(asStr(row.iv_access));
    setDrainStatus(asStr(row.drain_status));
    const rawConcerns = asStr(row.special_concerns);
    setSpecialConcerns(stripAutoHandoverLines(rawConcerns));
    const parsedIncoming = parseIncomingShiftFromConcerns(rawConcerns);
    setIncomingShiftUi(parsedIncoming ?? nextShiftAfter(shiftUi));
    const hTo = asStr(row.handover_to);
    setHandoverToId(hTo);
    setHandoverToFreeText(hTo ? "" : parseHandoverToFreeFromConcerns(rawConcerns));

    const vj = row.current_vitals_json;
    if (vj && typeof vj === "object" && !Array.isArray(vj)) {
      setVitalsJson(vj as Record<string, unknown>);
    } else {
      void loadLatestVitals();
    }

    const pt = asJsonArray(row.pending_tasks);
    const tasks: PendingTaskChip[] = pt
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        return {
          task_id: asStr(o.task_id),
          task_name: asStr(o.task_name) || "Task",
          task_category: asStr(o.task_category),
          priority: asStr(o.priority),
        };
      })
      .filter(Boolean) as PendingTaskChip[];
    setPendingTaskChips(tasks.length ? tasks : []);
    if (!tasks.length) void loadPendingTasksFromQueue();

    const pi = asJsonArray(row.pending_investigations);
    setPendingInvChips(pi.map((x) => asStr(x)).filter(Boolean));
  }, [
    admissionId,
    loadLatestVitals,
    loadPendingTasksFromQueue,
    shiftDateYmd,
    shiftUi,
  ]);

  useEffect(() => {
    void loadHandover();
  }, [loadHandover]);

  useEffect(() => {
    if (!hospitalId || !nursePractitionerId) return;
    let cancelled = false;
    void (async () => {
      const { data: selfRow } = await supabase
        .from("practitioners")
        .select("full_name")
        .eq("id", nursePractitionerId)
        .maybeSingle();
      if (!cancelled && selfRow && typeof selfRow === "object") {
        setCurrentNurseFullName(asStr((selfRow as Record<string, unknown>).full_name));
      }
      const { data, error } = await supabase
        .from("practitioners")
        .select("id, full_name")
        .eq("hospital_id", hospitalId)
        .eq("role", "nurse")
        .neq("id", nursePractitionerId)
        .order("full_name");
      if (cancelled) return;
      if (error) {
        setIncomingNurses([]);
        return;
      }
      const rows = (data ?? []) as { id?: unknown; full_name?: unknown }[];
      setIncomingNurses(
        rows
          .map((r) => ({ id: asStr(r.id), full_name: asStr(r.full_name) || "—" }))
          .filter((r) => r.id),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [hospitalId, nursePractitionerId]);

  const mode = useMemo(() => {
    if (!handoverId) return "write" as const;
    if (isSigned) return "readSigned" as const;
    if (handoverBy && handoverBy !== nursePractitionerId) return "readSign" as const;
    return "write" as const;
  }, [handoverBy, handoverId, isSigned, nursePractitionerId]);

  const showEmptyBanner = mode === "write" && !handoverId;

  const handoverRecipientReady =
    incomingNurses.length > 0 ? handoverToId.trim().length > 0 : handoverToFreeText.trim().length > 0;

  const removeTaskChip = (taskId: string) => {
    setPendingTaskChips((prev) => prev.filter((t) => t.task_id !== taskId));
  };

  const addInvChip = () => {
    const t = invInput.trim();
    if (!t) return;
    setPendingInvChips((prev) => [...prev, t]);
    setInvInput("");
  };

  const removeInvChip = (idx: number) => {
    setPendingInvChips((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitHandover = async () => {
    const useDropdown = incomingNurses.length > 0;
    if (useDropdown && !handoverToId.trim()) {
      toast.warning("Select incoming nurse");
      return;
    }
    if (!useDropdown && !handoverToFreeText.trim()) {
      toast.warning("Enter incoming nurse name");
      return;
    }

    let vitalsPayload = vitalsJson;
    if (!vitalsPayload || Object.keys(vitalsPayload).length === 0) {
      const { data } = await supabase
        .from("ipd_nursing_vitals")
        .select("*")
        .eq("admission_id", admissionId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      vitalsPayload = (data as Record<string, unknown>) ?? {};
    }

    const pendingTasksPayload = pendingTaskChips.map((t) => ({
      task_id: t.task_id,
      task_name: t.task_name,
      task_category: t.task_category,
      priority: t.priority,
    }));

    const userScLines = specialConcerns.trim();
    const concernLines: string[] = [];
    if (userScLines) concernLines.push(userScLines);
    concernLines.push(`Incoming shift: ${incomingShiftUi}`);
    if (!useDropdown && handoverToFreeText.trim()) {
      concernLines.push(`Handover to: ${handoverToFreeText.trim()}`);
    }
    const specialConcernsPayload = concernLines.join("\n");

    const handoverToPayload: string | null = useDropdown && handoverToId.trim() ? handoverToId.trim() : null;

    setSaving(true);
    const baseFields = {
      admission_id: admissionId,
      patient_id: patientId,
      hospital_id: hospitalId,
      shift_date: shiftDateYmd,
      shift_type: shiftUiToRpcKey(shiftUi),
      handover_by: nursePractitionerId,
      handover_to: handoverToPayload,
      situation: situation.trim() || null,
      background: background.trim() || null,
      assessment: assessment.trim() || null,
      recommendation: recommendation.trim() || null,
      current_vitals_json: vitalsPayload,
      pending_tasks: pendingTasksPayload,
      pending_investigations: pendingInvChips,
      iv_access: ivAccess.trim() || null,
      drain_status: drainStatus.trim() || null,
      pain_score: painScore,
      mobility_status: mobilityStatus || null,
      special_concerns: specialConcernsPayload || null,
      is_signed_by_receiver: false,
    };

    if (handoverId) {
      const { error } = await supabase
        .from("ipd_shift_handovers")
        .update({
          ...baseFields,
          updated_at: new Date().toISOString(),
        })
        .eq("id", handoverId);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Handover updated");
    } else {
      const { data, error } = await supabase
        .from("ipd_shift_handovers")
        .insert({
          ...baseFields,
          handover_time: new Date().toISOString(),
        })
        .select("id")
        .single();
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data && typeof data === "object" && "id" in data) {
        setHandoverId(String((data as { id: unknown }).id));
      }
      toast.success("Handover submitted");
    }
    void loadHandover();
  };

  const signReceived = async () => {
    if (!handoverId) return;
    setSigning(true);
    const { data, error } = await supabase.rpc("sign_handover_received", {
      p_handover_id: handoverId,
    });
    setSigning(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const o = parseHandoverRow(data);
    if (o && o.success === true) {
      toast.success("Handover acknowledged");
    }
    void loadHandover();
  };

  const vitalsSummary = useMemo(() => {
    const v = vitalsJson;
    if (!v || Object.keys(v).length === 0) return null;
    const parts: string[] = [];
    const bp = asStr(v.blood_pressure);
    const pulse = v.pulse != null ? String(v.pulse) : "";
    const spo2 = v.spo2 != null ? String(v.spo2) : "";
    const rr = v.respiratory_rate != null ? String(v.respiratory_rate) : "";
    const temp = v.temperature != null ? String(v.temperature) : "";
    const mews = v.mews_score != null ? String(v.mews_score) : "";
    if (bp) parts.push(`BP ${bp}`);
    if (pulse) parts.push(`HR ${pulse}`);
    if (spo2) parts.push(`SpO₂ ${spo2}%`);
    if (rr) parts.push(`RR ${rr}`);
    if (temp) parts.push(`T ${temp}`);
    if (mews) parts.push(`MEWS ${mews}`);
    return parts.length ? parts.join(" · ") : "Vitals on file (see JSON)";
  }, [vitalsJson]);

  const topBar = (
    <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900">{patientName}</p>
        <p className="text-xs text-slate-600">
          Bed {bedLabel} · {wardName}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            shiftBadgeClass(shiftUi),
          )}
        >
          {shiftUi}
        </span>
        <time
          className="text-xs tabular-nums text-slate-500"
          dateTime={shiftDateYmd}
        >
          {format(new Date(`${shiftDateYmd}T12:00:00`), "EEE d MMM yyyy")}
        </time>
      </div>
    </div>
  );

  const sbarReadOnly = (
    <div className="space-y-3">
      <SbarCard title="Situation" body={situation} />
      <SbarCard title="Background" body={background} />
      <SbarCard title="Assessment" body={assessment} />
      <SbarCard title="Recommendation" body={recommendation} />
    </div>
  );

  if (loading) {
    return (
      <div className={cn("space-y-3", className)}>
        {topBar}
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {topBar}

      {mode === "readSigned" ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-950">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold">Handover acknowledged</p>
            <p className="text-xs text-emerald-900/90">
              {receivedTime
                ? `Received ${format(new Date(receivedTime), "dd MMM yyyy, HH:mm")}`
                : "Recorded on file."}
            </p>
          </div>
        </div>
      ) : null}

      {showEmptyBanner ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          No handover submitted yet for this shift.
        </div>
      ) : null}

      {mode === "readSign" ? (
        <>
          {sbarReadOnly}
          <QuickReadSection
            vitalsSummary={vitalsSummary}
            vitalsJson={vitalsJson}
            painScore={painScore}
            mobilityStatus={mobilityStatus}
            ivAccess={ivAccess}
            drainStatus={drainStatus}
            specialConcerns={specialConcerns}
            pendingTaskChips={pendingTaskChips}
            pendingInvChips={pendingInvChips}
          />
          <Button
            type="button"
            className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
            onClick={() => void signReceived()}
            disabled={signing || !handoverId}
          >
            {signing ? "Saving…" : "Received & understood"}
          </Button>
        </>
      ) : null}

      {mode === "readSigned" ? (
        <>
          {sbarReadOnly}
          <QuickReadSection
            vitalsSummary={vitalsSummary}
            vitalsJson={vitalsJson}
            painScore={painScore}
            mobilityStatus={mobilityStatus}
            ivAccess={ivAccess}
            drainStatus={drainStatus}
            specialConcerns={specialConcerns}
            pendingTaskChips={pendingTaskChips}
            pendingInvChips={pendingInvChips}
            readOnly
          />
        </>
      ) : null}

      {mode === "write" ? (
        <>
          {vitalsSummary ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
              <span className="font-semibold text-slate-700">
                Latest vitals (auto)
              </span>
              <p className="mt-1 leading-relaxed">{vitalsSummary}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No nursing vitals recorded yet — snapshot will be empty until vitals
              are saved.
            </p>
          )}

          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-800">From: </span>
            {currentNurseFullName.trim() || "—"} · {shiftUi} shift
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-slate-700">Hand over to *</Label>
              {incomingNurses.length > 0 ? (
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={handoverToId}
                  onChange={(e) => setHandoverToId(e.target.value)}
                >
                  <option value="">Select incoming nurse…</option>
                  {incomingNurses.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.full_name}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <Input
                    className="mt-1"
                    placeholder="Incoming nurse name"
                    value={handoverToFreeText}
                    onChange={(e) => setHandoverToFreeText(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    No other nurses listed — enter the incoming nurse name. Saved in special concerns if not in directory.
                  </p>
                </>
              )}
            </div>
            <div>
              <Label className="text-slate-700">Incoming shift</Label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={incomingShiftUi}
                onChange={(e) => setIncomingShiftUi(e.target.value as NursingShiftUi)}
              >
                <option value="Morning">Morning</option>
                <option value="Afternoon">Afternoon</option>
                <option value="Night">Night</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-slate-700">Situation</Label>
              <Textarea
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                rows={3}
                className="mt-1"
                placeholder="Current status, immediate concerns…"
              />
            </div>
            <div>
              <Label className="text-slate-700">Background</Label>
              <Textarea
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                rows={3}
                className="mt-1"
                placeholder="Context, history relevant to this shift…"
              />
            </div>
            <div>
              <Label className="text-slate-700">Assessment</Label>
              <Textarea
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
                rows={3}
                className="mt-1"
                placeholder="Clinical judgement, trends, risks…"
              />
            </div>
            <div>
              <Label className="text-slate-700">Recommendation</Label>
              <Textarea
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
                rows={3}
                className="mt-1"
                placeholder="What the oncoming shift should do…"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-slate-700">
                Pain score (0–10): {painScore}
              </Label>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={painScore}
                onChange={(e) => setPainScore(Number(e.target.value))}
                className="mt-2 w-full accent-blue-600"
              />
            </div>
            <div>
              <Label className="text-slate-700">Mobility status</Label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={mobilityStatus}
                onChange={(e) => setMobilityStatus(e.target.value)}
              >
                {MOBILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-slate-700">IV access</Label>
              <Input
                value={ivAccess}
                onChange={(e) => setIvAccess(e.target.value)}
                className="mt-1"
                placeholder="e.g. 18G left forearm"
              />
            </div>
            <div>
              <Label className="text-slate-700">Drain status</Label>
              <Input
                value={drainStatus}
                onChange={(e) => setDrainStatus(e.target.value)}
                className="mt-1"
                placeholder="e.g. JP ×2 serosanguinous"
              />
            </div>
          </div>

          <div>
            <Label className="text-slate-700">Special concerns</Label>
            <Textarea
              value={specialConcerns}
              onChange={(e) => setSpecialConcerns(e.target.value)}
              rows={2}
              className="mt-1"
              placeholder="Isolation, behaviour, family, equipment…"
            />
          </div>

          <div>
            <Label className="text-slate-700">Pending tasks</Label>
            <p className="mt-0.5 text-[11px] text-slate-500">
              From today&apos;s shift task queue for this patient — tap × to remove
              before submitting.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pendingTaskChips.length === 0 ? (
                <span className="text-xs text-slate-400">None</span>
              ) : (
                pendingTaskChips.map((t) => (
                  <span
                    key={t.task_id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-800"
                  >
                    {t.task_name}
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-slate-200"
                      onClick={() => removeTaskChip(t.task_id)}
                      aria-label="Remove task"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          <div>
            <Label className="text-slate-700">Pending investigations</Label>
            <div className="mt-1 flex gap-2">
              <Input
                value={invInput}
                onChange={(e) => setInvInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addInvChip();
                  }
                }}
                placeholder="Type and press Enter"
              />
              <Button type="button" variant="outline" onClick={addInvChip}>
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pendingInvChips.map((t, idx) => (
                <span
                  key={`${t}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-900"
                >
                  {t}
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-blue-100"
                    onClick={() => removeInvChip(idx)}
                    aria-label="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => void submitHandover()}
            disabled={saving || !handoverRecipientReady}
          >
            {saving ? "Saving…" : "Submit handover"}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function SbarCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
        {body.trim() ? body : "—"}
      </p>
    </div>
  );
}

function QuickReadSection({
  vitalsSummary,
  vitalsJson,
  painScore,
  mobilityStatus,
  ivAccess,
  drainStatus,
  specialConcerns,
  pendingTaskChips,
  pendingInvChips,
  readOnly,
}: {
  vitalsSummary: string | null;
  vitalsJson: Record<string, unknown>;
  painScore: number;
  mobilityStatus: string;
  ivAccess: string;
  drainStatus: string;
  specialConcerns: string;
  pendingTaskChips: PendingTaskChip[];
  pendingInvChips: string[];
  readOnly?: boolean;
}) {
  const mob =
    MOBILITY_OPTIONS.find((m) => m.value === mobilityStatus)?.label ??
    mobilityStatus;
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
        Quick view
      </p>
      {vitalsSummary ? (
        <p className="text-sm text-slate-800">
          <span className="font-medium text-slate-700">Vitals: </span>
          {vitalsSummary}
        </p>
      ) : !readOnly ? null : (
        <p className="text-xs text-slate-500">No vitals snapshot</p>
      )}
      {readOnly && Object.keys(vitalsJson).length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-600">Raw vitals snapshot</summary>
          <pre className="mt-2 max-h-32 overflow-auto rounded bg-white p-2 text-[10px] text-slate-700">
            {JSON.stringify(vitalsJson, null, 2)}
          </pre>
        </details>
      ) : null}
      <p className="text-sm text-slate-800">
        <span className="font-medium text-slate-700">Pain: </span>
        {painScore}/10
      </p>
      <p className="text-sm text-slate-800">
        <span className="font-medium text-slate-700">Mobility: </span>
        {mob}
      </p>
      <p className="text-sm text-slate-800">
        <span className="font-medium text-slate-700">IV: </span>
        {ivAccess.trim() || "—"}
      </p>
      <p className="text-sm text-slate-800">
        <span className="font-medium text-slate-700">Drains: </span>
        {drainStatus.trim() || "—"}
      </p>
      {specialConcerns.trim() ? (
        <p className="text-sm text-slate-800">
          <span className="font-medium text-slate-700">Special concerns: </span>
          {specialConcerns}
        </p>
      ) : null}
      <div>
        <p className="text-xs font-medium text-slate-700">Pending tasks</p>
        <ul className="mt-1 list-inside list-disc text-sm text-slate-800">
          {pendingTaskChips.length === 0 ? (
            <li className="text-slate-500">None</li>
          ) : (
            pendingTaskChips.map((t) => (
              <li key={t.task_id}>{t.task_name}</li>
            ))
          )}
        </ul>
      </div>
      <div>
        <p className="text-xs font-medium text-slate-700">
          Pending investigations
        </p>
        <ul className="mt-1 list-inside list-disc text-sm text-slate-800">
          {pendingInvChips.length === 0 ? (
            <li className="text-slate-500">None</li>
          ) : (
            pendingInvChips.map((t) => (
              <li key={t}>{t}</li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

export default ShiftHandoverNote;
