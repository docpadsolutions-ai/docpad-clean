"use client";

import { use, useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { supabase } from "../../supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Prescription = {
  id: string;
  medicine_name: string;
  active_ingredient_name: string | null;
  dosage_form_name: string | null;
  dosage_text: string;
  frequency: string;
  duration: string;
  instructions: string | null;
};

type Encounter = {
  id: string;
  encounter_number: string | null;
  encounter_date: string | null;
  chief_complaint: string | null;
  weight: number | null;
  blood_pressure: string | null;
  pulse: number | null;
  temperature: number | null;
  spo2: number | null;
  patient_id: string | null;
};

type Patient = {
  id: string;
  full_name: string | null;
  age_years: number | null;
  sex: string | null;
  blood_group: string | null;
  docpad_id: string | null;
  phone: string | null;
};

type LabPrintBlock = {
  id: string;
  title: string;
  lines: string[];
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function PrintIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}

function PillIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="6" />
      <line x1="12" y1="6" x2="12" y2="18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DropletIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: encounterId } = use(params);
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  const [encounter,      setEncounter]      = useState<Encounter | null>(null);
  const [patient,        setPatient]        = useState<Patient | null>(null);
  const [prescriptions,  setPrescriptions]  = useState<Prescription[]>([]);
  const [labPrintBlocks, setLabPrintBlocks] = useState<LabPrintBlock[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);

  useEffect(() => {
    if (!encounterId) return;

    async function load() {
      setLoading(true);
      setError(null);

      // 1. Fetch encounter
      const { data: enc, error: encErr } = await supabase
        .from("opd_encounters")
        .select("id, encounter_number, encounter_date, chief_complaint, weight, blood_pressure, pulse, temperature, spo2, patient_id")
        .eq("id", encounterId)
        .maybeSingle();

      if (encErr || !enc) {
        setError("Prescription not found. The link may be invalid or expired.");
        setLoading(false);
        return;
      }
      setEncounter(enc as Encounter);

      // 2. Fetch patient
      if (enc.patient_id) {
        const { data: pat } = await supabase
          .from("patients")
          .select("id, full_name, age_years, sex, blood_group, docpad_id, phone")
          .eq("id", enc.patient_id)
          .maybeSingle();
        if (pat) setPatient(pat as Patient);
      }

      // 3. Fetch prescriptions
      const { data: rxRows, error: rxErr } = await supabase
        .from("prescriptions")
        .select("id, medicine_name, active_ingredient_name, dosage_form_name, dosage_text, frequency, duration, instructions")
        .eq("encounter_id", encounterId)
        .order("id", { ascending: true });

      if (rxErr) {
        setError("Could not load prescription details. Please try again.");
        setLoading(false);
        return;
      }
      setPrescriptions((rxRows ?? []) as Prescription[]);

      const { data: attachRows } = await supabase
        .from("prescription_attachments")
        .select("ocr_upload_id, display_name")
        .eq("encounter_id", encounterId)
        .eq("include_in_print", true);

      const blocks: LabPrintBlock[] = [];
      const attaches = (attachRows ?? []) as { ocr_upload_id: string; display_name: string | null }[];
      const ocrIds = [...new Set(attaches.map((a) => String(a.ocr_upload_id ?? "").trim()).filter(Boolean))];
      if (ocrIds.length > 0) {
        const { data: labRows } = await supabase
          .from("lab_result_entries")
          .select("ocr_upload_id, parameter_name, value_numeric, value_text, unit, ref_range_text")
          .in("ocr_upload_id", ocrIds);
        const byOcr: Record<string, typeof labRows> = {};
        for (const row of labRows ?? []) {
          const r = row as {
            ocr_upload_id: string;
            parameter_name: string | null;
            value_numeric: number | null;
            value_text: string | null;
            unit: string | null;
            ref_range_text: string | null;
          };
          const id = String(r.ocr_upload_id ?? "");
          if (!id) continue;
          if (!byOcr[id]) byOcr[id] = [];
          byOcr[id].push(row);
        }
        for (const a of attaches) {
          const oid = String(a.ocr_upload_id ?? "").trim();
          const rows = byOcr[oid] ?? [];
          if (rows.length === 0) continue;
          const title = (a.display_name ?? "").trim() || "Lab report";
          const lines = rows.map((raw) => {
            const e = raw as {
              parameter_name: string | null;
              value_numeric: number | null;
              value_text: string | null;
              unit: string | null;
              ref_range_text: string | null;
            };
            const name = (e.parameter_name ?? "").trim() || "—";
            const val =
              e.value_text?.trim() ||
              (e.value_numeric != null && Number.isFinite(e.value_numeric) ? String(e.value_numeric) : "");
            const u = (e.unit ?? "").trim();
            const ref = (e.ref_range_text ?? "").trim();
            const valuePart = [val, u].filter(Boolean).join(" ");
            return valuePart ? `${name}: ${valuePart}${ref ? ` (Ref: ${ref})` : ""}` : `${name}${ref ? ` (Ref: ${ref})` : ""}`;
          });
          blocks.push({ id: oid, title, lines });
        }
      }
      setLabPrintBlocks(blocks);

      setLoading(false);
    }

    load();
  }, [encounterId]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        <p className="text-sm text-gray-500">Loading your prescription…</p>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error || !encounter) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center">
        <div className="rounded-full bg-red-100 p-4">
          <svg className="h-8 w-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-800">Link Invalid or Expired</h1>
        <p className="max-w-xs text-sm text-gray-500">{error ?? "Something went wrong. Please contact your doctor."}</p>
      </div>
    );
  }

  // ── Vitals summary line ───────────────────────────────────────────────────
  const vitalParts = [
    encounter.weight       ? `Wt: ${encounter.weight} kg`      : null,
    encounter.blood_pressure ? `BP: ${encounter.blood_pressure}` : null,
    encounter.pulse        ? `PR: ${encounter.pulse} bpm`      : null,
    encounter.temperature  ? `T: ${encounter.temperature}°C`   : null,
    encounter.spo2         ? `SpO₂: ${encounter.spo2}%`        : null,
  ].filter(Boolean);

  const patientDisplayName = patient?.full_name?.trim() || "Patient";
  const patientMeta = [
    patient?.age_years != null ? `${patient.age_years} yrs` : null,
    patient?.sex ? patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1) : null,
  ].filter(Boolean).join(" • ");

  return (
    <div className="min-h-screen bg-gray-100 pb-32">

      {/* ── Printable area ─────────────────────────────────────────────────── */}
      <div
        ref={printRef}
        className="print:w-full print:max-w-none print:bg-white print:pb-0 print:shadow-none"
        style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
      >

        {/* Hospital header */}
        <div className="bg-blue-700 px-5 py-5 text-white print:bg-blue-700 print:text-white">
          <div className="mx-auto max-w-lg">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 font-bold text-lg">
                D
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-200 print:text-blue-200">
                  DocPad Digital Prescription
                </p>
                <p className="text-sm font-bold leading-tight">Rameshwar Dass Memorial Hospital</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-100">
              <span>Rx No: <span className="font-semibold text-white">{encounter.encounter_number ?? encounterId.slice(0, 8).toUpperCase()}</span></span>
              <span>Date: <span className="font-semibold text-white">{formatDate(encounter.encounter_date)}</span></span>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-lg space-y-4 px-4 pt-4 print:space-y-3 print:px-5 print:pt-3">

          {/* Patient card */}
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 print:rounded-none print:shadow-none print:ring-0">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Patient</p>
            </div>
            <div className="flex items-start gap-3 px-4 py-3">
              {/* Avatar */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                {patientDisplayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-gray-900">{patientDisplayName}</p>
                  {patient?.blood_group && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                      <DropletIcon /> {patient.blood_group}
                    </span>
                  )}
                </div>
                {patientMeta && (
                  <p className="mt-0.5 text-xs text-gray-500">{patientMeta}</p>
                )}
                {patient?.docpad_id && (
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    DocPad ID: <span className="font-medium text-gray-600">{patient.docpad_id}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Clinical summary — only if there is something to show */}
          {(encounter.chief_complaint || vitalParts.length > 0) && (
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 print:rounded-none print:shadow-none print:ring-0">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Clinical Summary</p>
              </div>
              <div className="space-y-2.5 px-4 py-3 text-sm">
                {encounter.chief_complaint && (
                  <div className="flex gap-2">
                    <span className="w-16 shrink-0 text-xs font-semibold text-gray-400">C/O</span>
                    <span className="text-gray-800">{encounter.chief_complaint}</span>
                  </div>
                )}
                {vitalParts.length > 0 && (
                  <div className="flex gap-2">
                    <span className="w-16 shrink-0 text-xs font-semibold text-gray-400">Vitals</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {vitalParts.map((v) => (
                        <span key={v} className="inline-flex items-center gap-1 text-xs text-gray-700">
                          <HeartIcon />
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Prescription */}
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 print:rounded-none print:shadow-none print:ring-0">
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-serif text-xl font-bold italic text-blue-700">Rx</span>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Prescription</p>
              </div>
            </div>

            {prescriptions.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm italic text-gray-400">
                No medicines recorded for this prescription.
              </p>
            ) : (
              <ul className="divide-y divide-gray-50 px-4">
                {prescriptions.map((rx, i) => (
                  <li key={rx.id} className="py-3.5">
                    <div className="flex items-start gap-3">
                      {/* Index bubble */}
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {/* Medicine name */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PillIcon />
                          <p className="font-semibold text-gray-900">{rx.medicine_name}</p>
                          {rx.dosage_form_name && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                              {rx.dosage_form_name}
                            </span>
                          )}
                        </div>
                        {/* Dosage row */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                          {rx.dosage_text && (
                            <span><span className="font-medium text-gray-400">Dose: </span>{rx.dosage_text}</span>
                          )}
                          {rx.frequency && (
                            <span><span className="font-medium text-gray-400">Freq: </span>{rx.frequency}</span>
                          )}
                          {rx.duration && (
                            <span><span className="font-medium text-gray-400">For: </span>{rx.duration}</span>
                          )}
                        </div>
                        {/* Active ingredient */}
                        {rx.active_ingredient_name && (
                          <p className="text-[11px] text-gray-400">
                            Active: <span className="font-medium">{rx.active_ingredient_name}</span>
                          </p>
                        )}
                        {/* Instructions */}
                        {rx.instructions && (
                          <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs italic text-amber-700">
                            💊 {rx.instructions}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {labPrintBlocks.length > 0 ? (
              <div className="border-t border-gray-100 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Attached lab summaries</p>
                <div className="mt-2 space-y-3">
                  {labPrintBlocks.map((block) => (
                    <div key={block.id}>
                      <p className="text-xs font-semibold text-gray-800">{block.title}</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-gray-700">
                        {block.lines.map((line, i) => (
                          <li key={`${block.id}-${i}`}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Footer note */}
            <div className="border-t border-dashed border-gray-100 px-4 py-3">
              <p className="text-[11px] leading-relaxed text-gray-400">
                This is a digitally generated prescription. Please carry this document (printed or on your phone) when purchasing medicines. Contact your doctor if you have any questions.
              </p>
            </div>
          </div>

          {/* DocPad branding footer — shows in print */}
          <div className="hidden print:block border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
            Generated by DocPad · docpad.in · {new Date().getFullYear()}
          </div>

        </div>
      </div>

      {/* ── Sticky Download button (hidden when printing) ──────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-10 px-4 pb-6 pt-3 print:hidden">
        <div className="mx-auto max-w-lg">
          {/* Soft gradient fade above the button */}
          <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-gray-100 to-transparent" />
          <button
            type="button"
            onClick={() => handlePrint()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-sm font-bold text-white shadow-lg shadow-blue-200 transition active:scale-[0.98] hover:bg-blue-700"
          >
            <PrintIcon />
            Download / Print PDF
          </button>
          <p className="mt-2 text-center text-[11px] text-gray-400">
            Opens your phone&apos;s print dialog — choose &quot;Save as PDF&quot;
          </p>
        </div>
      </div>

    </div>
  );
}
