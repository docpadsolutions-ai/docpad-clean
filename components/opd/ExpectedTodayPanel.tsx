"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, RotateCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { checkInAppointment, fetchDoctorDaySchedule, type DayScheduleRow } from "@/lib/daySchedule";

/**
 * Patients who are booked for today but have not walked in yet.
 *
 * Follow-ups booked from inside an encounter land here, which is what makes the
 * doctor's day show who is due back. Checking one in allocates the OPD token
 * server-side and puts them in the waiting room — the same row reception would
 * have created, without the duplicate walk-in.
 */
export default function ExpectedTodayPanel({
  doctorPractitionerId,
  onCheckedIn,
}: {
  doctorPractitionerId?: string | null;
  onCheckedIn?: () => void;
}) {
  const [rows, setRows] = useState<DayScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // State is only touched after the fetch resolves, so mounting this panel does
  // not cascade a render.
  const load = useCallback(async () => {
    const { rows: r, error: e } = await fetchDoctorDaySchedule(doctorPractitionerId ?? null);
    setError(e ?? null);
    setRows(r.filter((row) => !row.arrived));
    setLoading(false);
  }, [doctorPractitionerId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { rows: r, error: e } = await fetchDoctorDaySchedule(doctorPractitionerId ?? null);
      if (cancelled) return;
      setError(e ?? null);
      setRows(r.filter((row) => !row.arrived));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [doctorPractitionerId]);

  // Someone else checking a patient in at the desk should clear them from here too.
  useEffect(() => {
    const channel = supabase
      .channel("expected-today")
      .on("postgres_changes", { event: "*", schema: "public", table: "reception_queue" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const onCheckIn = async (row: DayScheduleRow) => {
    if (!row.appointment_id) return;
    setBusyId(row.appointment_id);
    const { error: e } = await checkInAppointment(row.appointment_id);
    setBusyId(null);
    if (e) {
      setError(e);
      return;
    }
    await load();
    onCheckedIn?.();
  };

  if (!loading && rows.length === 0 && !error) return null;

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-indigo-200/70 bg-indigo-50/40">
      <div className="flex items-center justify-between gap-3 border-b border-indigo-200/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-indigo-700" aria-hidden />
          <h3 className="text-sm font-bold text-indigo-900">Expected today</h3>
          <span className="rounded-full bg-white px-2 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">
            {rows.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-white"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </button>
      </div>

      {error ? (
        <p className="px-5 py-3 text-xs font-medium text-red-700">{error}</p>
      ) : loading ? (
        <p className="px-5 py-3 text-xs text-indigo-800/70">Loading bookings…</p>
      ) : (
        <ul className="divide-y divide-indigo-100">
          {rows.map((row) => (
            <li key={row.appointment_id ?? row.patient_id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{row.patient_name}</p>
                <p className="text-xs text-slate-600">
                  {row.visit_type === "scheduled_follow_up" ? "Follow-up" : "New visit"}
                  {row.scheduled_time ? ` · ${row.scheduled_time.slice(0, 5)}` : " · no time set"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onCheckIn(row)}
                disabled={busyId === row.appointment_id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                {busyId === row.appointment_id ? "Checking in…" : "Check in"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
