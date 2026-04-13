"use client";

import { formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/app/supabase";
import type { NursingShiftUi } from "@/app/lib/nursingShift";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isHighAlertDrug(name: string | null | undefined): boolean {
  const t = (name ?? "").toLowerCase();
  return ["insulin", "heparin", "kcl", "potassium chloride", "morphine", "warfarin"].some((x) => t.includes(x));
}

function fallRiskLevel(score: number): "Low" | "Medium" | "High" {
  if (score <= 7) return "Low";
  if (score <= 13) return "Medium";
  return "High";
}

export type NursePatientPanelProps = {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  nursePractitionerId: string;
  /** Ward shift used for care plan (same as portal selector). */
  selectedShift: NursingShiftUi;
  admissionId: string;
  patientId: string;
  patientName: string;
  patientAge: number | null;
  patientSex: string | null;
  bedLabel: string;
  wardName: string;
  doctorName: string | null;
  allergiesText: string | null;
  onVitalsSaved: () => void;
};

type VitalsHistoryRow = Record<string, unknown>;

type MarRow = Record<string, unknown>;

type DoctorOrderRow = Record<string, unknown>;

type CarePlanRow = Record<string, unknown> | null;

type InterventionRow = { intervention: string; frequency: string };

const inputCls =
  "w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const tabBtn = (active: boolean) =>
  cn(
    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
    active ? "bg-blue-600 text-white shadow-sm" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50",
  );

export default function NursePatientPanel({
  open,
  onClose,
  hospitalId,
  nursePractitionerId,
  selectedShift,
  admissionId,
  patientId,
  patientName,
  patientAge,
  patientSex,
  bedLabel,
  wardName,
  doctorName,
  allergiesText,
  onVitalsSaved,
}: NursePatientPanelProps) {
  const [tab, setTab] = useState<"vitals" | "mar" | "orders" | "care">("vitals");

  const [vitalsLoading, setVitalsLoading] = useState(false);
  const [vitalsHistory, setVitalsHistory] = useState<VitalsHistoryRow[]>([]);
  const [showVitalsForm, setShowVitalsForm] = useState(false);
  const [vitalsSaving, setVitalsSaving] = useState(false);
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [hr, setHr] = useState("");
  const [temp, setTemp] = useState("");
  const [spo2, setSpo2] = useState("");
  const [rr, setRr] = useState("");
  const [pain, setPain] = useState(0);
  const [weight, setWeight] = useState("");
  const [gcs, setGcs] = useState("");

  const [marLoading, setMarLoading] = useState(false);
  const [marRows, setMarRows] = useState<MarRow[]>([]);
  const [giveMarId, setGiveMarId] = useState<string | null>(null);
  const [giveDose, setGiveDose] = useState("");
  const [giveRoute, setGiveRoute] = useState("");
  const [giveIvSite, setGiveIvSite] = useState("");
  const [giveTime, setGiveTime] = useState("");
  const [giveNotes, setGiveNotes] = useState("");
  const [giveAdverse, setGiveAdverse] = useState(false);
  const [giveVerifier, setGiveVerifier] = useState("");
  const [holdMarId, setHoldMarId] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [marBusy, setMarBusy] = useState(false);

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orders, setOrders] = useState<DoctorOrderRow[]>([]);
  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);

  const [careLoading, setCareLoading] = useState(false);
  const [careRow, setCareRow] = useState<CarePlanRow>(null);
  const [careDiag, setCareDiag] = useState("");
  const [careGoal, setCareGoal] = useState("");
  const [careInterventions, setCareInterventions] = useState<InterventionRow[]>([{ intervention: "", frequency: "" }]);
  const [fallScore, setFallScore] = useState("");
  const [braden, setBraden] = useState("");
  const [carePain, setCarePain] = useState(0);
  const [carePainIx, setCarePainIx] = useState("");
  const [eduGiven, setEduGiven] = useState("");
  const [eduUnderstood, setEduUnderstood] = useState(false);
  const [careSaving, setCareSaving] = useState(false);
  const [careFormOpen, setCareFormOpen] = useState(false);

  const loadVitalsHistory = useCallback(async () => {
    setVitalsLoading(true);
    const { data, error } = await supabase
      .from("ipd_vitals")
      .select("*")
      .eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false })
      .limit(5);
    setVitalsLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setVitalsHistory((data ?? []) as VitalsHistoryRow[]);
  }, [admissionId]);

  const loadMar = useCallback(async () => {
    setMarLoading(true);
    const { data, error } = await supabase.rpc("get_nurse_mar_for_patient", {
      p_admission_id: admissionId,
      p_date: todayYmd(),
    });
    setMarLoading(false);
    if (error) {
      toast.error(error.message);
      setMarRows([]);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as MarRow[];
    setMarRows(list);
  }, [admissionId]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    const { data, error } = await supabase
      .from("ipd_doctor_orders")
      .select("*")
      .eq("admission_id", admissionId)
      .eq("order_category", "nursing")
      .eq("status", "active")
      .order("created_at", { ascending: true });
    setOrdersLoading(false);
    if (error) {
      toast.error(error.message);
      setOrders([]);
      return;
    }
    setOrders((data ?? []) as DoctorOrderRow[]);
  }, [admissionId]);

  const loadCare = useCallback(async () => {
    setCareLoading(true);
    const { data, error } = await supabase
      .from("ipd_nursing_care_plans")
      .select("*")
      .eq("admission_id", admissionId)
      .eq("plan_date", todayYmd())
      .eq("shift", selectedShift)
      .maybeSingle();
    setCareLoading(false);
    if (error) {
      toast.error(error.message);
      setCareRow(null);
      return;
    }
    const row = (data ?? null) as CarePlanRow;
    setCareRow(row);
    if (row && typeof row === "object") {
      setCareFormOpen(true);
      const r = row as Record<string, unknown>;
      setCareDiag(s(r.nursing_diagnosis));
      setCareGoal(s(r.patient_goal));
      const rawIv = r.interventions;
      let rows: InterventionRow[] = [{ intervention: "", frequency: "" }];
      if (Array.isArray(rawIv)) {
        rows = (rawIv as unknown[]).map((x) => {
          if (x && typeof x === "object") {
            const o = x as Record<string, unknown>;
            return { intervention: s(o.intervention ?? o.text), frequency: s(o.frequency) };
          }
          return { intervention: String(x), frequency: "" };
        });
        if (rows.length === 0) rows = [{ intervention: "", frequency: "" }];
      } else if (typeof rawIv === "string" && rawIv.trim()) {
        try {
          const j = JSON.parse(rawIv) as unknown;
          if (Array.isArray(j)) {
            rows = j.map((x) =>
              x && typeof x === "object"
                ? {
                    intervention: s((x as Record<string, unknown>).intervention ?? (x as Record<string, unknown>).text),
                    frequency: s((x as Record<string, unknown>).frequency),
                  }
                : { intervention: String(x), frequency: "" },
            );
          }
        } catch {
          /* ignore */
        }
      }
      setCareInterventions(rows);
      setFallScore(r.fall_risk_score != null ? String(r.fall_risk_score) : "");
      setBraden(r.braden_score != null ? String(r.braden_score) : "");
      setCarePain(num(r.pain_score) ?? num(r.nursing_pain_score) ?? 0);
      setCarePainIx(s(r.pain_intervention));
      setEduGiven(s(r.education_given));
      setEduUnderstood(Boolean(r.education_understood));
    } else {
      setCareFormOpen(false);
      setCareDiag("");
      setCareGoal("");
      setCareInterventions([{ intervention: "", frequency: "" }]);
      setFallScore("");
      setBraden("");
      setCarePain(0);
      setCarePainIx("");
      setEduGiven("");
      setEduUnderstood(false);
    }
  }, [admissionId, selectedShift]);

  useEffect(() => {
    if (!open || !admissionId) return;
    void loadVitalsHistory();
    void loadMar();
    void loadOrders();
    void loadCare();
  }, [open, admissionId, loadVitalsHistory, loadMar, loadOrders, loadCare]);

  useEffect(() => {
    if (!giveMarId) return;
    const row = marRows.find((x) => s(x.id) === giveMarId);
    if (!row) return;
    setGiveDose(s(row.dose ?? row.scheduled_dose));
    setGiveRoute(s(row.route));
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    setGiveTime(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setGiveNotes("");
    setGiveAdverse(false);
    setGiveIvSite("");
    setGiveVerifier("");
  }, [giveMarId, marRows]);

  const marBySlot = useMemo(() => {
    const map = new Map<string, MarRow[]>();
    for (const r of marRows) {
      const slot = s(r.scheduled_time ?? r.slot_time ?? r.due_time ?? "—") || "—";
      const list = map.get(slot) ?? [];
      list.push(r);
      map.set(slot, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [marRows]);

  async function saveVitals() {
    setVitalsSaving(true);
    const payload: Record<string, unknown> = {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      recorded_by: nursePractitionerId,
      recorded_at: new Date().toISOString(),
      bp_systolic: bpSys.trim() ? Number.parseFloat(bpSys) : null,
      bp_diastolic: bpDia.trim() ? Number.parseFloat(bpDia) : null,
      heart_rate: hr.trim() ? Number.parseFloat(hr) : null,
      temperature_c: temp.trim() ? Number.parseFloat(temp) : null,
      spo2: spo2.trim() ? Number.parseFloat(spo2) : null,
      respiratory_rate: rr.trim() ? Number.parseFloat(rr) : null,
      pain_score: pain,
      weight_kg: weight.trim() ? Number.parseFloat(weight) : null,
      gcs_total: gcs.trim() ? Number.parseInt(gcs, 10) : null,
    };
    const { error } = await supabase.from("ipd_vitals").insert(payload);
    setVitalsSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vitals saved");
    setShowVitalsForm(false);
    setBpSys("");
    setBpDia("");
    setHr("");
    setTemp("");
    setSpo2("");
    setRr("");
    setPain(0);
    setWeight("");
    setGcs("");
    onVitalsSaved();
    void loadVitalsHistory();
  }

  async function saveMarGiven(row: MarRow) {
    const id = s(row.id);
    if (!id) return;
    const high = isHighAlertDrug(s(row.drug_name ?? row.medication_name));
    if (high && !giveVerifier.trim()) {
      toast.error("High-alert medication: enter verifying nurse ID.");
      return;
    }
    setMarBusy(true);
    const adminTime = giveTime.trim() ? new Date(giveTime).toISOString() : new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: "given",
      administered_at: adminTime,
      administered_by: nursePractitionerId,
      actual_dose_given: giveDose.trim() || null,
      actual_route: giveRoute.trim() || null,
      iv_site: giveIvSite.trim() || null,
      notes: giveNotes.trim() || null,
      adverse_event: giveAdverse,
    };
    if (high && giveVerifier.trim()) {
      patch.verified_by = giveVerifier.trim();
    }
    const { error } = await supabase.from("ipd_mar").update(patch).eq("id", id);
    setMarBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Medication recorded");
    setGiveMarId(null);
    void loadMar();
  }

  async function saveMarHold() {
    if (!holdMarId || !holdReason.trim()) {
      toast.error("Hold reason required");
      return;
    }
    setMarBusy(true);
    const { error } = await supabase
      .from("ipd_mar")
      .update({
        status: "held",
        hold_reason: holdReason.trim(),
      })
      .eq("id", holdMarId);
    setMarBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Medication held");
    setHoldMarId(null);
    setHoldReason("");
    void loadMar();
  }

  async function ackOrder(orderId: string) {
    setOrderBusyId(orderId);
    const { error } = await supabase
      .from("ipd_doctor_orders")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: nursePractitionerId,
      })
      .eq("id", orderId);
    setOrderBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    void loadOrders();
  }

  async function completeOrder(orderId: string) {
    setOrderBusyId(orderId);
    const { error } = await supabase
      .from("ipd_doctor_orders")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    setOrderBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    void loadOrders();
  }

  async function saveCarePlan() {
    setCareSaving(true);
    const interventionsPayload = careInterventions
      .filter((x) => x.intervention.trim() || x.frequency.trim())
      .map((x) => ({ intervention: x.intervention.trim(), frequency: x.frequency.trim() }));
    const base: Record<string, unknown> = {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      plan_date: todayYmd(),
      shift: selectedShift,
      nursing_diagnosis: careDiag.trim() || null,
      patient_goal: careGoal.trim() || null,
      interventions: interventionsPayload,
      fall_risk_score: fallScore.trim() ? Number.parseInt(fallScore, 10) : null,
      braden_score: braden.trim() ? Number.parseInt(braden, 10) : null,
      pain_score: carePain,
      pain_intervention: carePainIx.trim() || null,
      education_given: eduGiven.trim() || null,
      education_understood: eduUnderstood,
      updated_at: new Date().toISOString(),
    };
    const existingId = careRow && typeof careRow === "object" ? s((careRow as Record<string, unknown>).id) : "";
    let error;
    if (existingId) {
      const res = await supabase.from("ipd_nursing_care_plans").update(base).eq("id", existingId);
      error = res.error;
    } else {
      const res = await supabase.from("ipd_nursing_care_plans").insert({
        ...base,
        created_by: nursePractitionerId,
      });
      error = res.error;
    }
    setCareSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Care plan saved");
    void loadCare();
  }

  const fs = num(fallScore);
  const fallLevel = fs != null && !Number.isNaN(fs) ? fallRiskLevel(fs) : null;

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-gray-900">{patientName}</p>
          <p className="text-xs text-gray-500">
            {patientAge != null ? `${patientAge} yrs` : "—"} · {patientSex ?? "—"} · {wardName} · Bed {bedLabel}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Doctor: {doctorName ? `Dr. ${doctorName}` : "—"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100"
        >
          Close
        </button>
      </div>
      {allergiesText ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950">
          Allergies: {allergiesText}
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-gray-200 px-3 py-2">
        <button type="button" className={tabBtn(tab === "vitals")} onClick={() => setTab("vitals")}>
          Vitals
        </button>
        <button type="button" className={tabBtn(tab === "mar")} onClick={() => setTab("mar")}>
          Meds
        </button>
        <button type="button" className={tabBtn(tab === "orders")} onClick={() => setTab("orders")}>
          Orders
        </button>
        <button type="button" className={tabBtn(tab === "care")} onClick={() => setTab("care")}>
          Care plan
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === "vitals" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">Vitals</p>
              <Button type="button" size="sm" className="h-8" onClick={() => setShowVitalsForm((v) => !v)}>
                {showVitalsForm ? "Cancel" : "Record vitals"}
              </Button>
            </div>
            {showVitalsForm ? (
              <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">BP sys</Label>
                    <Input className="mt-1 h-9" value={bpSys} onChange={(e) => setBpSys(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">BP dia</Label>
                    <Input className="mt-1 h-9" value={bpDia} onChange={(e) => setBpDia(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">HR</Label>
                    <Input className="mt-1 h-9" value={hr} onChange={(e) => setHr(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">Temp °C</Label>
                    <Input className="mt-1 h-9" value={temp} onChange={(e) => setTemp(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">SpO₂</Label>
                    <Input className="mt-1 h-9" value={spo2} onChange={(e) => setSpo2(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">RR</Label>
                    <Input className="mt-1 h-9" value={rr} onChange={(e) => setRr(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-gray-500">Pain (0–10)</Label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={pain}
                    onChange={(e) => setPain(Number.parseInt(e.target.value, 10))}
                    className="mt-2 w-full accent-blue-600"
                  />
                  <p className="text-xs text-gray-600">{pain}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">Weight (kg, opt)</Label>
                    <Input className="mt-1 h-9" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-gray-500">GCS (opt)</Label>
                    <Input className="mt-1 h-9" value={gcs} onChange={(e) => setGcs(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                  </div>
                </div>
                <Button type="button" disabled={vitalsSaving} onClick={() => void saveVitals()}>
                  {vitalsSaving ? "Saving…" : "Save vitals"}
                </Button>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last 5 readings</p>
              {vitalsLoading ? (
                <div className="mt-2 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />
                  ))}
                </div>
              ) : vitalsHistory.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No vitals recorded yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                      <tr>
                        <th className="px-2 py-1.5">Time</th>
                        <th className="px-2 py-1.5">BP</th>
                        <th className="px-2 py-1.5">HR</th>
                        <th className="px-2 py-1.5">T</th>
                        <th className="px-2 py-1.5">SpO₂</th>
                        <th className="px-2 py-1.5">Pain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vitalsHistory.map((v) => {
                        const rec = s(v.recorded_at);
                        const t = rec ? formatDistanceToNow(new Date(rec), { addSuffix: true }) : "—";
                        const sys = num(v.bp_systolic);
                        const dia = num(v.bp_diastolic);
                        const bp = sys != null && dia != null ? `${Math.round(sys)}/${Math.round(dia)}` : "—";
                        return (
                          <tr key={s(v.id)} className="border-t border-gray-100">
                            <td className="px-2 py-1.5 text-gray-600">{t}</td>
                            <td className="px-2 py-1.5">{bp}</td>
                            <td className="px-2 py-1.5">{v.heart_rate != null ? String(v.heart_rate) : "—"}</td>
                            <td className="px-2 py-1.5">{v.temperature_c != null ? String(v.temperature_c) : "—"}</td>
                            <td className="px-2 py-1.5">{v.spo2 != null ? String(v.spo2) : "—"}</td>
                            <td className="px-2 py-1.5">{v.pain_score != null ? String(v.pain_score) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === "mar" ? (
          <div className="space-y-4">
            {marLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : marBySlot.length === 0 ? (
              <p className="text-sm text-gray-500">No MAR entries for today.</p>
            ) : (
              marBySlot.map(([slot, rows]) => (
                <div key={slot}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{slot}</p>
                  <div className="mt-2 space-y-2">
                    {rows.map((r) => {
                      const id = s(r.id);
                      const drug = s(r.drug_name ?? r.medication_name ?? "Medication");
                      const dose = s(r.dose ?? r.scheduled_dose);
                      const route = s(r.route);
                      const st = s(r.status ?? "pending").toLowerCase();
                      const high = isHighAlertDrug(drug);
                      const isGive = giveMarId === id;
                      return (
                        <div key={id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-gray-900">
                                {drug}{" "}
                                {high ? (
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">HIGH ALERT</span>
                                ) : null}
                              </p>
                              <p className="text-xs text-gray-600">
                                {dose} · {route}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                                st === "given" && "bg-emerald-100 text-emerald-800",
                                st === "pending" && "bg-amber-100 text-amber-900",
                                st === "held" && "bg-red-100 text-red-800",
                                st === "omitted" && "bg-gray-100 text-gray-600",
                              )}
                            >
                              {st}
                            </span>
                          </div>
                          {st === "pending" ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="default" className="h-8" onClick={() => setGiveMarId(id)}>
                                Mark given
                              </Button>
                              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setHoldMarId(id)}>
                                Hold
                              </Button>
                            </div>
                          ) : null}
                          {isGive ? (
                            <div className="mt-3 space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-[10px] uppercase">Actual dose</Label>
                                  <Input className="mt-1 h-8 text-xs" value={giveDose} onChange={(e) => setGiveDose(e.target.value)} />
                                </div>
                                <div>
                                  <Label className="text-[10px] uppercase">Route</Label>
                                  <Input className="mt-1 h-8 text-xs" value={giveRoute} onChange={(e) => setGiveRoute(e.target.value)} />
                                </div>
                              </div>
                              {giveRoute.toLowerCase().includes("iv") ? (
                                <div>
                                  <Label className="text-[10px] uppercase">IV site</Label>
                                  <Input className="mt-1 h-8 text-xs" value={giveIvSite} onChange={(e) => setGiveIvSite(e.target.value)} />
                                </div>
                              ) : null}
                              <div>
                                <Label className="text-[10px] uppercase">Time given</Label>
                                <Input
                                  className="mt-1 h-8 text-xs"
                                  type="datetime-local"
                                  value={giveTime}
                                  onChange={(e) => setGiveTime(e.target.value)}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] uppercase">Notes</Label>
                                <Textarea className="mt-1 min-h-[48px] text-xs" value={giveNotes} onChange={(e) => setGiveNotes(e.target.value)} />
                              </div>
                              <label className="flex items-center gap-2 text-xs">
                                <input type="checkbox" checked={giveAdverse} onChange={(e) => setGiveAdverse(e.target.checked)} />
                                Adverse event
                              </label>
                              {high ? (
                                <div>
                                  <Label className="text-[10px] uppercase text-red-800">Verifying nurse (practitioner ID)</Label>
                                  <Input
                                    className="mt-1 h-8 border-red-200 text-xs"
                                    value={giveVerifier}
                                    onChange={(e) => setGiveVerifier(e.target.value)}
                                    placeholder="Required"
                                  />
                                </div>
                              ) : null}
                              <div className="flex gap-2">
                                <Button type="button" size="sm" disabled={marBusy} onClick={() => void saveMarGiven(r)}>
                                  Save
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setGiveMarId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            {holdMarId ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <Label className="text-xs">Hold reason</Label>
                <Textarea className="mt-1 text-sm" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} rows={2} />
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" disabled={marBusy} onClick={() => void saveMarHold()}>
                    Confirm hold
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setHoldMarId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "orders" ? (
          <div className="space-y-3">
            {ordersLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-gray-500">No active nursing orders.</p>
            ) : (
              orders.map((o) => {
                const oid = s(o.id);
                const text = s(o.order_text ?? o.instructions ?? o.instruction ?? o.description ?? "Order");
                const pri = s(o.priority ?? "routine");
                const created = s(o.created_at);
                return (
                  <div key={oid} className="rounded-lg border border-gray-200 p-3 text-sm">
                    <p className="font-medium text-gray-900">{text}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium capitalize">{pri}</span>
                      <span>{created ? formatDistanceToNow(new Date(created), { addSuffix: true }) : ""}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={orderBusyId === oid || !!o.acknowledged_at}
                        onClick={() => void ackOrder(oid)}
                      >
                        Acknowledge
                      </Button>
                      <Button type="button" size="sm" className="h-8" disabled={orderBusyId === oid} onClick={() => void completeOrder(oid)}>
                        Mark complete
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        {tab === "care" ? (
          <div className="space-y-4">
            {careLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
                ))}
              </div>
            ) : !careRow && !careFormOpen ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
                <p className="text-sm text-gray-600">No care plan for this shift yet.</p>
                <Button type="button" className="mt-3" size="sm" onClick={() => setCareFormOpen(true)}>
                  Create care plan
                </Button>
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs text-gray-600">Nursing diagnosis</Label>
                  <Textarea className={cn(inputCls, "mt-1 min-h-[72px]")} value={careDiag} onChange={(e) => setCareDiag(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Patient goal</Label>
                  <Textarea className={cn(inputCls, "mt-1 min-h-[72px]")} value={careGoal} onChange={(e) => setCareGoal(e.target.value)} />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-gray-600">Interventions</Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-blue-600"
                      onClick={() => setCareInterventions((rows) => [...rows, { intervention: "", frequency: "" }])}
                    >
                      + Add
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {careInterventions.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Intervention"
                          className="h-9 text-xs"
                          value={row.intervention}
                          onChange={(e) =>
                            setCareInterventions((rows) => rows.map((r, i) => (i === idx ? { ...r, intervention: e.target.value } : r)))
                          }
                        />
                        <Input
                          placeholder="Frequency"
                          className="h-9 text-xs"
                          value={row.frequency}
                          onChange={(e) =>
                            setCareInterventions((rows) => rows.map((r, i) => (i === idx ? { ...r, frequency: e.target.value } : r)))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-600">Fall risk (0–20)</Label>
                    <Input
                      className={cn(inputCls, "mt-1")}
                      value={fallScore}
                      onChange={(e) => setFallScore(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    />
                    {fallLevel ? (
                      <p className="mt-1 text-[11px] text-gray-600">
                        Level: <span className="font-semibold">{fallLevel}</span>
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600">Braden (6–23)</Label>
                    <Input className={cn(inputCls, "mt-1")} value={braden} onChange={(e) => setBraden(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Pain (0–10)</Label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={carePain}
                    onChange={(e) => setCarePain(Number.parseInt(e.target.value, 10))}
                    className="mt-2 w-full accent-blue-600"
                  />
                  <p className="text-xs text-gray-600">{carePain}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Pain intervention</Label>
                  <Input className={cn(inputCls, "mt-1")} value={carePainIx} onChange={(e) => setCarePainIx(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Education given</Label>
                  <Textarea className={cn(inputCls, "mt-1 min-h-[64px]")} value={eduGiven} onChange={(e) => setEduGiven(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={eduUnderstood} onChange={(e) => setEduUnderstood(e.target.checked)} />
                  Education understood
                </label>
                <Button type="button" disabled={careSaving} onClick={() => void saveCarePlan()}>
                  {careSaving ? "Saving…" : careRow ? "Update care plan" : "Save care plan"}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
