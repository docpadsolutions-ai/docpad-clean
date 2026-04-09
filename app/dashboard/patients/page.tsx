"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ClinicalQueueRow from "../../components/ClinicalQueueRow";
import { createEncounterFromAppointment } from "../../lib/opdEncounterFromAppointment";
import type { PatientQueueVitals } from "../../lib/patientQueueData";
import { vitalsFromJson } from "../../lib/patientQueueData";
import { fetchAuthOrgId } from "../../lib/authOrg";
import { supabase } from "../../supabase";

type NestedPatient = {
  full_name?: string | null;
  age_years?: number | null;
  sex?: string | null;
};

type WaitingRow = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientMeta: string;
  vitals: PatientQueueVitals;
  timeLabel: string;
  chiefComplaint?: string;
};

const WAITING_BADGE = "bg-amber-50 text-amber-700 ring-amber-200";

function pickNestedPatient(patients: unknown): NestedPatient | null {
  if (patients == null) return null;
  if (Array.isArray(patients)) {
    const first = patients[0];
    return first && typeof first === "object" ? (first as NestedPatient) : null;
  }
  if (typeof patients === "object") return patients as NestedPatient;
  return null;
}

function ageGenderLine(p: NestedPatient | null): string {
  if (!p) return "—";
  const age = p.age_years;
  const sex = p.sex?.trim();
  if (age != null && sex) return `${age}Y, ${sex}`;
  if (age != null) return `${age}Y`;
  if (sex) return sex;
  return "—";
}

function parseTimeShort(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function PatientsPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rows, setRows] = useState<WaitingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [startingAppointmentId, setStartingAppointmentId] = useState<string | null>(null);
  const startLock = useRef(false);

  const loadWaitingRoom = useCallback(async (oid: string | null) => {
    setLoading(true);
    setFetchError(null);

    const id = oid?.trim() || null;
    if (!id) {
      setRows([]);
      setFetchError("Your account is not linked to an organization.");
      setLoading(false);
      return;
    }

    const q = supabase
      .from("appointments")
      .select("*, patients(full_name, age_years, sex)")
      .in("status", ["waiting", "registered"])
      .eq("hospital_id", id)
      .order("created_at", { ascending: true });

    const { data, error } = await q;

    if (error) {
      setFetchError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const list = (data ?? []) as Record<string, unknown>[];
    const apptIds = list.map((a) => a.id).filter((id) => id != null).map(String);

    const linked = new Set<string>();
    if (apptIds.length > 0) {
      const { data: encs, error: encErr } = await supabase
        .from("opd_encounters")
        .select("appointment_id")
        .eq("hospital_id", id)
        .in("appointment_id", apptIds);
      if (encErr) {
        setFetchError(encErr.message);
        setRows([]);
        setLoading(false);
        return;
      }
      for (const row of encs ?? []) {
        const aid = (row as { appointment_id?: string }).appointment_id;
        if (aid) linked.add(String(aid));
      }
    }

    const mapped: WaitingRow[] = [];
    for (const appointment of list) {
      const appointmentId = appointment.id != null ? String(appointment.id) : "";
      const patientId = appointment.patient_id != null ? String(appointment.patient_id) : "";
      if (!appointmentId || !patientId) continue;
      if (linked.has(appointmentId)) continue;

      const p = pickNestedPatient(appointment.patients);
      const patientName =
        p?.full_name != null && String(p.full_name).trim() !== ""
          ? String(p.full_name).trim()
          : "Unknown Patient";

      const timeRaw = appointment.start_time as string | undefined;
      const createdRaw = appointment.created_at as string | undefined;
      const timeLabel =
        parseTimeShort(timeRaw) !== "—" ? parseTimeShort(timeRaw) : parseTimeShort(createdRaw);

      const ccRaw = appointment.chief_complaint;
      const chiefComplaint =
        ccRaw != null && String(ccRaw).trim() !== "" ? String(ccRaw).trim() : undefined;

      mapped.push({
        appointmentId,
        patientId,
        patientName,
        patientMeta: ageGenderLine(p),
        vitals: vitalsFromJson(appointment.vitals),
        timeLabel,
        chiefComplaint,
      });
    }

    setRows(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { orgId: oid, error } = await fetchAuthOrgId();
      if (cancelled) return;
      setOrgId(oid);
      if (error) {
        setFetchError(error.message);
        setRows([]);
        setLoading(false);
        return;
      }
      await loadWaitingRoom(oid);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWaitingRoom]);

  const onRowClick = useCallback(
    async (row: WaitingRow) => {
      if (startLock.current) return;
      startLock.current = true;
      setStartingAppointmentId(row.appointmentId);
      setFetchError(null);
      try {
        const newId = await createEncounterFromAppointment(row.patientId, row.appointmentId, orgId);
        if (newId) {
          await loadWaitingRoom(orgId);
          router.push(`/dashboard/opd/encounter/${newId}`);
        } else {
          setFetchError("Could not start encounter. Try again.");
        }
      } finally {
        startLock.current = false;
        setStartingAppointmentId(null);
      }
    },
    [orgId, loadWaitingRoom, router],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Patients</h1>
          <p className="mt-1 text-sm text-gray-600">
            Waiting room — start a chart from triage or open the full OPD queue.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard/opd"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            OPD queue
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Dashboard
          </Link>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">Waiting room</h2>
          <p className="text-xs text-slate-500">Joined on patients(full_name, age_years, sex)</p>
        </div>

        {fetchError ? (
          <div className="px-6 py-8 text-center text-sm text-red-700">{fetchError}</div>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-600">No waiting appointments.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-5 py-3 lg:px-6">Time</th>
                  <th className="min-w-[160px] px-3 py-3">Patient</th>
                  <th className="min-w-[200px] px-3 py-3">Vitals</th>
                  <th className="min-w-[200px] px-3 py-3">Chief complaint</th>
                  <th className="whitespace-nowrap px-3 py-3">Status</th>
                  <th className="whitespace-nowrap px-5 py-3 text-right lg:px-6"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <ClinicalQueueRow
                    key={row.appointmentId}
                    primaryColumn={row.timeLabel}
                    patientName={row.patientName}
                    patientMeta={row.patientMeta}
                    vitals={row.vitals}
                    chiefComplaint={row.chiefComplaint}
                    statusLabel="Waiting"
                    statusBadgeClassName={WAITING_BADGE}
                    actionLabel="Start chart"
                    onClick={() => void onRowClick(row)}
                    disabled={startingAppointmentId === row.appointmentId}
                    secondaryLink={{ href: `/dashboard/patients/${row.patientId}/insurance`, label: "Insurance card" }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
