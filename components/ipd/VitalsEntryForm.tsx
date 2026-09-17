"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { parseBloodPressureText } from "@/lib/ipdNursingVitalsRanges";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import { MewsScoreBadge } from "./MewsScoreBadge";
import { parseMewsComponents, type MewsSavedSnapshot } from "./mewsTypes";
import DrumPicker from "./DrumPicker";

type VitalsSectionId = "bp" | "pulseTemp" | "spo2Rr" | "urinePain" | "gcs";

function VitalsAccordionSection({
  sectionId,
  title,
  summary,
  openSection,
  onToggle,
  children,
}: {
  sectionId: VitalsSectionId;
  title: string;
  summary: string;
  openSection: VitalsSectionId | null;
  onToggle: (id: VitalsSectionId) => void;
  children: ReactNode;
}) {
  const open = openSection === sectionId;
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-gray-50"
        onClick={() => onToggle(sectionId)}
        aria-expanded={open}
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-500 transition-transform", open && "rotate-180")} aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-semibold text-gray-900">{title}</span>
        {!open ? (
          <span className="max-w-[55%] shrink-0 truncate text-right text-xs tabular-nums text-gray-600">{summary}</span>
        ) : null}
      </button>
      {open ? <div className="border-t border-gray-100 px-3 pb-3 pt-1">{children}</div> : null}
    </div>
  );
}

export type VitalsEntryFormProps = {
  /** When true, form fields reset (e.g. modal opened). */
  active: boolean;
  hospitalId: string;
  admissionId: string;
  patientId: string;
  recordedByPractitionerId: string;
  showGcsField: boolean;
  onSaved: (row: Record<string, unknown>) => void;
  onCancel: () => void;
  /** If set (e.g. modal), called after a successful save — toast runs first, then parent refresh via `onSaved`. */
  onCloseAfterSave?: () => void;
};

export default function VitalsEntryForm({
  active,
  hospitalId,
  admissionId,
  patientId,
  recordedByPractitionerId,
  showGcsField,
  onSaved,
  onCancel,
  onCloseAfterSave,
}: VitalsEntryFormProps) {
  const [systolic, setSystolic] = useState(120);
  const [diastolic, setDiastolic] = useState(80);
  const [pulse, setPulse] = useState(72);
  const [temp, setTemp] = useState(36.8);
  const [spo2, setSpo2] = useState(99);
  const [rr, setRr] = useState(16);
  const [urineMl, setUrineMl] = useState(0);
  const [pain, setPain] = useState(0);
  const [avpu, setAvpu] = useState<"A" | "V" | "P" | "U">("A");
  const [notes, setNotes] = useState("");
  const [gcs, setGcs] = useState(15);
  const [saving, setSaving] = useState(false);
  const [lastMews, setLastMews] = useState<MewsSavedSnapshot | null>(null);
  const [openSection, setOpenSection] = useState<VitalsSectionId | null>("bp");
  /** Bumps after each successful save so drum pickers remount for the next serial reading. */
  const [serialSeq, setSerialSeq] = useState(0);

  const wheelKey = `${active}-${admissionId}-${serialSeq}`;

  const toggleSection = (id: VitalsSectionId) => {
    setOpenSection((prev) => (prev === id ? null : id));
  };

  const resetFormForNextEntry = () => {
    setSystolic(120);
    setDiastolic(80);
    setPulse(72);
    setTemp(36.8);
    setSpo2(99);
    setRr(16);
    setUrineMl(0);
    setPain(0);
    setAvpu("A");
    setNotes("");
    setGcs(15);
    setOpenSection("bp");
  };

  useEffect(() => {
    if (!active) return;
    setSerialSeq(0);
    resetFormForNextEntry();
    setLastMews(null);
  }, [active, admissionId]);

  async function submit() {
    const recordedAt = new Date();

    const bpTrim = `${systolic}/${diastolic}`;
    const parsed = parseBloodPressureText(bpTrim);
    if (!parsed) {
      toast.error('Blood pressure must look like "120/80"');
      return;
    }

    const gcsN = showGcsField ? gcs : null;
    if (gcsN != null && (Number.isNaN(gcsN) || gcsN < 3 || gcsN > 15)) {
      toast.error("GCS must be between 3 and 15");
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      recorded_by: recordedByPractitionerId,
      recorded_at: recordedAt.toISOString(),
      blood_pressure: bpTrim,
      pulse,
      temperature: temp,
      spo2,
      respiratory_rate: rr,
      urine_output: urineMl,
      pain_score: pain,
      avpu,
      notes: notes.trim() || null,
      gcs_score: gcsN,
    };

    const { data, error } = await supabase.from("ipd_nursing_vitals").insert(payload).select("*").single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    const row = data as Record<string, unknown>;

    toast.success(`Vitals recorded · ${recordedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`);
    onSaved(row);

    if (onCloseAfterSave) {
      onCloseAfterSave();
      return;
    }

    setSerialSeq((n) => n + 1);
    resetFormForNextEntry();

    const ms = row.mews_score;
    const score = typeof ms === "number" ? ms : ms != null ? Number(ms) : NaN;
    const alertLevel = row.mews_alert_level != null ? String(row.mews_alert_level) : "";
    const components = parseMewsComponents(row.mews_components);
    if (Number.isFinite(score)) {
      setLastMews({ score, alertLevel, components });
    } else {
      setLastMews(null);
    }
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="rounded-lg border border-gray-100 bg-gray-50/90 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Timestamp</p>
        <p className="mt-1 text-sm leading-snug text-gray-700">
          Each reading is stored with the exact time you tap <span className="font-semibold text-gray-900">Record vitals</span>. Save
          multiple readings in a row for serial monitoring — every entry gets its own timestamp.
        </p>
      </div>

      <div className="space-y-2">
        <VitalsAccordionSection
          sectionId="bp"
          title="Blood pressure"
          summary={`${systolic}/${diastolic} mmHg`}
          openSection={openSection}
          onToggle={toggleSection}
        >
          <p className="mb-2 text-[10px] text-gray-400">normal: ~90–120 / 60–80 mmHg</p>
          <div className="flex flex-wrap items-end justify-center gap-2 sm:flex-nowrap">
            <DrumPicker
              key={`${wheelKey}-sys`}
              className="min-w-0 flex-1"
              label="Systolic"
              unit="mmHg"
              min={60}
              max={200}
              step={1}
              value={systolic}
              onChange={setSystolic}
              normalHint="90–120"
            />
            <span className="select-none pb-10 text-xl font-light text-gray-300" aria-hidden>
              /
            </span>
            <DrumPicker
              key={`${wheelKey}-dia`}
              className="min-w-0 flex-1"
              label="Diastolic"
              unit="mmHg"
              min={40}
              max={130}
              step={1}
              value={diastolic}
              onChange={setDiastolic}
              normalHint="60–80"
            />
          </div>
        </VitalsAccordionSection>

        <VitalsAccordionSection
          sectionId="pulseTemp"
          title="Pulse & temperature"
          summary={`${pulse} bpm · ${temp.toFixed(1)} °C`}
          openSection={openSection}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <DrumPicker
              key={`${wheelKey}-pulse`}
              label="Pulse"
              unit="bpm"
              min={40}
              max={180}
              step={1}
              value={pulse}
              onChange={setPulse}
              normalHint="60–100"
            />
            <DrumPicker
              key={`${wheelKey}-temp`}
              label="Temp"
              unit="°C"
              min={35}
              max={41}
              step={0.1}
              decimals={1}
              value={temp}
              onChange={setTemp}
              normalHint="36.1–37.2"
            />
          </div>
        </VitalsAccordionSection>

        <VitalsAccordionSection
          sectionId="spo2Rr"
          title="SpO₂ & respiratory rate"
          summary={`${spo2}% · ${rr} /min`}
          openSection={openSection}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <DrumPicker
              key={`${wheelKey}-spo2`}
              label="SpO₂"
              unit="%"
              min={70}
              max={100}
              step={1}
              value={spo2}
              onChange={setSpo2}
              normalHint="95–100"
            />
            <DrumPicker
              key={`${wheelKey}-rr`}
              label="RR"
              unit="/min"
              min={8}
              max={40}
              step={1}
              value={rr}
              onChange={setRr}
              normalHint="12–20"
            />
          </div>
        </VitalsAccordionSection>

        <VitalsAccordionSection
          sectionId="urinePain"
          title="Urine output & pain"
          summary={`${urineMl} ml · pain ${pain}/10`}
          openSection={openSection}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <DrumPicker
              key={`${wheelKey}-urine`}
              label="Urine output"
              unit="ml"
              min={0}
              max={500}
              step={10}
              value={urineMl}
              onChange={setUrineMl}
            />
            <DrumPicker
              key={`${wheelKey}-pain`}
              label="Pain score"
              unit="0–10"
              min={0}
              max={10}
              step={1}
              value={pain}
              onChange={setPain}
              normalHint="0 = none"
            />
          </div>
        </VitalsAccordionSection>

        {showGcsField ? (
          <VitalsAccordionSection
            sectionId="gcs"
            title="GCS"
            summary={`${gcs} / 15`}
            openSection={openSection}
            onToggle={toggleSection}
          >
            <DrumPicker
              key={`${wheelKey}-gcs`}
              label="GCS"
              unit="3–15"
              min={3}
              max={15}
              step={1}
              value={gcs}
              onChange={setGcs}
              normalHint="15 = normal"
            />
          </VitalsAccordionSection>
        ) : null}
      </div>

      <div>
        <Label className="text-[10px] uppercase text-gray-500">AVPU</Label>
        <select
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          value={avpu}
          onChange={(e) => setAvpu(e.target.value as "A" | "V" | "P" | "U")}
        >
          <option value="A">A — Alert</option>
          <option value="V">V — Responds to voice</option>
          <option value="P">P — Responds to pain</option>
          <option value="U">U — Unresponsive</option>
        </select>
      </div>

      <div>
        <Label className="text-[10px] uppercase text-gray-500">Notes</Label>
        <Textarea className="mt-1 min-h-[72px] text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        <Button type="button" disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving…" : "Record vitals"}
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {lastMews ? (
        <div className="border-t border-gray-100 pt-3">
          <MewsScoreBadge
            score={lastMews.score}
            alertLevel={lastMews.alertLevel}
            components={lastMews.components}
            expandable
          />
        </div>
      ) : null}
    </div>
  );
}
