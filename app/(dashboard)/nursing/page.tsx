"use client";

import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import NursePatientPanel from "@/app/components/nursing/NursePatientPanel";
import { fetchAuthOrgId } from "@/app/lib/authOrg";
import { canAccessNursingPortal } from "@/app/lib/nursingPortalRbac";
import { defaultNursingShiftFromClock, type NursingShiftUi } from "@/app/lib/nursingShift";
import { supabase } from "@/app/supabase";
import { cn } from "@/lib/utils";

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

type WardPatientRow = Record<string, unknown>;

function losBadge(row: WardPatientRow): string {
  const d = num(row.los_days);
  if (d != null) return `Day ${Math.max(1, Math.floor(d))}`;
  const adm = s(row.admission_date ?? row.admitted_at);
  if (!adm) return "—";
  const t = Date.parse(adm.slice(0, 10));
  if (Number.isNaN(t)) return "—";
  const start = new Date(t);
  const now = new Date();
  const diff = Math.floor((now.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1;
  return `Day ${Math.max(1, diff)}`;
}

function vitalsAgeColor(iso: string | null): string {
  if (!iso) return "text-gray-500";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "text-gray-500";
  const hrs = (Date.now() - t) / (3600 * 1000);
  return hrs > 4 ? "text-red-600 font-semibold" : "text-gray-600";
}

export default function NursingPortalPage() {
  const router = useRouter();
  const [access, setAccess] = useState<"pending" | "ok" | "denied">("pending");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [nurseId, setNurseId] = useState<string | null>(null);
  const [shift, setShift] = useState<NursingShiftUi>(() => defaultNursingShiftFromClock());
  const [rows, setRows] = useState<WardPatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<WardPatientRow | null>(null);

  const loadPatients = useCallback(
    async (hid: string | null, nid: string | null, sh: NursingShiftUi) => {
      if (!hid || !nid) {
        setRows([]);
        return;
      }
      setLoading(true);
      setLoadErr(null);
      const { data, error } = await supabase.rpc("get_nurse_ward_patients", {
        p_nurse_id: nid,
        p_hospital_id: hid,
        p_shift: sh,
        p_date: todayYmd(),
      });
      setLoading(false);
      if (error) {
        setLoadErr(error.message);
        setRows([]);
        return;
      }
      setRows((Array.isArray(data) ? data : []) as WardPatientRow[]);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid) {
        if (!cancelled) {
          toast.error("Access denied — Nursing portal is for nursing staff only");
          setAccess("denied");
          router.replace("/dashboard");
        }
        return;
      }

      const sel = "id, role, full_name, user_role";
      let prRow: Record<string, unknown> | null = null;
      const byUserId = await supabase.from("practitioners").select(sel).eq("user_id", uid).maybeSingle();
      if (byUserId.data && typeof byUserId.data === "object") {
        prRow = byUserId.data as Record<string, unknown>;
      }
      if (!prRow) {
        const byPk = await supabase.from("practitioners").select(sel).eq("id", uid).maybeSingle();
        if (byPk.data && typeof byPk.data === "object") prRow = byPk.data as Record<string, unknown>;
      }
      if (prRow) setLoadErr(null);
      else if (byUserId.error) setLoadErr(byUserId.error.message);

      if (cancelled) return;

      if (!prRow) {
        toast.error("Access denied — Nursing portal is for nursing staff only");
        setAccess("denied");
        router.replace("/dashboard");
        return;
      }

      if (!canAccessNursingPortal(prRow)) {
        toast.error("Access denied — Nursing portal is for nursing staff only");
        setAccess("denied");
        router.replace("/dashboard");
        return;
      }

      setNurseId(s(prRow.id));

      const { orgId, error: orgErr } = await fetchAuthOrgId();
      if (cancelled) return;
      if (orgErr) {
        setLoadErr(orgErr.message);
        setAccess("ok");
        setLoading(false);
        return;
      }
      setLoadErr(null);
      setHospitalId(orgId);
      setAccess("ok");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (access !== "ok") return;
    void loadPatients(hospitalId, nurseId, shift);
  }, [access, hospitalId, nurseId, shift, loadPatients]);

  const byWard = useMemo(() => {
    const map = new Map<string, WardPatientRow[]>();
    for (const r of rows) {
      const w = s(r.ward_name ?? r.ward ?? "Ward");
      const list = map.get(w) ?? [];
      list.push(r);
      map.set(w, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const unassigned = access === "ok" && !loading && !loadErr && rows.length === 0;

  if (access === "denied") return null;

  if (access === "pending") {
    return (
      <div className="min-h-screen bg-slate-50 text-gray-900">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="space-y-4">
            <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl bg-gray-200/80" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <h1 className="text-lg font-bold">Nursing</h1>
        <p className="text-xs text-gray-500">Ward patients for your shift · {todayYmd()}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["Morning", "Afternoon", "Night"] as const).map((sh) => (
            <button
              key={sh}
              type="button"
              onClick={() => setShift(sh)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                shift === sh ? "bg-blue-600 text-white shadow-sm" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50",
              )}
            >
              {sh}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {loadErr ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadErr}</div>
        ) : null}

        {loading ? (
          <div className="space-y-4">
            <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl bg-gray-200/80" />
              ))}
            </div>
          </div>
        ) : unassigned ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-amber-950">You are not assigned to any ward for this shift.</p>
            <p className="mt-2 text-xs text-amber-900/90">Contact admin to set ward assignment in Staff directory.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {byWard.map(([wardName, patients]) => (
              <section key={wardName}>
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">{wardName}</h2>
                  <span className="text-xs text-gray-500">{patients.length} bed{patients.length === 1 ? "" : "s"}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {patients.map((p, idx) => {
                    const admId = s(p.admission_id);
                    const pid = s(p.patient_id);
                    const name = s(p.patient_name ?? p.full_name ?? "Patient");
                    const bed = s(p.bed_number ?? p.bed ?? "—");
                    const age = num(p.patient_age ?? p.age);
                    const sex = s(p.patient_sex ?? p.sex ?? "—");
                    const dx = s(p.primary_diagnosis ?? p.diagnosis ?? p.admitting_diagnosis ?? "—");
                    const sys = num(p.latest_bp_systolic ?? p.bp_systolic);
                    const dia = num(p.latest_bp_diastolic ?? p.bp_diastolic);
                    const bp = sys != null && dia != null ? `${Math.round(sys)}/${Math.round(dia)}` : "—";
                    const hr = p.latest_heart_rate ?? p.heart_rate;
                    const spo2 = p.latest_spo2 ?? p.spo2;
                    const temp = p.latest_temperature_c ?? p.temperature_c;
                    const pain = p.latest_pain_score ?? p.pain_score;
                    const vitIso = s(p.vitals_recorded_at ?? p.latest_vitals_at ?? "");
                    const medsDue = num(p.pending_mar_count ?? p.pending_meds_count) ?? 0;
                    const ordDue = num(p.pending_nursing_orders_count ?? p.pending_orders_count) ?? 0;
                    return (
                      <button
                        key={`${admId}-${idx}`}
                        type="button"
                        onClick={() => setSelected(p)}
                        className="flex w-full flex-col rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xl font-bold text-white">
                            {bed}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-gray-900">{name}</p>
                            <p className="text-xs text-gray-500">
                              {age != null ? `${age} yrs` : "—"} · {sex}
                            </p>
                            <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                              {losBadge(p)}
                            </span>
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs text-gray-600">{dx}</p>
                        <div className="mt-2 text-[11px] text-gray-700">
                          <span className="font-medium">BP</span> {bp} · <span className="font-medium">HR</span>{" "}
                          {hr != null ? String(hr) : "—"} · <span className="font-medium">SpO₂</span>{" "}
                          {spo2 != null ? String(spo2) : "—"} · <span className="font-medium">T</span>{" "}
                          {temp != null ? String(temp) : "—"} · <span className="font-medium">Pain</span>{" "}
                          {pain != null ? String(pain) : "—"}
                        </div>
                        <p className={cn("mt-1 text-[11px]", vitalsAgeColor(vitIso || null))}>
                          Vitals: {vitIso ? formatDistanceToNow(new Date(vitIso), { addSuffix: true }) : "No recent vitals"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {medsDue > 0 ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                              {medsDue} meds due
                            </span>
                          ) : null}
                          {ordDue > 0 ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                              {ordDue} orders
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {selected && hospitalId && nurseId ? (
        <NursePatientPanel
          open
          onClose={() => setSelected(null)}
          hospitalId={hospitalId}
          nursePractitionerId={nurseId}
          selectedShift={shift}
          admissionId={s(selected.admission_id)}
          patientId={s(selected.patient_id)}
          patientName={s(selected.patient_name ?? selected.full_name ?? "Patient")}
          patientAge={num(selected.patient_age ?? selected.age)}
          patientSex={s(selected.patient_sex ?? selected.sex)}
          bedLabel={s(selected.bed_number ?? selected.bed ?? "—")}
          wardName={s(selected.ward_name ?? selected.ward ?? "Ward")}
          doctorName={s(selected.doctor_name ?? selected.attending_doctor_name ?? selected.primary_doctor_name)}
          allergiesText={s(selected.allergies ?? selected.allergy_text) || null}
          onVitalsSaved={() => void loadPatients(hospitalId, nurseId, shift)}
        />
      ) : null}
    </div>
  );
}
