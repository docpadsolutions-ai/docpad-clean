"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PatientAvatar } from "@/components/patient/patient-avatar";
import { useToast } from "@/components/ui/toast-provider";
import { fetchAuthOrgId } from "@/lib/authOrg";
import { practitionersOrFilterForAuthUid } from "@/lib/practitionerAuthLookup";
import { isSupabaseAbortError, sx } from "@/lib/supabaseAbort";
import { supabase } from "@/lib/supabase";

type MyPatientRow = {
  patient_id: string;
  full_name: string | null;
  age_years: number | null;
  sex: string | null;
  phone: string | null;
  docpad_id: string | null;
  blood_group: string | null;
  known_allergies: unknown;
  chronic_conditions: unknown;
  total_encounters: number | null;
  last_encounter_date: string | null;
  last_encounter_status: string | null;
  last_chief_complaint: string | null;
  last_diagnosis: string | null;
  last_follow_up_date: string | null;
  first_seen_date: string | null;
};

type FilterChip = "all" | "active" | "completed" | "followup";

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseYmdToLocalDate(ymd: string | null | undefined): Date | null {
  if (!ymd?.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, mo - 1, day);
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.trim().slice(0, 10);
  return new Date(t).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeStatus(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function isFollowUpDueRow(row: MyPatientRow): boolean {
  const st = normalizeStatus(row.last_encounter_status);
  if (st === "completed") return false;
  const d = parseYmdToLocalDate(row.last_follow_up_date);
  if (!d) return false;
  const today = startOfTodayLocal();
  return d.getTime() <= today.getTime();
}

function isFollowUpOverdue(row: MyPatientRow): boolean {
  const st = normalizeStatus(row.last_encounter_status);
  if (st === "completed") return false;
  const d = parseYmdToLocalDate(row.last_follow_up_date);
  if (!d) return false;
  return d.getTime() < startOfTodayLocal().getTime();
}

function passesFilter(row: MyPatientRow, filter: FilterChip): boolean {
  const st = normalizeStatus(row.last_encounter_status);
  switch (filter) {
    case "all":
      return true;
    case "active":
      return st === "in_progress" || st === "draft";
    case "completed":
      return st === "completed";
    case "followup":
      return isFollowUpDueRow(row);
    default:
      return true;
  }
}

function StatusBadge({ status }: { status: string | null }) {
  const st = normalizeStatus(status);
  if (st === "completed") {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
        Completed
      </span>
    );
  }
  if (st === "in_progress") {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200/80">
        In Progress
      </span>
    );
  }
  if (st === "draft") {
    return (
      <span className="inline-flex shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/80">
        Draft
      </span>
    );
  }
  const label = status?.trim() || "Unknown";
  return (
    <span className="inline-flex shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200/80">
      {label}
    </span>
  );
}

function PatientCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="h-12 w-12 shrink-0 rounded-full bg-slate-200" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-slate-200" />
            <div className="h-3 w-28 rounded bg-slate-100" />
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 space-y-2 sm:block">
          <div className="h-3 w-full max-w-xs rounded bg-slate-100" />
          <div className="h-3 w-full max-w-sm rounded bg-slate-100" />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <div className="h-6 w-16 rounded-full bg-slate-200" />
          <div className="h-6 w-24 rounded-full bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

export default function MyPatientsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<MyPatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<FilterChip>("all");
  const [openingPatientId, setOpeningPatientId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const loadContext = useCallback(async (signal?: AbortSignal) => {
    setFetchError(null);
    const { orgId: hid, error: orgErr } = await fetchAuthOrgId(signal);
    if (orgErr) {
      setFetchError(orgErr.message);
      setHospitalId(null);
      setDoctorId(null);
      setLoading(false);
      return;
    }
    setHospitalId(hid ?? null);
    if (!hid?.trim()) {
      setFetchError("Your account is not linked to a hospital.");
      setDoctorId(null);
      setLoading(false);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setFetchError("Not signed in.");
      setDoctorId(null);
      setLoading(false);
      return;
    }

    const { data: pr, error: prErr } = await sx(
      supabase.from("practitioners").select("id").or(practitionersOrFilterForAuthUid(uid)).maybeSingle(),
      signal,
    );

    if (prErr || !pr?.id) {
      if (prErr && isSupabaseAbortError(prErr)) return;
      setFetchError(prErr?.message ?? "No practitioner profile for this login.");
      setDoctorId(null);
      setLoading(false);
      return;
    }
    setDoctorId(String(pr.id));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadContext(controller.signal);
    return () => controller.abort();
  }, [loadContext]);

  const fetchPatients = useCallback(async (signal?: AbortSignal) => {
    const hid = hospitalId?.trim();
    const did = doctorId?.trim();
    if (!hid || !did) return;

    setLoading(true);
    setFetchError(null);

    const searchArg = debouncedSearch.length > 0 ? debouncedSearch : null;

    const { data, error } = await sx(
      supabase.rpc("get_my_patients", {
        p_doctor_id: did,
        p_hospital_id: hid,
        p_search: searchArg,
        p_limit: 50,
        p_offset: 0,
      }),
      signal,
    );

    if (error) {
      if (isSupabaseAbortError(error)) {
        setLoading(false);
        return;
      }
      setFetchError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const mapped: MyPatientRow[] = list.map((r) => ({
      patient_id: String(r.patient_id ?? ""),
      full_name: r.full_name != null ? String(r.full_name) : null,
      age_years: r.age_years != null ? Number(r.age_years) : null,
      sex: r.sex != null ? String(r.sex) : null,
      phone: r.phone != null ? String(r.phone) : null,
      docpad_id: r.docpad_id != null ? String(r.docpad_id) : null,
      blood_group: r.blood_group != null ? String(r.blood_group) : null,
      known_allergies: r.known_allergies,
      chronic_conditions: r.chronic_conditions,
      total_encounters: r.total_encounters != null ? Number(r.total_encounters) : null,
      last_encounter_date: r.last_encounter_date != null ? String(r.last_encounter_date) : null,
      last_encounter_status: r.last_encounter_status != null ? String(r.last_encounter_status) : null,
      last_chief_complaint: r.last_chief_complaint != null ? String(r.last_chief_complaint) : null,
      last_diagnosis: r.last_diagnosis != null ? String(r.last_diagnosis) : null,
      last_follow_up_date: r.last_follow_up_date != null ? String(r.last_follow_up_date) : null,
      first_seen_date: r.first_seen_date != null ? String(r.first_seen_date) : null,
    }));

    setRows(mapped.filter((x) => x.patient_id.length > 0));
    setLoading(false);
  }, [hospitalId, doctorId, debouncedSearch]);

  useEffect(() => {
    if (!doctorId?.trim() || !hospitalId?.trim()) return;
    const controller = new AbortController();
    void fetchPatients(controller.signal);
    return () => controller.abort();
  }, [doctorId, hospitalId, debouncedSearch, fetchPatients]);

  const filteredRows = useMemo(() => rows.filter((r) => passesFilter(r, filter)), [rows, filter]);

  const openPatientChart = useCallback(
    async (patientId: string) => {
      const hid = hospitalId?.trim();
      if (!hid) {
        toast.error({ title: "Missing hospital context." });
        return;
      }
      setOpeningPatientId(patientId);
      try {
        const { data, error } = await supabase
          .from("opd_encounters")
          .select("id")
          .eq("patient_id", patientId)
          .eq("hospital_id", hid)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          toast.error({ title: error.message });
          return;
        }
        const eid = data?.id != null ? String(data.id) : "";
        if (!eid) {
          toast.error({ title: "No OPD encounter found for this patient." });
          return;
        }
        router.push(`/dashboard/opd/encounter/${eid}`);
      } finally {
        setOpeningPatientId(null);
      }
    },
    [hospitalId, router, toast],
  );

  const chipBtn = (id: FilterChip, label: string) => {
    const active = filter === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setFilter(id)}
        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
          active ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-4 border-b border-slate-200/80 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Patients</h1>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200/80">
              {loading ? "…" : filteredRows.length}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block min-w-[min(100%,20rem)] flex-1">
            <span className="sr-only">Search patients</span>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone, or complaint…"
              autoComplete="off"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-500/20 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {chipBtn("all", "All")}
            {chipBtn("active", "Active")}
            {chipBtn("completed", "Completed")}
            {chipBtn("followup", "Follow-up Due")}
          </div>
        </div>
      </header>

      {fetchError ? (
        <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-800">{fetchError}</div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <PatientCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 py-16 text-center text-sm font-medium text-slate-600">
          {rows.length === 0 ? "No patients consulted yet" : "No patients match this filter."}
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="My patients">
          {filteredRows.map((row) => {
            const name = row.full_name?.trim() || "Unknown patient";
            const pid = row.patient_id;
            const metaBits = [
              row.age_years != null ? `${row.age_years}Y` : null,
              row.sex?.trim() || null,
              row.docpad_id?.trim() ? row.docpad_id.trim() : null,
            ].filter(Boolean);
            const busy = openingPatientId === pid;

            return (
              <li key={pid}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openPatientChart(pid)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-slate-50/80 disabled:cursor-wait disabled:opacity-70"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <PatientAvatar patientId={pid} patientName={name} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-slate-900">{name}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{metaBits.join(" · ") || "—"}</p>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 sm:px-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last visit</p>
                      <p className="mt-0.5 text-sm font-medium text-slate-800">{formatDisplayDate(row.last_encounter_date)}</p>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                        <span className="font-medium text-slate-600">Chief: </span>
                        {row.last_chief_complaint?.trim() || "—"}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-700">
                        <span className="font-medium text-slate-600">Dx: </span>
                        {row.last_diagnosis?.trim() || "—"}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200/80">
                          {row.total_encounters != null ? row.total_encounters : "—"} visits
                        </span>
                        <StatusBadge status={row.last_encounter_status} />
                      </div>
                      {row.last_follow_up_date?.trim() ? (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                            isFollowUpOverdue(row)
                              ? "bg-red-50 text-red-800 ring-red-200/90"
                              : "bg-violet-50 text-violet-900 ring-violet-200/80"
                          }`}
                        >
                          F/U {formatDisplayDate(row.last_follow_up_date)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
