"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  bookAppointment,
  todayYmd,
  VISIT_TYPES,
  VISIT_TYPE_LABEL,
  type VisitType,
} from "@/lib/appointments";

type PatientHit = {
  id: string;
  name: string;
  docpadId: string | null;
  phone: string | null;
};

/**
 * The front desk taking a booking over the phone.
 *
 * The patient must already be registered. Booking an unregistered caller would
 * mean creating a patient record from a name given down a telephone line, which
 * is how duplicate records get made; the desk registers them properly first.
 */
export default function BookAppointmentModal({
  open,
  onClose,
  hospitalId,
  practitioners,
  presetPatient,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  hospitalId: string | null;
  practitioners: { id: string; full_name: string | null }[];
  presetPatient?: { id: string; name: string } | null;
  onBooked?: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [patient, setPatient] = useState<PatientHit | null>(() =>
    presetPatient ? { id: presetPatient.id, name: presetPatient.name, docpadId: null, phone: null } : null,
  );

  const [dateYmd, setDateYmd] = useState("");
  const [time, setTime] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [visitType, setVisitType] = useState<VisitType>("new");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => todayYmd(), []);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => {
    setQuery("");
    setHits([]);
    setSearching(false);
    setPatient(presetPatient ? { id: presetPatient.id, name: presetPatient.name, docpadId: null, phone: null } : null);
    setDateYmd("");
    setTime("");
    setDoctorId("");
    setVisitType("new");
    setNotes("");
    setSaving(false);
    setError(null);
  }, [presetPatient]);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Debounced lookup. State is only touched after the query resolves, so typing
  // does not cascade a render per keystroke.
  useEffect(() => {
    if (!open || !hospitalId || patient) return;
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        const esc = q.replace(/[%_]/g, "\\$&");
        const pat = `%${esc}%`;
        const { data, error: e } = await supabase
          .from("patients")
          .select("id, full_name, first_name, last_name, docpad_id, phone")
          .eq("hospital_id", hospitalId)
          .or(`full_name.ilike.${pat},phone.ilike.${pat},docpad_id.ilike.${pat}`)
          .limit(12);
        if (cancelled) return;
        setSearching(false);
        if (e) {
          setError(e.message);
          setHits([]);
          return;
        }
        setHits(
          (data ?? []).map((r) => {
            const row = r as Record<string, unknown>;
            const full = String(row.full_name ?? "").trim();
            const composed = [row.first_name, row.last_name]
              .map((v) => String(v ?? "").trim())
              .filter(Boolean)
              .join(" ");
            return {
              id: String(row.id),
              name: full || composed || "Unnamed patient",
              docpadId: row.docpad_id ? String(row.docpad_id) : null,
              phone: row.phone ? String(row.phone) : null,
            };
          }),
        );
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, hospitalId, query, patient]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const showHits = query.trim().length >= 2 && !patient;

  const canSave = Boolean(patient && dateYmd) && !saving;

  const onSubmit = async () => {
    if (!patient || !dateYmd) return;
    setSaving(true);
    setError(null);
    const { result, error: e } = await bookAppointment({
      patientId: patient.id,
      dateYmd,
      time: time || null,
      doctorId: doctorId || null,
      visitType,
      notes: notes || null,
    });
    setSaving(false);
    if (e || !result) {
      setError(e ?? "The booking did not save.");
      return;
    }
    onBooked?.(
      result.created
        ? `${patient.name} booked for ${dateYmd}${time ? ` at ${time}` : ""}.`
        : `${patient.name} already had a booking that day, so it was updated rather than duplicated.`,
    );
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Book an appointment"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="mt-10 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 text-indigo-600" aria-hidden />
            <h2 className="text-sm font-bold text-slate-900">Book an appointment</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="appt-patient">
              Patient
            </label>
            {patient ? (
              <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{patient.name}</p>
                  <p className="text-xs text-slate-600">
                    {[patient.docpadId, patient.phone].filter(Boolean).join(" · ") || "Registered patient"}
                  </p>
                </div>
                {presetPatient ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      setPatient(null);
                      setQuery("");
                    }}
                    className="shrink-0 text-xs font-semibold text-indigo-700 hover:underline"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
                  <input
                    id="appt-patient"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Name, phone, or DocPad ID"
                    autoComplete="off"
                    className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                  {searching ? (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" aria-hidden />
                  ) : null}
                </div>
                {showHits && hits.length > 0 ? (
                  <ul className="mt-2 max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                    {hits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => setPatient(h)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-slate-50"
                        >
                          <span className="truncate text-sm font-medium text-slate-900">{h.name}</span>
                          <span className="shrink-0 text-xs text-slate-500">{h.docpadId ?? h.phone ?? ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : showHits && !searching ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No registered patient matches that. Register them first, then book.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="appt-date">
                Date
              </label>
              <input
                id="appt-date"
                type="date"
                value={dateYmd}
                min={today}
                onChange={(e) => setDateYmd(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="appt-time">
                Time <span className="font-normal text-slate-400">optional</span>
              </label>
              <input
                id="appt-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="appt-doctor">
                Doctor <span className="font-normal text-slate-400">optional</span>
              </label>
              <select
                id="appt-doctor"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">Any doctor</option>
                {practitioners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? "Unnamed"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="appt-type">
                Visit type
              </label>
              <select
                id="appt-type"
                value={visitType}
                onChange={(e) => setVisitType(e.target.value as VisitType)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {VISIT_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {VISIT_TYPE_LABEL[v]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="appt-notes">
              Reason for visit <span className="font-normal text-slate-400">optional</span>
            </label>
            <input
              id="appt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Right knee pain, review of X-rays…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          ) : null}

          <p className="text-xs text-slate-500">
            A WhatsApp reminder goes out the evening before and again on the morning, provided the patient has a
            phone number on file.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {saving ? "Booking…" : "Book"}
          </button>
        </div>
      </div>
    </div>
  );
}
