"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, RotateCw, Trash2 } from "lucide-react";
import {
  cancelAppointment,
  fetchUpcomingAppointments,
  formatApptDate,
  formatApptTime,
  rescheduleAppointment,
  todayYmd,
  VISIT_TYPE_LABEL,
  type UpcomingAppointment,
} from "@/lib/appointments";
import { checkInAppointment } from "@/lib/daySchedule";

/**
 * The desk's forward view of who is booked.
 *
 * Three verbs, all of which the desk needs and none of which existed before:
 * check a booked patient in (which allocates the OPD token server-side, so the
 * booking becomes the visit rather than spawning a duplicate walk-in), move the
 * booking, or cancel it. Cancelling keeps the row: a visit that was arranged and
 * did not happen is a fact worth holding on to.
 */
export default function BookingsSection({
  refreshToken,
  onCheckedIn,
}: {
  refreshToken?: number;
  onCheckedIn?: (message: string) => void;
}) {
  const [rows, setRows] = useState<UpcomingAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  const today = useMemo(() => todayYmd(), []);

  const load = useCallback(
    async (windowDays: number) => {
      const { rows: r, error: e } = await fetchUpcomingAppointments({ days: windowDays });
      setError(e);
      setRows(r);
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { rows: r, error: e } = await fetchUpcomingAppointments({ days });
      if (cancelled) return;
      setError(e);
      setRows(r);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [days, refreshToken]);

  const grouped = useMemo(() => {
    const map = new Map<string, UpcomingAppointment[]>();
    for (const r of rows) {
      const k = r.appointment_date;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()];
  }, [rows]);

  const onCheckIn = async (row: UpcomingAppointment) => {
    setBusyId(row.appointment_id);
    const { error: e } = await checkInAppointment(row.appointment_id);
    setBusyId(null);
    if (e) {
      setError(e);
      return;
    }
    onCheckedIn?.(`${row.patient_name ?? "Patient"} checked in.`);
    await load(days);
  };

  const onReschedule = async (row: UpcomingAppointment) => {
    const next = window.prompt(
      `Move ${row.patient_name ?? "this booking"} to which date? (YYYY-MM-DD)`,
      row.appointment_date,
    );
    if (!next) return;
    setBusyId(row.appointment_id);
    const { ok, error: e } = await rescheduleAppointment({
      appointmentId: row.appointment_id,
      dateYmd: next.trim(),
      time: row.scheduled_time,
    });
    setBusyId(null);
    if (!ok) {
      setError(e);
      return;
    }
    await load(days);
  };

  const onCancel = async (row: UpcomingAppointment) => {
    const reason = window.prompt(
      `Cancel ${row.patient_name ?? "this booking"} on ${row.appointment_date}? Give a reason (optional).`,
      "",
    );
    if (reason === null) return;
    setBusyId(row.appointment_id);
    const { ok, error: e } = await cancelAppointment({
      appointmentId: row.appointment_id,
      reason,
    });
    setBusyId(null);
    if (!ok) {
      setError(e);
      return;
    }
    await load(days);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-indigo-600" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Bookings</h2>
            <p className="text-xs text-gray-500">
              Patients booked ahead, including follow-ups the doctor set from an encounter.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="How far ahead to show"
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
          >
            <option value={7}>Next 7 days</option>
            <option value={14}>Next 14 days</option>
            <option value={30}>Next 30 days</option>
            <option value={90}>Next 90 days</option>
          </select>
          <button
            type="button"
            onClick={() => void load(days)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="px-4 py-3 text-xs font-medium text-red-700">{error}</p>
      ) : loading ? (
        <p className="px-4 py-10 text-center text-sm text-gray-500">Loading bookings…</p>
      ) : rows.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-gray-500">Nobody is booked in this window.</p>
          <p className="mt-1 text-xs text-gray-400">
            Use &ldquo;Book appointment&rdquo; above to take a booking over the phone.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {grouped.map(([date, items]) => (
            <div key={date}>
              <div className="flex items-center justify-between bg-gray-50/80 px-4 py-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-600">
                  {formatApptDate(date)}
                  {date === today ? " · today" : ""}
                </span>
                <span className="text-xs font-semibold text-gray-400">{items.length}</span>
              </div>
              <ul className="divide-y divide-gray-50">
                {items.map((row) => (
                  <li key={row.appointment_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {row.patient_name ?? "Unnamed patient"}
                      </p>
                      <p className="truncate text-xs text-gray-600">
                        {formatApptTime(row.scheduled_time)}
                        {" · "}
                        {row.visit_type ? VISIT_TYPE_LABEL[row.visit_type] : "New visit"}
                        {row.doctor_name ? ` · ${row.doctor_name}` : ""}
                        {row.booking_source === "follow_up_auto" ? " · set by doctor" : ""}
                      </p>
                      {row.chief_complaint ? (
                        <p className="truncate text-xs text-gray-400">{row.chief_complaint}</p>
                      ) : null}
                    </div>

                    {row.already_checked_in ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        Arrived
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {date === today ? (
                          <button
                            type="button"
                            onClick={() => void onCheckIn(row)}
                            disabled={busyId === row.appointment_id}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden />
                            Check in
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void onReschedule(row)}
                          disabled={busyId === row.appointment_id}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
                        >
                          Move
                        </button>
                        <button
                          type="button"
                          onClick={() => void onCancel(row)}
                          disabled={busyId === row.appointment_id}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:opacity-60"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
