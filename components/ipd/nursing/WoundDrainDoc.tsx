"use client";

import { format, subDays } from "date-fns";
import { Camera, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { supabase } from "../../../lib/supabase";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import {
  defaultNursingShiftFromClockQueue,
  type NursingShiftUi,
} from "./NursingTaskQueue";

const BUCKET = "wound-photos";

export type WoundDrainDocProps = {
  admissionId: string;
  patientId: string;
  hospitalId: string;
  practitionerId: string;
  className?: string;
};

type WoundType = "surgical" | "traumatic" | "pressure" | "other";
type DischargeType = "none" | "serous" | "serosanguinous" | "purulent";
type SutureStatus = "intact" | "partial_dehiscence" | "full_dehiscence";
type Grade4 = "none" | "mild" | "moderate" | "severe";

type WoundAssessmentRow = {
  id: string;
  wound_location: string;
  wound_type: string;
  discharge_type: string;
  suture_status: string;
  swelling: string;
  erythema: string;
  wound_dehiscence: boolean;
  drain_present: boolean;
  wound_notes: string | null;
  assessed_at: string;
  photo_storage_paths: string[] | null;
};

type DrainRecordRow = {
  id: string;
  shift: string;
  drain_name: string;
  drain_type: string;
  output_ml: number | string | null;
  colour: string;
  consistency: string;
  odour: string;
  drain_site_ok: boolean;
  drain_removed: boolean;
  removed_at: string | null;
  notes: string | null;
  recorded_at: string;
};

const MAX_WOUND_PHOTOS = 5;
const MAX_WOUND_PHOTO_BYTES = 5 * 1024 * 1024;

type StagedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

function shiftUiToKey(s: NursingShiftUi): string {
  return s.toLowerCase();
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function ymdLocal(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

const DISCHARGE_OPTIONS: DischargeType[] = [
  "none",
  "serous",
  "serosanguinous",
  "purulent",
];

const COLOUR_OPTIONS: {
  value: string;
  label: string;
  chip: string;
}[] = [
  { value: "sanguinous", label: "Sanguinous", chip: "bg-red-100 text-red-900 ring-red-200" },
  { value: "serosanguinous", label: "Serosanguinous", chip: "bg-rose-100 text-rose-900 ring-rose-200" },
  { value: "serous", label: "Serous", chip: "bg-amber-50 text-amber-900 ring-amber-200" },
  { value: "purulent", label: "Purulent", chip: "bg-lime-100 text-lime-950 ring-lime-300" },
  { value: "bilious", label: "Bilious", chip: "bg-green-100 text-green-900 ring-green-200" },
];

const DRAIN_TYPES: { value: string; label: string }[] = [
  { value: "closed_suction", label: "Closed suction" },
  { value: "open", label: "Open" },
  { value: "jackson_pratt", label: "Jackson-Pratt" },
  { value: "penrose", label: "Penrose" },
];

const CONSISTENCY_OPTS = ["thin", "thick", "clotted"] as const;
const ODOUR_OPTS = ["none", "mild", "offensive"] as const;

function grade4Label(g: Grade4): string {
  return g.charAt(0).toUpperCase() + g.slice(1);
}

export function WoundDrainDoc({
  admissionId,
  patientId,
  hospitalId,
  practitionerId,
  className,
}: WoundDrainDocProps) {
  const [tab, setTab] = useState<"wound" | "drain">("wound");
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<WoundAssessmentRow[]>([]);
  /** assessment id → signed thumbnail URLs (same order as photo_storage_paths). */
  const [signedPhotoUrlsByAssessment, setSignedPhotoUrlsByAssessment] = useState<
    Record<string, string[]>
  >({});
  const [photoPickError, setPhotoPickError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [drainRows, setDrainRows] = useState<DrainRecordRow[]>([]);

  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [woundLocation, setWoundLocation] = useState("");
  const [woundType, setWoundType] = useState<WoundType>("surgical");
  const [dischargeType, setDischargeType] = useState<DischargeType>("none");
  const [sutureStatus, setSutureStatus] = useState<SutureStatus>("intact");
  const [swelling, setSwelling] = useState<Grade4>("none");
  const [erythema, setErythema] = useState<Grade4>("none");
  const [woundDehiscence, setWoundDehiscence] = useState(false);
  const [drainPresent, setDrainPresent] = useState(false);
  const [woundNotes, setWoundNotes] = useState("");
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);

  const [drainName, setDrainName] = useState("Surgical Drain");
  const [drainType, setDrainType] = useState("jackson_pratt");
  const [outputMl, setOutputMl] = useState<string>("0");
  const [colour, setColour] = useState("serosanguinous");
  const [consistency, setConsistency] = useState<string>("thin");
  const [odour, setOdour] = useState<string>("none");
  const [drainSiteOk, setDrainSiteOk] = useState(true);
  const [drainRemoved, setDrainRemoved] = useState(false);
  const [removedAtLocal, setRemovedAtLocal] = useState("");
  const [drainNotes, setDrainNotes] = useState("");
  const [drainShift, setDrainShift] = useState<NursingShiftUi>(() =>
    defaultNursingShiftFromClockQueue(),
  );
  const [drainSaving, setDrainSaving] = useState(false);

  const loadWounds = useCallback(async () => {
    const { data, error } = await supabase
      .from("ipd_wound_assessments")
      .select(
        "id, wound_location, wound_type, discharge_type, suture_status, swelling, erythema, wound_dehiscence, drain_present, wound_notes, assessed_at, photo_storage_paths",
      )
      .eq("admission_id", admissionId)
      .order("assessed_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (Array.isArray(data) ? data : []) as WoundAssessmentRow[];
    setAssessments(rows);

    const nextSigned: Record<string, string[]> = {};
    for (const a of rows) {
      const paths = (a.photo_storage_paths ?? []).filter((p) => typeof p === "string" && p.trim() !== "");
      if (paths.length === 0) continue;
      const { data: signedBatch, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600);
      if (signErr) {
        toast.error(signErr.message);
        continue;
      }
      const urls = (signedBatch ?? [])
        .map((entry) => {
          if (entry && typeof entry === "object" && "signedUrl" in entry && entry.signedUrl) {
            return String(entry.signedUrl);
          }
          return "";
        })
        .filter(Boolean);
      nextSigned[a.id] = urls;
    }
    setSignedPhotoUrlsByAssessment(nextSigned);
  }, [admissionId]);

  const loadDrains = useCallback(async () => {
    const { data, error } = await supabase
      .from("ipd_drain_records")
      .select(
        "id, shift, drain_name, drain_type, output_ml, colour, consistency, odour, drain_site_ok, drain_removed, removed_at, notes, recorded_at",
      )
      .eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }
    setDrainRows((Array.isArray(data) ? data : []) as DrainRecordRow[]);
  }, [admissionId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadWounds(), loadDrains()]);
    setLoading(false);
  }, [loadDrains, loadWounds]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    return () => {
      for (const s of stagedPhotos) {
        URL.revokeObjectURL(s.previewUrl);
      }
    };
  }, [stagedPhotos]);

  const resetWoundForm = () => {
    setWoundLocation("");
    setWoundType("surgical");
    setDischargeType("none");
    setSutureStatus("intact");
    setSwelling("none");
    setErythema("none");
    setWoundDehiscence(false);
    setDrainPresent(false);
    setWoundNotes("");
    setPhotoPickError(null);
    for (const s of stagedPhotos) {
      URL.revokeObjectURL(s.previewUrl);
    }
    setStagedPhotos([]);
  };

  const onPickPhotos = (files: FileList | null) => {
    setPhotoPickError(null);
    if (!files?.length) return;
    const incoming: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i);
      if (!file || !file.type.startsWith("image/")) continue;
      if (file.size > MAX_WOUND_PHOTO_BYTES) {
        setPhotoPickError(`Each photo must be at most 5 MB (“${file.name}” is too large).`);
        return;
      }
      incoming.push(file);
    }
    if (incoming.length === 0) return;
    const room = MAX_WOUND_PHOTOS - stagedPhotos.length;
    if (room <= 0) {
      setPhotoPickError(`You can add at most ${MAX_WOUND_PHOTOS} photos per assessment.`);
      return;
    }
    const take = incoming.slice(0, room);
    if (incoming.length > room) {
      setPhotoPickError(`Only ${room} more photo(s) allowed (max ${MAX_WOUND_PHOTOS} per assessment).`);
    }
    const next: StagedPhoto[] = [
      ...stagedPhotos,
      ...take.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ];
    setStagedPhotos(next);
  };

  const removeStaged = (idx: number) => {
    setStagedPhotos((prev) => {
      const copy = [...prev];
      const [x] = copy.splice(idx, 1);
      if (x) URL.revokeObjectURL(x.previewUrl);
      return copy;
    });
  };

  const submitWoundAssessment = async () => {
    const loc = woundLocation.trim();
    if (!loc) {
      toast.error("Wound location is required");
      return;
    }
    const assessmentId = crypto.randomUUID();
    const uploadedPaths: string[] = [];

    setSaving(true);
    for (let i = 0; i < stagedPhotos.length; i++) {
      const file = stagedPhotos[i].file;
      const ext = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
      const path = `${hospitalId}/${admissionId}/${assessmentId}/${Date.now()}_${i}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (upErr) {
        setSaving(false);
        toast.error(upErr.message);
        return;
      }
      uploadedPaths.push(path);
    }

    const { error: insErr } = await supabase.from("ipd_wound_assessments").insert({
      id: assessmentId,
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      wound_location: loc,
      wound_type: woundType,
      discharge_type: dischargeType,
      suture_status: sutureStatus,
      swelling,
      erythema,
      wound_dehiscence: woundDehiscence,
      drain_present: drainPresent,
      wound_notes: woundNotes.trim() || null,
      assessed_by: practitionerId,
      photo_storage_paths: uploadedPaths,
    });

    setSaving(false);
    if (insErr) {
      toast.error(insErr.message);
      return;
    }
    toast.success("Assessment saved");
    setPanelOpen(false);
    resetWoundForm();
    void loadWounds();
  };

  const submitDrain = async () => {
    const ml = Number.parseFloat(outputMl);
    if (!Number.isFinite(ml) || ml < 0) {
      toast.error("Enter a valid output (ml)");
      return;
    }
    let removedIso: string | null = null;
    if (drainRemoved) {
      if (!removedAtLocal) {
        toast.error("Select date/time when drain was removed");
        return;
      }
      const t = new Date(removedAtLocal);
      if (Number.isNaN(t.getTime())) {
        toast.error("Invalid removal time");
        return;
      }
      removedIso = t.toISOString();
    } else {
      removedIso = null;
    }

    setDrainSaving(true);
    const { error } = await supabase.from("ipd_drain_records").insert({
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      wound_assessment_id: null,
      shift: shiftUiToKey(drainShift),
      drain_name: drainName.trim() || "Surgical Drain",
      drain_type: drainType,
      output_ml: ml,
      colour,
      consistency,
      odour,
      drain_site_ok: drainSiteOk,
      drain_removed: drainRemoved,
      removed_at: removedIso,
      notes: drainNotes.trim() || null,
      recorded_by: practitionerId,
    });
    setDrainSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Drain entry saved");
    setOutputMl("0");
    setDrainNotes("");
    setDrainRemoved(false);
    setRemovedAtLocal("");
    void loadDrains();
  };

  const chartData = useMemo(() => {
    const end = new Date();
    const days: { key: string; label: string; morning: number; afternoon: number; night: number }[] =
      [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(end, i);
      const key = ymdLocal(d);
      days.push({
        key,
        label: format(d, "EEE d MMM"),
        morning: 0,
        afternoon: 0,
        night: 0,
      });
    }
    const dayIndex = new Map(days.map((x, i) => [x.key, i] as const));
    const cutoff = subDays(end, 7);
    cutoff.setHours(0, 0, 0, 0);

    for (const r of drainRows) {
      const t = new Date(r.recorded_at);
      if (t < cutoff) continue;
      const k = ymdLocal(t);
      const idx = dayIndex.get(k);
      if (idx === undefined) continue;
      const sh = String(r.shift ?? "").toLowerCase().trim();
      const ml = num(r.output_ml);
      if (sh === "morning") days[idx].morning += ml;
      else if (sh === "afternoon") days[idx].afternoon += ml;
      else if (sh === "night") days[idx].night += ml;
    }
    return days;
  }, [drainRows]);

  const tabBtn = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
      active ? "bg-blue-600 text-white shadow-sm" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50",
    );

  if (loading) {
    return (
      <div className={cn("space-y-3", className)}>
        <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabBtn(tab === "wound")} onClick={() => setTab("wound")}>
          Wound assessment
        </button>
        <button type="button" className={tabBtn(tab === "drain")} onClick={() => setTab("drain")}>
          Drain log
        </button>
      </div>

      {tab === "wound" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Structured wound checks and photos for this admission.
            </p>
            <Button type="button" onClick={() => setPanelOpen(true)}>
              New assessment
            </Button>
          </div>

          <ul className="space-y-3">
            {assessments.length === 0 ? (
              <li className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
                No wound assessments yet.
              </li>
            ) : (
              assessments.map((a) => {
                const photoUrls = signedPhotoUrlsByAssessment[a.id] ?? [];
                return (
                  <li
                    key={a.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">{a.wound_location}</p>
                        <p className="text-xs text-slate-500">
                          {format(new Date(a.assessed_at), "dd MMM yyyy, HH:mm")}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-700">
                        {a.wound_type}
                      </span>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
                      <div>
                        <dt className="text-slate-500">Discharge</dt>
                        <dd className="font-medium capitalize">{a.discharge_type.replace(/_/g, " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Suture</dt>
                        <dd className="font-medium capitalize">{a.suture_status.replace(/_/g, " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Swelling / Erythema</dt>
                        <dd className="font-medium capitalize">
                          {a.swelling} / {a.erythema}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Dehiscence / Drain at wound</dt>
                        <dd className="font-medium">
                          {a.wound_dehiscence ? "Yes" : "No"} · {a.drain_present ? "Drain noted" : "—"}
                        </dd>
                      </div>
                    </dl>
                    {a.wound_notes ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{a.wound_notes}</p>
                    ) : null}
                    {photoUrls.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {photoUrls.map((url, pi) => (
                          <button
                            key={`${a.id}-ph-${pi}`}
                            type="button"
                            className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onClick={() => setLightboxUrl(url)}
                          >
                            {url ? (
                              <img
                                src={url}
                                alt="Wound"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Camera className="h-6 w-6 text-slate-400" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>

          {panelOpen ? (
            <div
              className="fixed inset-0 z-[60] flex justify-end bg-black/40"
              role="dialog"
              aria-modal
              onClick={() => !saving && setPanelOpen(false)}
            >
              <div
                className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 className="text-base font-semibold text-slate-900">New wound assessment</h2>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100"
                    onClick={() => !saving && setPanelOpen(false)}
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
                  <div>
                    <Label>Wound location</Label>
                    <Input
                      className="mt-1"
                      value={woundLocation}
                      onChange={(e) => setWoundLocation(e.target.value)}
                      placeholder='e.g. Right knee — surgical'
                    />
                  </div>

                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">Wound type</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ["surgical", "Surgical"],
                          ["traumatic", "Traumatic"],
                          ["pressure", "Pressure"],
                          ["other", "Other"],
                        ] as const
                      ).map(([v, label]) => (
                        <label
                          key={v}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                            woundType === v
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-200 hover:bg-slate-50",
                          )}
                        >
                          <input
                            type="radio"
                            name="wound_type"
                            className="accent-blue-600"
                            checked={woundType === v}
                            onChange={() => setWoundType(v)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div>
                    <Label>Discharge</Label>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {DISCHARGE_OPTIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDischargeType(d)}
                          className={cn(
                            "rounded-lg border px-2 py-2 text-center text-xs font-medium capitalize",
                            dischargeType === d
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                          )}
                        >
                          {d === "none" ? "None" : d.replace(/_/g, " ")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <fieldset>
                    <legend className="text-sm font-medium text-slate-700">Suture status</legend>
                    <div className="mt-2 flex flex-col gap-2">
                      {(
                        [
                          ["intact", "Intact"],
                          ["partial_dehiscence", "Partial dehiscence"],
                          ["full_dehiscence", "Full dehiscence"],
                        ] as const
                      ).map(([v, label]) => (
                        <label
                          key={v}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                            sutureStatus === v
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-200 hover:bg-slate-50",
                          )}
                        >
                          <input
                            type="radio"
                            name="suture"
                            checked={sutureStatus === v}
                            onChange={() => setSutureStatus(v)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <Grade4Row label="Swelling" value={swelling} onChange={setSwelling} />
                  <Grade4Row label="Erythema" value={erythema} onChange={setErythema} />

                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={woundDehiscence}
                      onChange={(e) => setWoundDehiscence(e.target.checked)}
                    />
                    Wound dehiscence
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={drainPresent}
                      onChange={(e) => setDrainPresent(e.target.checked)}
                    />
                    Drain present at wound
                  </label>

                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      className="mt-1"
                      rows={3}
                      value={woundNotes}
                      onChange={(e) => setWoundNotes(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label>Photos</Label>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Up to {MAX_WOUND_PHOTOS} images, 5 MB each.
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="mt-1 block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
                      onChange={(e) => {
                        onPickPhotos(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    {photoPickError ? (
                      <p className="mt-1 text-xs text-red-600">{photoPickError}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {stagedPhotos.map((s, idx) => (
                        <div key={s.id} className="relative h-16 w-16 overflow-hidden rounded-md border">
                          <img src={s.previewUrl} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            className="absolute right-0 top-0 rounded-bl bg-black/50 p-0.5 text-white"
                            onClick={() => removeStaged(idx)}
                            aria-label="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="border-t border-slate-200 px-4 py-3">
                  <Button
                    type="button"
                    className="w-full"
                    disabled={saving}
                    onClick={() => void submitWoundAssessment()}
                  >
                    {saving ? "Saving…" : "Save assessment"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {lightboxUrl ? (
            <button
              type="button"
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
              aria-label="Close full screen image"
              onClick={() => setLightboxUrl(null)}
            >
              <img src={lightboxUrl} alt="Wound full size" className="max-h-full max-w-full object-contain" />
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Drain output (last 7 days)</h3>
            <p className="text-xs text-slate-500">Stacked by shift (Morning / Afternoon / Night).</p>
            <div className="mt-4 h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} className="text-slate-500" />
                  <YAxis tick={{ fontSize: 10 }} width={36} label={{ value: "ml", angle: -90, position: "insideLeft", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                          <p className="mb-1 font-semibold text-slate-800">{String(label)}</p>
                          <ul className="space-y-0.5 text-slate-600">
                            {payload.map((p) => (
                              <li key={String(p.name)}>
                                {String(p.name)}: {num(p.value)} ml
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="morning" stackId="out" name="Morning" fill="#f59e0b" />
                  <Bar dataKey="afternoon" stackId="out" name="Afternoon" fill="#ea580c" />
                  <Bar dataKey="night" stackId="out" name="Night" fill="#4f46e5" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">New drain entry</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Shift</Label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={drainShift}
                  onChange={(e) => setDrainShift(e.target.value as NursingShiftUi)}
                >
                  <option value="Morning">Morning</option>
                  <option value="Afternoon">Afternoon</option>
                  <option value="Night">Night</option>
                </select>
              </div>
              <div>
                <Label>Drain name</Label>
                <Input
                  className="mt-1"
                  value={drainName}
                  onChange={(e) => setDrainName(e.target.value)}
                />
              </div>
              <div>
                <Label>Drain type</Label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={drainType}
                  onChange={(e) => setDrainType(e.target.value)}
                >
                  {DRAIN_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Output (ml)</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min={0}
                  step={0.1}
                  value={outputMl}
                  onChange={(e) => setOutputMl(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Colour</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COLOUR_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColour(c.value)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                        c.chip,
                        colour === c.value ? "ring-2 ring-blue-600 ring-offset-1" : "",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Consistency</Label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={consistency}
                  onChange={(e) => setConsistency(e.target.value)}
                >
                  {CONSISTENCY_OPTS.map((x) => (
                    <option key={x} value={x}>
                      {x.charAt(0).toUpperCase() + x.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Odour</Label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={odour}
                  onChange={(e) => setOdour(e.target.value)}
                >
                  {ODOUR_OPTS.map((x) => (
                    <option key={x} value={x}>
                      {x.charAt(0).toUpperCase() + x.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={drainSiteOk}
                  onChange={(e) => setDrainSiteOk(e.target.checked)}
                />
                Drain site OK
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={drainRemoved}
                  onChange={(e) => setDrainRemoved(e.target.checked)}
                />
                Drain removed
              </label>
              {drainRemoved ? (
                <div className="sm:col-span-2">
                  <Label>Removed at</Label>
                  <Input
                    className="mt-1"
                    type="datetime-local"
                    value={removedAtLocal}
                    onChange={(e) => setRemovedAtLocal(e.target.value)}
                  />
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  value={drainNotes}
                  onChange={(e) => setDrainNotes(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="button"
              className="mt-4"
              disabled={drainSaving}
              onClick={() => void submitDrain()}
            >
              {drainSaving ? "Saving…" : "Save drain entry"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Recorded</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2">Drain</th>
                  <th className="px-3 py-2">Out (ml)</th>
                  <th className="px-3 py-2">Colour</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Removed</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drainRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      No drain records yet.
                    </td>
                  </tr>
                ) : (
                  drainRows.map((r) => (
                    <tr key={r.id} className="text-slate-800">
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {format(new Date(r.recorded_at), "dd MMM HH:mm")}
                      </td>
                      <td className="px-3 py-2 capitalize">{r.shift}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{r.drain_name}</span>
                        <span className="block text-[10px] text-slate-500">
                          {r.drain_type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="tabular-nums px-3 py-2">{num(r.output_ml)}</td>
                      <td className="px-3 py-2 capitalize">{r.colour}</td>
                      <td className="px-3 py-2">{r.drain_site_ok ? "OK" : "Concern"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.drain_removed
                          ? r.removed_at
                            ? format(new Date(r.removed_at), "dd MMM HH:mm")
                            : "Yes"
                          : "—"}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-xs text-slate-600">
                        {r.notes ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Grade4Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Grade4;
  onChange: (g: Grade4) => void;
}) {
  const opts: Grade4[] = ["none", "mild", "moderate", "severe"];
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {opts.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onChange(g)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium",
              value === g
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
            )}
          >
            {grade4Label(g)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default WoundDrainDoc;
