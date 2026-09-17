"use client";

import { formatDistanceToNow } from "date-fns";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CurrentUserBadge } from "@/components/CurrentUserBadge";
import NursePatientPanel from "@/components/nursing/NursePatientPanel";
import { MewsScoreBadge } from "../../../components/ipd/MewsScoreBadge";
import { NursingTaskQueue } from "../../../components/ipd/nursing/NursingTaskQueue";
import { ConsumablesPanel } from "../../../components/paramedical/ConsumablesPanel";
import { personInitialsDisplay } from "@/lib/personInitialsDisplay";
import { fetchAuthOrgId } from "@/lib/authOrg";
import { canAccessNursingPortal } from "@/lib/nursingPortalRbac";
import { defaultNursingShiftFromClock, type NursingShiftUi } from "@/lib/nursingShift";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { isMarSlotOverdue } from "../../../components/ipd/nursing/marOverdue";

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

/** Matches ward_staff_assignments.shift to RPC / UI shift (incl. General). */
function shiftMatchesWardAssignment(dbShift: string, uiShift: NursingShiftUi): boolean {
  const a = dbShift.trim().toLowerCase();
  if (a === "general") return true;
  return a === uiShift.toLowerCase();
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

/** Deterministic accent per ward for border / pills / section underline. */
const WARD_ACCENT_PALETTE = [
  {
    border: "border-l-blue-500",
    pill: "bg-blue-100 text-blue-900 ring-1 ring-blue-200/80",
    line: "bg-blue-400",
    heading: "text-blue-900",
  },
  {
    border: "border-l-emerald-500",
    pill: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/80",
    line: "bg-emerald-400",
    heading: "text-emerald-900",
  },
  {
    border: "border-l-violet-500",
    pill: "bg-violet-100 text-violet-900 ring-1 ring-violet-200/80",
    line: "bg-violet-400",
    heading: "text-violet-900",
  },
  {
    border: "border-l-amber-500",
    pill: "bg-amber-100 text-amber-950 ring-1 ring-amber-200/80",
    line: "bg-amber-400",
    heading: "text-amber-950",
  },
  {
    border: "border-l-rose-500",
    pill: "bg-rose-100 text-rose-900 ring-1 ring-rose-200/80",
    line: "bg-rose-400",
    heading: "text-rose-900",
  },
  {
    border: "border-l-cyan-500",
    pill: "bg-cyan-100 text-cyan-900 ring-1 ring-cyan-200/80",
    line: "bg-cyan-400",
    heading: "text-cyan-900",
  },
  {
    border: "border-l-indigo-500",
    pill: "bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200/80",
    line: "bg-indigo-400",
    heading: "text-indigo-900",
  },
  {
    border: "border-l-teal-500",
    pill: "bg-teal-100 text-teal-900 ring-1 ring-teal-200/80",
    line: "bg-teal-400",
    heading: "text-teal-900",
  },
] as const;

function wardPaletteKey(wardId: string, wardName: string): string {
  const id = wardId.trim();
  if (id) return id;
  return `name:${wardName.trim().toLowerCase()}`;
}

function wardAccentForKey(key: string): (typeof WARD_ACCENT_PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33 + key.charCodeAt(i)) >>> 0;
  }
  return WARD_ACCENT_PALETTE[h % WARD_ACCENT_PALETTE.length];
}

function wardInitial(wardName: string): string {
  const t = wardName.trim();
  if (!t) return "?";
  const m = t.match(/[A-Za-z0-9]/);
  return personInitialsDisplay(m ? m[0] : t.charAt(0));
}

/** Bed number segment for pill (e.g. "PVT-1" → "1"). */
function bedNumberSegment(bedRaw: string): string {
  const t = bedRaw.trim();
  if (!t) return "—";
  const lastHyphen = t.lastIndexOf("-");
  if (lastHyphen >= 0) {
    const tail = t.slice(lastHyphen + 1).trim();
    if (tail) return tail;
  }
  return t;
}

function sexAbbrev(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t || t === "—") return "—";
  if (t === "m" || t.startsWith("male")) return "M";
  if (t === "f" || t.startsWith("female")) return "F";
  if (t.startsWith("other") || t === "o") return "O";
  if (t.length <= 3) return raw.trim().toUpperCase();
  return raw.trim().charAt(0).toUpperCase();
}

function formatTempDisplay(v: unknown): string | null {
  const n = num(v);
  if (n == null) return null;
  if (n <= 45) return `${Number.isInteger(n) ? String(n) : n.toFixed(1)}°C`;
  return `${Number.isInteger(n) ? String(n) : n.toFixed(1)}°F`;
}

type MewsBrief = { score: number | null; level: string | null };

function buildVitalsSummary(p: WardPatientRow): { line: string | null; allEmpty: boolean } {
  const sys = num(p.latest_bp_systolic ?? p.bp_systolic);
  const dia = num(p.latest_bp_diastolic ?? p.bp_diastolic);
  const hr = num(p.latest_heart_rate ?? p.heart_rate);
  const spo2 = num(p.latest_spo2 ?? p.spo2);
  const tempStr = formatTempDisplay(p.latest_temperature_c ?? p.temperature_c);
  const pain = num(p.latest_pain_score ?? p.pain_score);

  const parts: string[] = [];
  if (sys != null && dia != null) {
    parts.push(`BP ${Math.round(sys)}/${Math.round(dia)}`);
  }
  if (hr != null) parts.push(`HR ${Math.round(hr)}`);
  if (spo2 != null) parts.push(`SpO₂ ${Math.round(spo2)}%`);
  if (tempStr) parts.push(`T ${tempStr}`);
  if (pain != null) parts.push(`Pain ${Math.round(pain)}/10`);

  const allEmpty = parts.length === 0;
  return { line: allEmpty ? null : parts.join(" · "), allEmpty };
}

export default function NursingPortalPage() {
  const router = useRouter();
  const [access, setAccess] = useState<"pending" | "ok" | "denied">("pending");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [nurseId, setNurseId] = useState<string | null>(null);
  const [shift, setShift] = useState<NursingShiftUi>(() => defaultNursingShiftFromClock());
  const [rows, setRows] = useState<WardPatientRow[]>([]);
  const [mewsByAdmission, setMewsByAdmission] = useState<Map<string, MewsBrief>>(() => new Map());
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<WardPatientRow | null>(null);
  const [consumablesWardId, setConsumablesWardId] = useState<string | null>(null);
  /** Whether this nurse has an active ward_staff_assignments row for today + shift (null until first load). */
  const [hasWardAssignmentForShift, setHasWardAssignmentForShift] = useState<boolean | null>(null);
  /** Pending MAR slots past due (+2h) for today, keyed by admission_id — from client `ipd_mar` read. */
  const [marOverdueByAdmission, setMarOverdueByAdmission] = useState<Map<string, number>>(() => new Map());

  const wardOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const wid = s(r.ward_id);
      if (!wid) continue;
      const wn = s(r.ward_name ?? r.ward ?? "Ward");
      m.set(wid, wn);
    }
    return [...m.entries()];
  }, [rows]);

  useEffect(() => {
    if (wardOptions.length === 0) {
      setConsumablesWardId(null);
      return;
    }
    setConsumablesWardId((prev) => {
      if (prev && wardOptions.some(([id]) => id === prev)) return prev;
      return wardOptions[0][0];
    });
  }, [wardOptions]);

  const loadPatients = useCallback(
    async (hid: string | null, nid: string | null, sh: NursingShiftUi) => {
      if (!hid || !nid) {
        setRows([]);
        setMewsByAdmission(new Map());
        setHasWardAssignmentForShift(null);
        return;
      }
      setLoading(true);
      setLoadErr(null);
      const today = todayYmd();
      const [wardRes, mewsRes, assignRes] = await Promise.all([
        supabase.rpc("get_nurse_ward_patients", {
          p_nurse_id: nid,
          p_hospital_id: hid,
          p_shift: sh,
          p_date: today,
        }),
        supabase.rpc("get_ward_mews_summary", { p_hospital_id: hid }),
        supabase
          .from("ward_staff_assignments")
          .select("shift")
          .eq("hospital_id", hid)
          .eq("practitioner_id", nid)
          .eq("is_active", true)
          .lte("start_date", today)
          .gte("end_date", today),
      ]);
      setLoading(false);
      if (assignRes.error) {
        console.warn("[nursing] ward_staff_assignments:", assignRes.error.message);
        setHasWardAssignmentForShift(true);
      } else {
        const assigns = (Array.isArray(assignRes.data) ? assignRes.data : []) as { shift?: string }[];
        setHasWardAssignmentForShift(
          assigns.some((row) => shiftMatchesWardAssignment(String(row.shift ?? ""), sh)),
        );
      }
      if (wardRes.error) {
        setLoadErr(wardRes.error.message);
        setRows([]);
        setMewsByAdmission(new Map());
        return;
      }
      setRows((Array.isArray(wardRes.data) ? wardRes.data : []) as WardPatientRow[]);

      const nextMews = new Map<string, MewsBrief>();
      if (!mewsRes.error && mewsRes.data) {
        const arr = Array.isArray(mewsRes.data) ? mewsRes.data : [];
        for (const raw of arr) {
          if (!raw || typeof raw !== "object") continue;
          const o = raw as Record<string, unknown>;
          const aid = s(o.admission_id);
          if (!aid) continue;
          nextMews.set(aid, {
            score: num(o.mews_score),
            level: o.mews_alert_level != null ? String(o.mews_alert_level) : null,
          });
        }
      }
      setMewsByAdmission(nextMews);
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

  useEffect(() => {
    if (access !== "ok" || rows.length === 0) {
      setMarOverdueByAdmission(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const ymd = todayYmd();
      const ids = [...new Set(rows.map((r) => s(r.admission_id)).filter(Boolean))];
      const { data, error } = await supabase
        .from("ipd_mar")
        .select("admission_id, scheduled_date, scheduled_time, status")
        .eq("scheduled_date", ymd)
        .eq("status", "pending")
        .in("admission_id", ids);
      if (cancelled) return;
      if (error) {
        console.warn("[nursing] ipd_mar overdue scan:", error.message);
        setMarOverdueByAdmission(new Map());
        return;
      }
      const list = Array.isArray(data) ? data : [];
      const counts = new Map<string, number>();
      for (const raw of list) {
        const o = raw as Record<string, unknown>;
        const aid = s(o.admission_id);
        const sd = s(o.scheduled_date);
        const stime = s(o.scheduled_time);
        if (!aid) continue;
        const dateForSlot = sd || ymd;
        if (!isMarSlotOverdue(dateForSlot, stime)) continue;
        counts.set(aid, (counts.get(aid) ?? 0) + 1);
      }
      setMarOverdueByAdmission(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [access, rows]);

  const filteredRows = useMemo(() => {
    if (!alertsOnly) return rows;
    return rows.filter((r) => {
      const m = mewsByAdmission.get(s(r.admission_id));
      if (!m || m.score == null) return false;
      const lv = (m.level ?? "").toLowerCase();
      return m.score >= 3 || lv === "escalate" || lv === "critical";
    });
  }, [rows, alertsOnly, mewsByAdmission]);

  const byWard = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      const ida = s(a.admission_id);
      const idb = s(b.admission_id);
      const sa = mewsByAdmission.get(ida)?.score;
      const sb = mewsByAdmission.get(idb)?.score;
      const na = sa == null ? -1 : sa;
      const nb = sb == null ? -1 : sb;
      if (nb !== na) return nb - na;
      return s(a.patient_name ?? a.full_name).localeCompare(s(b.patient_name ?? b.full_name));
    });
    const map = new Map<string, WardPatientRow[]>();
    for (const r of sorted) {
      const w = s(r.ward_name ?? r.ward ?? "Ward");
      const list = map.get(w) ?? [];
      list.push(r);
      map.set(w, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows, mewsByAdmission]);

  const showNotAssignedBanner =
    access === "ok" &&
    !loading &&
    !loadErr &&
    rows.length === 0 &&
    hasWardAssignmentForShift === false;

  const assignedButNoPatients =
    access === "ok" &&
    !loading &&
    !loadErr &&
    rows.length === 0 &&
    hasWardAssignmentForShift === true;
  const noAlertsMatch = access === "ok" && !loading && !loadErr && rows.length > 0 && alertsOnly && filteredRows.length === 0;

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Nursing</h1>
            <p className="text-xs text-gray-500">Ward patients for your shift · {todayYmd()}</p>
          </div>
          <CurrentUserBadge className="shrink-0" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {(["Morning", "Afternoon", "Night"] as const).map((sh) => (
              <button
                key={sh}
                type="button"
                onClick={() => setShift(sh)}
                className={cn(
                  "rounded-full px-4 py-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                  shift === sh
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-gray-300 bg-transparent text-gray-700 hover:bg-gray-100/80",
                )}
              >
                {sh}
              </button>
            ))}
          </div>
          {rows.length > 0 ? (
            <button
              type="button"
              onClick={() => setAlertsOnly((v) => !v)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                alertsOnly ? "bg-red-600 text-white shadow-sm hover:bg-red-600/90" : "border border-gray-300 text-gray-700 hover:bg-gray-100",
              )}
            >
              Alerts only
            </button>
          ) : null}
        </div>
      </header>

      <div
        className={cn(
          "mx-auto max-w-6xl px-4 sm:px-6",
          showNotAssignedBanner ? "flex min-h-[calc(100vh-10rem)] flex-col justify-center py-6" : "py-6",
        )}
      >
        {loadErr ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadErr}</div>
        ) : null}

        {access === "ok" && hospitalId && nurseId ? (
          <NursingTaskQueue
            hospitalId={hospitalId}
            nurseId={nurseId}
            shiftUi={shift}
            onShiftUiChange={setShift}
            embedShiftSelector={false}
            dateYmd={todayYmd()}
            className="mb-10"
          />
        ) : null}

        {access === "ok" && hospitalId && nurseId && consumablesWardId && wardOptions.length > 0 ? (
          <div className="mb-10 space-y-3">
            {wardOptions.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-gray-600" htmlFor="consumables-ward">
                  Consumables ward
                </label>
                <select
                  id="consumables-ward"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm"
                  value={consumablesWardId}
                  onChange={(e) => setConsumablesWardId(e.target.value)}
                >
                  {wardOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <ConsumablesPanel
              wardId={consumablesWardId}
              hospitalId={hospitalId}
              practitionerId={nurseId}
            />
          </div>
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
        ) : showNotAssignedBanner ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-amber-200/80 bg-amber-50/90 px-6 py-14 text-center shadow-sm">
            <Building2 className="h-12 w-12 text-amber-700/50" aria-hidden />
            <p className="mt-5 text-sm font-semibold text-amber-950">You are not assigned to any ward for this shift.</p>
            <p className="mt-2 max-w-sm text-xs text-amber-900/90">
              Contact admin to set ward assignment in Staff directory.
            </p>
          </div>
        ) : assignedButNoPatients ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-600 shadow-sm">
            No in-progress admissions in your assigned wards for this shift.
          </div>
        ) : noAlertsMatch ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-sm text-gray-600">
            No patients in escalate or critical MEWS range for this shift.
            <button
              type="button"
              className="mt-3 block w-full text-center text-xs font-semibold text-blue-700 hover:underline"
              onClick={() => setAlertsOnly(false)}
            >
              Show all patients
            </button>
          </div>
        ) : (
          <div className="space-y-10">
            {byWard.map(([wardName, patients]) => {
              const wFirst = patients[0];
              const sectionKey = wardPaletteKey(s(wFirst?.ward_id), wardName);
              const sectionAccent = wardAccentForKey(sectionKey);
              return (
                <section key={wardName}>
                  <div className="mb-4 flex items-center gap-3">
                    <h2 className={cn("shrink-0 text-sm font-bold uppercase tracking-wide", sectionAccent.heading)}>
                      {wardName}
                    </h2>
                    <div className={cn("h-px min-w-[1.5rem] flex-1 rounded-full", sectionAccent.line)} aria-hidden />
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">
                      {patients.length} bed{patients.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {patients.map((p, idx) => {
                      const admId = s(p.admission_id);
                      const name = s(p.patient_name ?? p.full_name ?? "Patient");
                      const bed = s(p.bed_number ?? p.bed ?? "");
                      const rowWardName = s(p.ward_name ?? p.ward ?? wardName);
                      const wKey = wardPaletteKey(s(p.ward_id), rowWardName);
                      const accent = wardAccentForKey(wKey);
                      const age = num(p.patient_age ?? p.age);
                      const sexRaw = s(p.patient_sex ?? p.sex);
                      const dxRaw = s(p.primary_diagnosis ?? p.diagnosis ?? p.admitting_diagnosis ?? "");
                      const hasDx = Boolean(dxRaw);
                      const vitIso = s(p.vitals_recorded_at ?? p.latest_vitals_at ?? "");
                      const medsDue = num(p.pending_mar_count ?? p.pending_meds_count ?? p.pending_meds) ?? 0;
                      const ordDue = num(p.pending_nursing_orders_count ?? p.pending_orders_count ?? p.pending_orders) ?? 0;
                      const pendingTotal = medsDue + ordDue;
                      const marOverdue = marOverdueByAdmission.get(admId) ?? 0;
                      const { line: vitalsLine, allEmpty } = buildVitalsSummary(p);
                      const mews = mewsByAdmission.get(admId);
                      const redMews =
                        (mews?.level ?? "").toLowerCase() === "critical" ||
                        (mews?.score != null && mews.score >= 5);
                      return (
                        <button
                          key={`${admId}-${idx}`}
                          type="button"
                          onClick={() => setSelected(p)}
                          className={cn(
                            "relative flex w-full flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition duration-200",
                            "border-l-4 hover:-translate-y-0.5 hover:shadow-lg",
                            redMews ? "border-l-red-600 bg-red-50/60" : accent.border,
                          )}
                        >
                          {pendingTotal > 0 ? (
                            <span
                              className={cn(
                                "absolute right-3 top-3 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold shadow-sm ring-2 ring-white",
                                marOverdue > 0 ? "bg-red-500 text-white" : "bg-slate-200 text-slate-800",
                              )}
                              title={
                                marOverdue > 0
                                  ? `${marOverdue} overdue dose(s); ${medsDue} pending med(s), ${ordDue} pending order(s)`
                                  : `${medsDue} pending med(s), ${ordDue} pending order(s)`
                              }
                            >
                              {pendingTotal}
                            </span>
                          ) : null}
                          <div className="flex items-start gap-3 pr-7">
                            <div
                              className={cn(
                                "flex h-11 min-w-[3rem] shrink-0 items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums",
                                accent.pill,
                              )}
                            >
                              <span className="leading-tight">
                                <span className="opacity-95">{wardInitial(rowWardName)}</span>
                                <span className="mx-0.5 text-[10px] font-semibold opacity-70">·</span>
                                <span>{bedNumberSegment(bed || "—")}</span>
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-semibold text-gray-900">{name}</p>
                              <p className="text-xs text-gray-500">
                                {age != null ? `${age}y` : "—"} · {sexAbbrev(sexRaw)}
                              </p>
                              <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                                {losBadge(p)}
                              </span>
                            </div>
                          </div>
                          {hasDx ? (
                            <p className="mt-2 line-clamp-2 text-xs text-gray-600">{dxRaw}</p>
                          ) : (
                            <p className="mt-2 text-xs italic text-gray-400">No diagnosis</p>
                          )}
                          {vitalsLine ? (
                            <p className="mt-2 text-[11px] leading-snug text-gray-800">{vitalsLine}</p>
                          ) : null}
                          <div className="mt-2">
                            <MewsScoreBadge score={mews?.score ?? null} alertLevel={mews?.level ?? null} />
                          </div>
                          {vitIso ? (
                            <p className={cn("mt-1 text-[11px]", vitalsAgeColor(vitIso))}>
                              Recorded {formatDistanceToNow(new Date(vitIso), { addSuffix: true })}
                            </p>
                          ) : allEmpty ? (
                            <p className="mt-1 text-[11px] text-gray-500">No recent vitals</p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
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
          admittedAt={s(selected.admitted_at ?? selected.admission_date ?? selected.admission_timestamp ?? selected.created_at)}
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
