"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Ear,
  Eye,
  Heart,
  Wind,
} from "lucide-react";
import VoiceDictationButton from "@/app/components/VoiceDictationButton";
import { readIndiaRefsetKeyFromEnv } from "@/app/lib/snomedUiConfig";
import { cn } from "@/lib/utils";
import OrthoAssessmentTools from "@/app/components/ipd/OrthoAssessmentTools";

const SNOMED_INDIA = readIndiaRefsetKeyFromEnv();

const examVoiceIconBtn =
  "inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 h-9 w-9";

/** Voice + Gemini + SNOMED on systemic free-text fields (same pipeline as OPD examination). */
export type VoiceExamBundle = {
  specialty: string;
  doctorId?: string;
  encounterId?: string;
  geminiScreenContextAppend?: string;
  interim: Record<string, string>;
  setInterim: (key: string, v: string) => void;
};

function systemicVoiceKey(systemId: string, field: string) {
  return `${systemId}:${field}`;
}

function ExamFreeTextWithVoice({
  systemId,
  field,
  value,
  onChange,
  voiceExam,
  className,
}: {
  systemId: string;
  field: string;
  value: string;
  onChange: (v: string) => void;
  voiceExam?: VoiceExamBundle;
  className?: string;
}) {
  const vk = systemicVoiceKey(systemId, field);
  const interim = voiceExam?.interim[vk] ?? "";
  const display = interim ? `${value}${value && interim ? "\n" : ""}${interim}` : value;
  if (!voiceExam) {
    return <textarea className={className} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="relative">
      <textarea
        className={cn(className, "pr-12")}
        value={display}
        readOnly={!!interim}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="absolute right-0 top-0">
        <VoiceDictationButton
          contextType="examination"
          specialty={voiceExam.specialty}
          doctorId={voiceExam.doctorId}
          encounterId={voiceExam.encounterId}
          indiaRefset={SNOMED_INDIA ?? undefined}
          geminiScreenContextAppend={voiceExam.geminiScreenContextAppend}
          onTranscriptUpdate={(text, isFinal) => {
            if (isFinal) {
              if (text.trim()) onChange(value + (value.trim() ? "\n" : "") + text.trim());
              voiceExam.setInterim(vk, "");
            } else {
              voiceExam.setInterim(vk, text);
            }
          }}
          className={examVoiceIconBtn}
        />
      </div>
    </div>
  );
}

export const SYSTEMS = [
  { id: "cvs", label: "Cardiovascular System (CVS)", snomed: "301139008", icon: "heart" as const },
  { id: "rs", label: "Respiratory System (RS)", snomed: "301140005", icon: "lungs" as const },
  { id: "gi", label: "Gastrointestinal System / Abdomen", snomed: "56874000", icon: "activity" as const },
  { id: "cns", label: "Central Nervous System (CNS)", snomed: "281587008", icon: "brain" as const },
  { id: "msk", label: "Musculoskeletal / Orthopedic (MSK)", snomed: "5880005", icon: "activity" as const },
  { id: "endo", label: "Endocrine System", snomed: "410007002", icon: "activity" as const },
  { id: "gu", label: "Genitourinary System", snomed: "129435009", icon: "activity" as const },
  { id: "ent", label: "Ear, Nose, Throat (ENT)", snomed: "386307006", icon: "ear" as const },
  { id: "ophth", label: "Ophthalmology", snomed: "36228007", icon: "eye" as const },
  { id: "derm", label: "Dermatology", snomed: "274528008", icon: "activity" as const },
  { id: "psych", label: "Psychiatry / Mental Status", snomed: "271305006", icon: "brain" as const },
] as const;

export type SystemId = (typeof SYSTEMS)[number]["id"];

const fieldRow =
  "border-0 border-b border-gray-200 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:ring-0 focus-visible:ring-0";

function RefHint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-gray-400">{children}</p>;
}

function Chip({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        selected
          ? "border-blue-500 bg-blue-50 font-medium text-blue-700"
          : "border-gray-200 text-gray-600 hover:border-blue-300",
      )}
    >
      {children}
    </button>
  );
}

function ChipSingle({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o} selected={value === o} onClick={() => onChange(value === o ? "" : o)}>
          {o}
        </Chip>
      ))}
    </div>
  );
}

function ChipMulti({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (o: string) => {
    const set = new Set(value);
    if (set.has(o)) set.delete(o);
    else set.add(o);
    onChange([...set]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o} selected={value.includes(o)} onClick={() => toggle(o)}>
          {o}
        </Chip>
      ))}
    </div>
  );
}

function SystemIcon({
  name,
  selected,
}: {
  name: (typeof SYSTEMS)[number]["icon"];
  selected: boolean;
}) {
  const cls = cn("h-5 w-5 shrink-0", selected ? "text-blue-500" : "text-gray-400");
  switch (name) {
    case "heart":
      return <Heart className={cls} aria-hidden />;
    case "lungs":
      return <Wind className={cls} aria-hidden />;
    case "brain":
      return <Brain className={cls} aria-hidden />;
    case "ear":
      return <Ear className={cls} aria-hidden />;
    case "eye":
      return <Eye className={cls} aria-hidden />;
    default:
      return <Activity className={cls} aria-hidden />;
  }
}

function SystemSelectCard({
  system,
  checked,
  onToggle,
}: {
  system: (typeof SYSTEMS)[number];
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "relative flex w-full cursor-pointer flex-col items-start rounded-xl border p-4 text-left transition-all",
        checked ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-white hover:border-blue-300",
      )}
    >
      <span
        className={cn(
          "absolute left-3 top-3 flex h-[18px] w-[18px] items-center justify-center rounded border-2",
          checked ? "border-blue-500 bg-blue-500" : "border-gray-300 bg-white",
        )}
        aria-hidden
      >
        {checked ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
      </span>
      <div className="mt-6 flex w-full flex-col gap-1 pl-0">
        <SystemIcon name={system.icon} selected={checked} />
        <span className="text-sm font-medium text-gray-700">{system.label}</span>
        <span className="mt-0.5 text-xs text-gray-400">SNOMED {system.snomed}</span>
      </div>
    </button>
  );
}

function CollapsibleCard({
  title,
  snomed,
  children,
  defaultOpen = true,
}: {
  title: string;
  snomed: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          {open ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />}
          <span className="text-base font-semibold text-gray-900">{title}</span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">SNOMED {snomed}</span>
        </div>
      </button>
      {open ? <div className="mt-4 space-y-4">{children}</div> : null}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-gray-500">{children}</p>;
}

/* ——— Per-system bodies (compact) ——— */

function CvsBlock({
  systemId,
  value,
  onChange,
  vitals,
}: {
  systemId: string;
  value: Record<string, Record<string, unknown>>;
  onChange: (sid: string, f: string, v: unknown) => void;
  vitals?: VitalsProp;
}) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);

  const bpSeeded = useRef(false);
  useEffect(() => {
    if (bpSeeded.current) return;
    if (vitals?.bpSys && vitals?.bpDia) {
      set("bpSys", vitals.bpSys);
      set("bpDia", vitals.bpDia);
      bpSeeded.current = true;
    }
  }, [vitals?.bpSys, vitals?.bpDia]);

  const hs = (d.heartSounds as string[]) ?? [];
  const murmur = hs.includes("Murmur present");

  return (
    <>
      <div>
        <Label>Pulse Rate</Label>
        <div className="flex items-end gap-2">
          <input
            type="number"
            className={cn(fieldRow, "w-24")}
            value={str(d.pulseRate)}
            onChange={(e) => set("pulseRate", e.target.value)}
          />
          <span className="pb-1 text-sm text-gray-500">bpm</span>
        </div>
        <RefHint>60–100 bpm (adults)</RefHint>
      </div>
      <div>
        <Label>Pulse Rhythm</Label>
        <ChipSingle
          value={str(d.pulseRhythm)}
          onChange={(v) => set("pulseRhythm", v)}
          options={["Regular", "Irregular", "Irregularly irregular"]}
        />
      </div>
      <div>
        <Label>Pulse Volume / Character</Label>
        <ChipSingle
          value={str(d.pulseVolume)}
          onChange={(v) => set("pulseVolume", v)}
          options={["Normal", "High volume", "Low volume", "Bounding", "Thready", "Collapsing"]}
        />
      </div>
      <div>
        <Label>Blood Pressure</Label>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="number"
            className={cn(fieldRow, "w-20")}
            value={str(d.bpSys)}
            onChange={(e) => set("bpSys", e.target.value)}
            placeholder="Sys"
          />
          <span className="pb-1 text-gray-400">/</span>
          <input
            type="number"
            className={cn(fieldRow, "w-20")}
            value={str(d.bpDia)}
            onChange={(e) => set("bpDia", e.target.value)}
            placeholder="Dia"
          />
          <span className="pb-1 text-sm text-gray-500">mmHg</span>
        </div>
        <RefHint>&lt;120/80 Normal; 120–139/80–89 Elevated; ≥140/90 Hypertension</RefHint>
      </div>
      <div>
        <Label>Jugular Venous Pressure (JVP)</Label>
        <ChipSingle
          value={str(d.jvp)}
          onChange={(v) => set("jvp", v)}
          options={["Normal", "Elevated", "Not assessable"]}
        />
        {str(d.jvp) === "Elevated" ? (
          <div className="mt-2">
            <Label>Height (cm)</Label>
            <input className={cn(fieldRow, "w-28")} value={str(d.jvpHeightCm)} onChange={(e) => set("jvpHeightCm", e.target.value)} />
          </div>
        ) : null}
      </div>
      <div>
        <Label>Apex Beat</Label>
        <input
          className={cn(fieldRow, "w-full")}
          placeholder="e.g., 5th intercostal space, mid-clavicular line, normal character"
          value={str(d.apexBeat)}
          onChange={(e) => set("apexBeat", e.target.value)}
        />
        <RefHint>Normal: 5th ICS, MCL</RefHint>
      </div>
      <div>
        <Label>Heart Sounds</Label>
        <ChipMulti
          value={hs}
          onChange={(next) => set("heartSounds", next)}
          options={["S1 normal", "S2 normal", "S3 present", "S4 present", "Murmur present"]}
        />
        {murmur ? (
          <div className="mt-3 space-y-2 rounded-lg border border-gray-100 bg-gray-50/80 p-3">
            <Label>Murmur — Grade</Label>
            <ChipSingle value={str(d.murmurGrade)} onChange={(v) => set("murmurGrade", v)} options={["1", "2", "3", "4", "5", "6"]} />
            <Label>Location</Label>
            <input className={cn(fieldRow, "w-full")} value={str(d.murmurLocation)} onChange={(e) => set("murmurLocation", e.target.value)} />
            <Label>Radiation</Label>
            <input className={cn(fieldRow, "w-full")} value={str(d.murmurRadiation)} onChange={(e) => set("murmurRadiation", e.target.value)} />
          </div>
        ) : null}
      </div>
      <div>
        <Label>Peripheral Pulses</Label>
        <ChipMulti
          value={(d.peripheralPulses as string[]) ?? []}
          onChange={(next) => set("peripheralPulses", next)}
          options={["All present", "Radial", "Ulnar", "Femoral", "Popliteal", "Dorsalis pedis", "Post tibial"]}
        />
      </div>
      <div>
        <Label>Edema</Label>
        <ChipSingle value={str(d.edema)} onChange={(v) => set("edema", v)} options={["Absent", "Present"]} />
        {str(d.edema) === "Present" ? (
          <div className="mt-2 space-y-2">
            <ChipSingle value={str(d.edemaGrade)} onChange={(v) => set("edemaGrade", v)} options={["1+", "2+", "3+", "4+"]} />
            <input
              className={cn(fieldRow, "w-full")}
              placeholder="Location"
              value={str(d.edemaLocation)}
              onChange={(e) => set("edemaLocation", e.target.value)}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function RsBlock({
  systemId,
  value,
  onChange,
  vitals,
}: {
  systemId: string;
  value: Record<string, Record<string, unknown>>;
  onChange: (sid: string, f: string, v: unknown) => void;
  vitals?: VitalsProp;
}) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);

  const spo2Seeded = useRef(false);
  useEffect(() => {
    if (spo2Seeded.current) return;
    if (vitals?.spo2) {
      set("spo2", vitals.spo2);
      spo2Seeded.current = true;
    }
  }, [vitals?.spo2]);

  return (
    <>
      <div>
        <Label>Chest expansion</Label>
        <ChipSingle
          value={str(d.chestExpansion)}
          onChange={(v) => set("chestExpansion", v)}
          options={["Normal", "Reduced bilateral", "Reduced right", "Reduced left"]}
        />
        <input
          className={cn(fieldRow, "mt-2 w-28")}
          placeholder="cm"
          value={str(d.chestExpansionCm)}
          onChange={(e) => set("chestExpansionCm", e.target.value)}
        />
      </div>
      <div>
        <Label>Trachea</Label>
        <ChipSingle value={str(d.trachea)} onChange={(v) => set("trachea", v)} options={["Central", "Deviated right", "Deviated left"]} />
      </div>
      <div>
        <Label>Percussion</Label>
        <ChipSingle
          value={str(d.percussion)}
          onChange={(v) => set("percussion", v)}
          options={["Resonant", "Dull", "Stony dull", "Hyper-resonant"]}
        />
        <input className={cn(fieldRow, "mt-2 w-full")} placeholder="Location" value={str(d.percussionLoc)} onChange={(e) => set("percussionLoc", e.target.value)} />
      </div>
      <div>
        <Label>Breath sounds</Label>
        <ChipSingle
          value={str(d.breathSounds)}
          onChange={(v) => set("breathSounds", v)}
          options={["Vesicular", "Bronchial", "Diminished", "Absent"]}
        />
        <input className={cn(fieldRow, "mt-2 w-full")} placeholder="Location" value={str(d.breathSoundsLoc)} onChange={(e) => set("breathSoundsLoc", e.target.value)} />
      </div>
      <div>
        <Label>Added sounds</Label>
        <ChipMulti
          value={(d.addedSounds as string[]) ?? []}
          onChange={(next) => set("addedSounds", next)}
          options={["None", "Crackles", "Wheeze", "Pleural rub"]}
        />
        <input className={cn(fieldRow, "mt-2 w-full")} placeholder="Location" value={str(d.addedSoundsLoc)} onChange={(e) => set("addedSoundsLoc", e.target.value)} />
      </div>
      <div>
        <Label>SpO₂</Label>
        <input type="number" className={cn(fieldRow, "w-28")} value={str(d.spo2)} onChange={(e) => set("spo2", e.target.value)} />
      </div>
    </>
  );
}

function GiBlock({
  systemId,
  value,
  onChange,
  voiceExam,
}: {
  systemId: string;
  value: Record<string, Record<string, unknown>>;
  onChange: (s: string, f: string, v: unknown) => void;
  voiceExam?: VoiceExamBundle;
}) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);
  const tender = str(d.tenderness) === "Present";
  const liverPalp = str(d.liver) === "Palpable";

  return (
    <>
      <div>
        <Label>Inspection</Label>
        <ChipMulti
          value={(d.inspection as string[]) ?? []}
          onChange={(next) => set("inspection", next)}
          options={["Flat", "Scaphoid", "Distended", "Obese", "Visible peristalsis", "Visible pulsation"]}
        />
      </div>
      <div>
        <Label>Tenderness</Label>
        <ChipSingle value={str(d.tenderness)} onChange={(v) => set("tenderness", v)} options={["Absent", "Present"]} />
        {tender ? (
          <>
            <input className={cn(fieldRow, "mt-2 w-full")} placeholder="Location" value={str(d.tendernessLoc)} onChange={(e) => set("tendernessLoc", e.target.value)} />
            <div className="mt-2">
              <Label>Guarding</Label>
              <ChipSingle value={str(d.guarding)} onChange={(v) => set("guarding", v)} options={["No guarding", "Guarding", "Rigidity"]} />
            </div>
          </>
        ) : null}
      </div>
      <div>
        <Label>Rebound tenderness</Label>
        <ChipSingle value={str(d.rebound)} onChange={(v) => set("rebound", v)} options={["Absent", "Present"]} />
      </div>
      <div>
        <Label>Bowel sounds</Label>
        <ChipSingle value={str(d.bowel)} onChange={(v) => set("bowel", v)} options={["Normal", "Increased", "Decreased", "Absent"]} />
      </div>
      <div>
        <Label>Liver</Label>
        <ChipSingle value={str(d.liver)} onChange={(v) => set("liver", v)} options={["Not palpable", "Palpable"]} />
        {liverPalp ? (
          <input className={cn(fieldRow, "mt-2 w-32")} placeholder="cm below costal margin" value={str(d.liverCm)} onChange={(e) => set("liverCm", e.target.value)} />
        ) : null}
      </div>
      <div>
        <Label>Spleen</Label>
        <ChipSingle value={str(d.spleen)} onChange={(v) => set("spleen", v)} options={["Not palpable", "Palpable"]} />
      </div>
      <div>
        <Label>Ascites</Label>
        <ChipSingle value={str(d.ascites)} onChange={(v) => set("ascites", v)} options={["Absent", "Present"]} />
        <RefHint>shifting dullness / fluid thrill</RefHint>
      </div>
      <div>
        <Label>Free text findings</Label>
        <ExamFreeTextWithVoice
          systemId={systemId}
          field="giFreeText"
          value={str(d.giFreeText)}
          onChange={(v) => set("giFreeText", v)}
          voiceExam={voiceExam}
          className={cn(fieldRow, "min-h-[80px] w-full resize-none")}
        />
      </div>
    </>
  );
}

function LimbMotor({
  label,
  field,
  d,
  set,
}: {
  label: string;
  field: string;
  d: Record<string, unknown>;
  set: (f: string, v: unknown) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <ChipSingle value={str(d[field])} onChange={(v) => set(field, v)} options={["0", "1", "2", "3", "4", "5"]} />
    </div>
  );
}

function CnsBlock({ systemId, value, onChange }: { systemId: string; value: Record<string, Record<string, unknown>>; onChange: (s: string, f: string, v: unknown) => void }) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);
  const e = Number(d.gcsE) || 0;
  const vv = Number(d.gcsV) || 0;
  const m = Number(d.gcsM) || 0;
  const total = e && vv && m ? e + vv + m : null;
  return (
    <>
      <div>
        <Label>GCS</Label>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="text-xs text-gray-500">E (1–4)</span>
            <input type="number" min={1} max={4} className={cn(fieldRow, "w-14")} value={str(d.gcsE)} onChange={(e) => set("gcsE", e.target.value)} />
          </div>
          <div>
            <span className="text-xs text-gray-500">V (1–5)</span>
            <input type="number" min={1} max={5} className={cn(fieldRow, "w-14")} value={str(d.gcsV)} onChange={(e) => set("gcsV", e.target.value)} />
          </div>
          <div>
            <span className="text-xs text-gray-500">M (1–6)</span>
            <input type="number" min={1} max={6} className={cn(fieldRow, "w-14")} value={str(d.gcsM)} onChange={(e) => set("gcsM", e.target.value)} />
          </div>
          {total != null ? (
            <span className="mb-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">Total {total}</span>
          ) : null}
        </div>
      </div>
      <div>
        <Label>Orientation</Label>
        <ChipMulti value={(d.orientation as string[]) ?? []} onChange={(next) => set("orientation", next)} options={["Person", "Place", "Time"]} />
      </div>
      <div>
        <Label>Pupils</Label>
        <ChipSingle value={str(d.pupilsEqual)} onChange={(v) => set("pupilsEqual", v)} options={["Equal", "Unequal"]} />
        <div className="mt-2 flex gap-4">
          <input className={cn(fieldRow, "w-20")} placeholder="L mm" value={str(d.pupilL)} onChange={(e) => set("pupilL", e.target.value)} />
          <input className={cn(fieldRow, "w-20")} placeholder="R mm" value={str(d.pupilR)} onChange={(e) => set("pupilR", e.target.value)} />
        </div>
        <div className="mt-2">
          <Label>Reaction</Label>
          <ChipSingle value={str(d.pupilReaction)} onChange={(v) => set("pupilReaction", v)} options={["Reacting", "Sluggish", "Non-reacting"]} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <LimbMotor label="Motor — UL R" field="motorULR" d={d} set={set} />
        <LimbMotor label="Motor — UL L" field="motorULL" d={d} set={set} />
        <LimbMotor label="Motor — LL R" field="motorLLR" d={d} set={set} />
        <LimbMotor label="Motor — LL L" field="motorLLL" d={d} set={set} />
      </div>
      <div>
        <Label>Reflexes</Label>
        {(
          [
            ["Biceps", "reflexBiceps"],
            ["Triceps", "reflexTriceps"],
            ["Knee", "reflexKnee"],
            ["Ankle", "reflexAnkle"],
          ] as const
        ).map(([label, key]) => (
          <div key={key} className="mb-2">
            <span className="text-xs text-gray-500">{label}</span>
            <ChipSingle value={str(d[key])} onChange={(v) => set(key, v)} options={["Normal", "Exaggerated", "Diminished", "Absent"]} />
          </div>
        ))}
        <div>
          <span className="text-xs text-gray-500">Plantar</span>
          <ChipSingle value={str(d.reflexPlantar)} onChange={(v) => set("reflexPlantar", v)} options={["Flexor", "Extensor"]} />
        </div>
      </div>
      <div>
        <Label>Sensation</Label>
        <ChipSingle value={str(d.sensation)} onChange={(v) => set("sensation", v)} options={["Normal", "Impaired", "Absent"]} />
        <div className="mt-2">
          <Label>Modality</Label>
          <ChipMulti value={(d.sensationModality as string[]) ?? []} onChange={(next) => set("sensationModality", next)} options={["Touch", "Pain", "Vibration", "Proprioception"]} />
        </div>
      </div>
      <div>
        <Label>Cerebellar signs</Label>
        <ChipMulti
          value={(d.cerebellar as string[]) ?? []}
          onChange={(next) => set("cerebellar", next)}
          options={["None", "Ataxia", "Dysdiadochokinesia", "Dysmetria", "Nystagmus"]}
        />
      </div>
      <div>
        <Label>Meningeal signs</Label>
        <ChipMulti
          value={(d.meningeal as string[]) ?? []}
          onChange={(next) => set("meningeal", next)}
          options={["Absent", "Neck stiffness", "Kernig's sign", "Brudzinski's sign"]}
        />
      </div>
    </>
  );
}

function MskBlock({ systemId, value, onChange }: { systemId: string; value: Record<string, Record<string, unknown>>; onChange: (s: string, f: string, v: unknown) => void }) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);
  return (
    <>
      <div>
        <Label>Posture</Label>
        <ChipSingle value={str(d.posture)} onChange={(v) => set("posture", v)} options={["Normal", "Kyphosis", "Lordosis", "Scoliosis", "Antalgic lean"]} />
      </div>
      <div>
        <Label>Gait observation</Label>
        <ChipSingle
          value={str(d.gait)}
          onChange={(v) => set("gait", v)}
          options={["Normal", "Antalgic", "Trendelenburg", "Steppage", "Scissor", "Waddling"]}
        />
      </div>
      <OrthoAssessmentTools />
    </>
  );
}

function EndoBlock({
  systemId,
  value,
  onChange,
  vitals,
  voiceExam,
}: {
  systemId: string;
  value: Record<string, Record<string, unknown>>;
  onChange: (s: string, f: string, v: unknown) => void;
  vitals?: VitalsProp;
  voiceExam?: VoiceExamBundle;
}) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);
  const h = parseFloat(str(vitals?.heightCm)) || 0;
  const w = parseFloat(str(vitals?.weightKg)) || 0;
  const bmi = h > 0 && w > 0 ? w / (h / 100) ** 2 : null;
  const bmiCat =
    bmi == null
      ? ""
      : bmi < 18.5
        ? "Underweight"
        : bmi < 25
          ? "Normal"
          : bmi < 30
            ? "Overweight"
            : "Obese";
  const thyroid = str(d.thyroid);

  return (
    <>
      <div>
        <Label>Thyroid</Label>
        <ChipSingle value={thyroid} onChange={(v) => set("thyroid", v)} options={["Normal", "Goitre", "Nodule"]} />
        {(thyroid === "Goitre" || thyroid === "Nodule") && (
          <>
            <input className={cn(fieldRow, "mt-2 w-full")} placeholder="Size" value={str(d.thyroidSize)} onChange={(e) => set("thyroidSize", e.target.value)} />
            <div className="mt-2">
              <Label>Bruit</Label>
              <ChipSingle value={str(d.thyroidBruit)} onChange={(v) => set("thyroidBruit", v)} options={["Absent", "Present"]} />
            </div>
          </>
        )}
      </div>
      <div>
        <Label>Facial features</Label>
        <ChipSingle value={str(d.face)} onChange={(v) => set("face", v)} options={["Normal", "Myxoedematous", "Acromegalic", "Cushingoid"]} />
      </div>
      <div>
        <Label>BMI category</Label>
        {bmi != null ? <RefHint>Auto {bmi.toFixed(1)} kg/m² → suggested: {bmiCat}</RefHint> : null}
        <ChipSingle value={str(d.bmiCategory) || bmiCat} onChange={(v) => set("bmiCategory", v)} options={["Underweight", "Normal", "Overweight", "Obese"]} />
      </div>
      <div>
        <Label>Free text</Label>
        <ExamFreeTextWithVoice
          systemId={systemId}
          field="endoFreeText"
          value={str(d.endoFreeText)}
          onChange={(v) => set("endoFreeText", v)}
          voiceExam={voiceExam}
          className={cn(fieldRow, "min-h-[72px] w-full resize-none")}
        />
      </div>
    </>
  );
}

function GuBlock({
  systemId,
  value,
  onChange,
  voiceExam,
}: {
  systemId: string;
  value: Record<string, Record<string, unknown>>;
  onChange: (s: string, f: string, v: unknown) => void;
  voiceExam?: VoiceExamBundle;
}) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);
  const gen = str(d.genitalia);

  return (
    <>
      <div>
        <Label>Kidneys</Label>
        <ChipMulti value={(d.kidneys as string[]) ?? []} onChange={(next) => set("kidneys", next)} options={["Not palpable", "Ballotable R", "Ballotable L", "Tender"]} />
      </div>
      <div>
        <Label>Bladder</Label>
        <ChipSingle value={str(d.bladder)} onChange={(v) => set("bladder", v)} options={["Not palpable", "Palpable"]} />
      </div>
      <div>
        <Label>Genitalia exam</Label>
        <ChipSingle value={gen} onChange={(v) => set("genitalia", v)} options={["Normal", "Deferred", "Abnormal"]} />
        {gen === "Abnormal" ? (
          <ExamFreeTextWithVoice
            systemId={systemId}
            field="genitaliaText"
            value={str(d.genitaliaText)}
            onChange={(v) => set("genitaliaText", v)}
            voiceExam={voiceExam}
            className={cn(fieldRow, "mt-2 min-h-[60px] w-full resize-none")}
          />
        ) : null}
      </div>
      <div>
        <Label>Free text</Label>
        <ExamFreeTextWithVoice
          systemId={systemId}
          field="guFreeText"
          value={str(d.guFreeText)}
          onChange={(v) => set("guFreeText", v)}
          voiceExam={voiceExam}
          className={cn(fieldRow, "min-h-[72px] w-full resize-none")}
        />
      </div>
    </>
  );
}

function EntBlock({ systemId, value, onChange }: { systemId: string; value: Record<string, Record<string, unknown>>; onChange: (s: string, f: string, v: unknown) => void }) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);

  return (
    <>
      <div>
        <Label>Ear — L</Label>
        <ChipSingle value={str(d.earL)} onChange={(v) => set("earL", v)} options={["Normal", "Discharge", "Perforation", "Wax"]} />
      </div>
      <div>
        <Label>Ear — R</Label>
        <ChipSingle value={str(d.earR)} onChange={(v) => set("earR", v)} options={["Normal", "Discharge", "Perforation", "Wax"]} />
      </div>
      <div>
        <Label>Nose</Label>
        <ChipMulti value={(d.nose as string[]) ?? []} onChange={(next) => set("nose", next)} options={["Normal", "Deviated septum", "Polyp", "Discharge"]} />
      </div>
      <div>
        <Label>Throat</Label>
        <ChipMulti value={(d.throat as string[]) ?? []} onChange={(next) => set("throat", next)} options={["Normal", "Congested", "Tonsil enlargement", "Exudate"]} />
        {(d.throat as string[])?.includes("Tonsil enlargement") ? (
          <ChipSingle value={str(d.tonsilGrade)} onChange={(v) => set("tonsilGrade", v)} options={["1+", "2+", "3+", "4+"]} />
        ) : null}
      </div>
      <div>
        <Label>Lymph nodes</Label>
        <ChipMulti
          value={(d.lymph as string[]) ?? []}
          onChange={(next) => set("lymph", next)}
          options={["Not palpable", "Cervical", "Submandibular", "Supraclavicular"]}
        />
      </div>
    </>
  );
}

function OphthBlock({ systemId, value, onChange }: { systemId: string; value: Record<string, Record<string, unknown>>; onChange: (s: string, f: string, v: unknown) => void }) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);

  return (
    <>
      <div className="flex flex-wrap gap-4">
        <div className="min-w-[140px] flex-1">
          <Label>Visual acuity — R</Label>
          <input className={cn(fieldRow, "w-full")} placeholder="e.g. 6/6" value={str(d.vaR)} onChange={(e) => set("vaR", e.target.value)} />
        </div>
        <div className="min-w-[140px] flex-1">
          <Label>Visual acuity — L</Label>
          <input className={cn(fieldRow, "w-full")} placeholder="e.g. 6/9" value={str(d.vaL)} onChange={(e) => set("vaL", e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Conjunctiva</Label>
        <ChipSingle value={str(d.conjunctiva)} onChange={(v) => set("conjunctiva", v)} options={["Normal", "Pale", "Congested", "Icteric"]} />
      </div>
      <div>
        <Label>Cornea</Label>
        <ChipSingle value={str(d.cornea)} onChange={(v) => set("cornea", v)} options={["Clear", "Opaque", "Ulcer"]} />
      </div>
      <div>
        <Label>Fundus</Label>
        <ChipMulti value={(d.fundus as string[]) ?? []} onChange={(next) => set("fundus", next)} options={["Not examined", "Normal", "Papilloedema", "AV nipping", "Haemorrhage"]} />
      </div>
    </>
  );
}

function DermBlock({
  systemId,
  value,
  onChange,
  voiceExam,
}: {
  systemId: string;
  value: Record<string, Record<string, unknown>>;
  onChange: (s: string, f: string, v: unknown) => void;
  voiceExam?: VoiceExamBundle;
}) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);
  const rash = str(d.rash) === "Present";
  const wounds = str(d.wounds) === "Present";

  return (
    <>
      <div>
        <Label>Skin</Label>
        <ChipMulti
          value={(d.skin as string[]) ?? []}
          onChange={(next) => set("skin", next)}
          options={["Normal", "Pallor", "Jaundice", "Cyanosis", "Clubbing", "Koilonychia", "Leukonychia"]}
        />
      </div>
      <div>
        <Label>Rash</Label>
        <ChipSingle value={str(d.rash)} onChange={(v) => set("rash", v)} options={["Absent", "Present"]} />
        {rash ? (
          <>
            <input className={cn(fieldRow, "mt-2 w-full")} placeholder="Type" value={str(d.rashType)} onChange={(e) => set("rashType", e.target.value)} />
            <input className={cn(fieldRow, "mt-2 w-full")} placeholder="Distribution" value={str(d.rashDist)} onChange={(e) => set("rashDist", e.target.value)} />
          </>
        ) : null}
      </div>
      <div>
        <Label>Wounds / ulcers</Label>
        <ChipSingle value={str(d.wounds)} onChange={(v) => set("wounds", v)} options={["Absent", "Present"]} />
        {wounds ? (
          <ExamFreeTextWithVoice
            systemId={systemId}
            field="woundsText"
            value={str(d.woundsText)}
            onChange={(v) => set("woundsText", v)}
            voiceExam={voiceExam}
            className={cn(fieldRow, "mt-2 min-h-[60px] w-full resize-none")}
          />
        ) : null}
      </div>
    </>
  );
}

function PsychBlock({ systemId, value, onChange }: { systemId: string; value: Record<string, Record<string, unknown>>; onChange: (s: string, f: string, v: unknown) => void }) {
  const d = value[systemId] ?? {};
  const set = (f: string, v: unknown) => onChange(systemId, f, v);
  const hallu = (d.perception as string[])?.includes("Hallucinations");

  return (
    <>
      <div>
        <Label>Appearance & behaviour</Label>
        <ChipSingle value={str(d.appearance)} onChange={(v) => set("appearance", v)} options={["Appropriate", "Dishevelled", "Agitated", "Withdrawn"]} />
      </div>
      <div>
        <Label>Speech</Label>
        <ChipSingle value={str(d.speech)} onChange={(v) => set("speech", v)} options={["Normal", "Pressured", "Slowed", "Dysarthric"]} />
      </div>
      <div>
        <Label>Mood</Label>
        <ChipSingle value={str(d.mood)} onChange={(v) => set("mood", v)} options={["Euthymic", "Depressed", "Elevated", "Anxious", "Irritable"]} />
      </div>
      <div>
        <Label>Thought</Label>
        <ChipMulti value={(d.thought as string[]) ?? []} onChange={(next) => set("thought", next)} options={["Normal", "Tangential", "Flight of ideas", "Thought block", "Delusions"]} />
      </div>
      <div>
        <Label>Perception</Label>
        <ChipMulti value={(d.perception as string[]) ?? []} onChange={(next) => set("perception", next)} options={["Normal", "Hallucinations"]} />
        {hallu ? (
          <ChipMulti value={(d.halluType as string[]) ?? []} onChange={(next) => set("halluType", next)} options={["Auditory", "Visual", "Tactile"]} />
        ) : null}
      </div>
      <div>
        <Label>Cognition</Label>
        <ChipSingle value={str(d.cognition)} onChange={(v) => set("cognition", v)} options={["Grossly intact", "Impaired"]} />
        <input type="number" min={0} max={30} className={cn(fieldRow, "mt-2 w-24")} placeholder="MMSE 0–30" value={str(d.mmse)} onChange={(e) => set("mmse", e.target.value)} />
      </div>
      <div>
        <Label>Insight</Label>
        <ChipSingle value={str(d.insight)} onChange={(v) => set("insight", v)} options={["Full", "Partial", "Absent"]} />
      </div>
    </>
  );
}

function SystemFields({
  id,
  value,
  onChange,
  vitals,
  voiceExam,
}: {
  id: SystemId;
  value: Record<string, Record<string, unknown>>;
  onChange: (s: string, f: string, v: unknown) => void;
  vitals?: VitalsProp;
  voiceExam?: VoiceExamBundle;
}) {
  const meta = SYSTEMS.find((s) => s.id === id);
  if (!meta) return null;

  const body = (() => {
    switch (id) {
      case "cvs":
        return <CvsBlock systemId={id} value={value} onChange={onChange} vitals={vitals} />;
      case "rs":
        return <RsBlock systemId={id} value={value} onChange={onChange} vitals={vitals} />;
      case "gi":
        return <GiBlock systemId={id} value={value} onChange={onChange} voiceExam={voiceExam} />;
      case "cns":
        return <CnsBlock systemId={id} value={value} onChange={onChange} />;
      case "msk":
        return <MskBlock systemId={id} value={value} onChange={onChange} />;
      case "endo":
        return <EndoBlock systemId={id} value={value} onChange={onChange} vitals={vitals} voiceExam={voiceExam} />;
      case "gu":
        return <GuBlock systemId={id} value={value} onChange={onChange} voiceExam={voiceExam} />;
      case "ent":
        return <EntBlock systemId={id} value={value} onChange={onChange} />;
      case "ophth":
        return <OphthBlock systemId={id} value={value} onChange={onChange} />;
      case "derm":
        return <DermBlock systemId={id} value={value} onChange={onChange} voiceExam={voiceExam} />;
      case "psych":
        return <PsychBlock systemId={id} value={value} onChange={onChange} />;
      default:
        return null;
    }
  })();

  return (
    <CollapsibleCard title={meta.label} snomed={meta.snomed}>
      {body}
    </CollapsibleCard>
  );
}

export type VitalsProp = {
  bpSys?: string;
  bpDia?: string;
  spo2?: string;
  heightCm?: string;
  weightKg?: string;
};

export type SystemicExamState = Record<string, Record<string, unknown>>;

export default function SystemicExaminationSection({
  vitals,
  value,
  onChange,
  loadedSystemIds,
  onLoadedSystemIdsChange,
  voiceExam,
}: {
  vitals?: VitalsProp;
  value: SystemicExamState;
  onChange: (systemId: string, field: string, value: unknown) => void;
  loadedSystemIds: string[];
  onLoadedSystemIdsChange: (ids: string[]) => void;
  voiceExam?: VoiceExamBundle;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (loadedSystemIds.length > 0) setSelected(new Set(loadedSystemIds));
  }, [loadedSystemIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const orderedLoaded = useMemo(() => {
    const order = SYSTEMS.map((s) => s.id);
    return order.filter((id) => loadedSystemIds.includes(id));
  }, [loadedSystemIds]);

  const canLoad = selected.size >= 1;

  const handleLoad = () => {
    const order = SYSTEMS.map((s) => s.id);
    onLoadedSystemIdsChange(order.filter((id) => selected.has(id)));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SYSTEMS.map((s) => (
          <SystemSelectCard key={s.id} system={s} checked={selected.has(s.id)} onToggle={() => toggle(s.id)} />
        ))}
      </div>
      <button
        type="button"
        disabled={!canLoad}
        onClick={handleLoad}
        className={cn(
          "rounded-xl px-6 py-2.5 text-sm font-medium transition-colors",
          canLoad ? "bg-blue-600 text-white hover:bg-blue-700" : "cursor-not-allowed bg-gray-100 text-gray-400",
        )}
      >
        Load selected systems
      </button>

      {orderedLoaded.map((id) => (
        <SystemFields
          key={id}
          id={id as SystemId}
          value={value}
          onChange={onChange}
          vitals={vitals}
          voiceExam={voiceExam}
        />
      ))}
    </div>
  );
}
