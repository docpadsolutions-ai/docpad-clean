"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  Circle as CircleIcon,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  Move,
  Pencil,
  Plus,
  Ruler,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchXrayMeasurementsForEncounter, upsertXrayMeasurement } from "@/app/lib/xrayMeasurementRpc";
import { XRAY_PRESETS, presetsForSpecialty, type XrayPreset } from "./xray-presets";
import type {
  CalibrationState,
  CanvasObject,
  CanvasPoint,
  Measurement,
  MeasurementStatus,
  MeasurementType,
  ObjectType,
  Specialty,
} from "./xray-types";
import {
  angleBetweenLinesDeg,
  cobbAngleDeg,
  lineLengthPx,
  ratioOfLineLengths,
  scoliosisCobbStatus,
} from "./xray-geometry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLORS: Record<ObjectType, string> = {
  line: "#3B82F6",
  circle: "#8B5CF6",
  point: "#EF4444",
};

export type XrayMeasurementToolProps = {
  encounterId: string;
  patientId: string;
  hospitalId: string;
  doctorId?: string;
  specialty: Specialty;
  onClose: () => void;
  onSave?: (summary: string) => void;
};

type Tool = "none" | "select" | "pan" | "point" | "line" | "circle";

function newId(): string {
  return crypto.randomUUID();
}

function statusBadgeClass(s: MeasurementStatus): string {
  switch (s) {
    case "normal":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
    case "borderline":
      return "bg-amber-500/20 text-amber-400 border-amber-500/40";
    case "abnormal":
      return "bg-red-500/20 text-red-400 border-red-500/40";
    case "severe":
      return "bg-red-700/30 text-red-300 border-red-600/50";
    default:
      return "bg-gray-700 text-gray-300 border-gray-600";
  }
}

function mapScoliosisToMeasurementStatus(
  s: ReturnType<typeof scoliosisCobbStatus>,
): MeasurementStatus {
  if (s === "severe") return "severe";
  if (s === "abnormal") return "abnormal";
  if (s === "borderline") return "borderline";
  return "normal";
}

function buildSummary(
  specialty: Specialty,
  measurements: Measurement[],
  calibration: CalibrationState,
): string {
  const specLabel = specialty === "orthopaedics" ? "Orthopaedics" : "Neurosurgery";
  const parts = measurements.map((m) => {
    const u = m.unit === "degrees" ? "°" : m.unit === "mm" ? " mm" : m.unit === "ratio" ? "" : ` ${m.unit}`;
    const val = m.unit === "ratio" ? m.value.toFixed(3) : m.value.toFixed(1);
    const range = m.normalRange ? `, ref: ${m.normalRange}` : "";
    const st = m.status !== "unchecked" ? ` (${m.status})` : "";
    return `${m.label}: ${val}${u}${st}${range}`;
  });
  const cal = calibration.isCalibrated ? " [Calibrated]" : "";
  return `Radiological Measurements (${specLabel})${cal}: ${parts.join("; ")}`;
}

export default function XrayMeasurementTool({
  encounterId,
  patientId,
  hospitalId,
  doctorId,
  specialty,
  onClose,
  onSave,
}: XrayMeasurementToolProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("line");
  const [objects, setObjects] = useState<CanvasObject[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [calibration, setCalibration] = useState<CalibrationState>({
    isCalibrated: false,
    pxPerMm: null,
    referenceLabel: "",
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelText, setEditingLabelText] = useState("");
  const [summaryText, setSummaryText] = useState("");

  const [draft, setDraft] = useState<
    | { kind: "line"; p1: CanvasPoint | null; ghost: CanvasPoint | null }
    | { kind: "circle"; center: CanvasPoint | null; ghost: CanvasPoint | null }
    | { kind: "point" }
    | null
  >(null);

  const [drag, setDrag] = useState<{
    type: "pan" | "handle";
    startClient: CanvasPoint;
    startObj?: CanvasObject;
    handle?: "p1" | "p2" | "c" | "rp";
  } | null>(null);

  const [activePreset, setActivePreset] = useState<XrayPreset | null>(null);
  const [presetStep, setPresetStep] = useState(0);
  const [calibrationMode, setCalibrationMode] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const presets = useMemo(() => presetsForSpecialty(specialty), [specialty]);

  const pxToMm = useCallback(
    (px: number) => (calibration.isCalibrated && calibration.pxPerMm ? px / calibration.pxPerMm : px),
    [calibration],
  );

  const unitDist = calibration.isCalibrated ? "mm" : "px";

  const loadSession = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchXrayMeasurementsForEncounter(supabase, encounterId);
    setLoading(false);
    if (error) {
      console.warn("[XrayMeasurementTool]", error.message);
      return;
    }
    if (!data) return;
    setObjects(data.canvasObjects ?? []);
    setMeasurements(data.measurements ?? []);
    setCalibration(data.calibration);
    if (data.presetUsed) {
      const p = XRAY_PRESETS.find((x) => x.id === data.presetUsed);
      if (p) {
        setActivePreset(p);
        setPresetStep(typeof data.presetStep === "number" ? data.presetStep : 0);
      }
    }
    if (data.summaryText) setSummaryText(data.summaryText);
  }, [encounterId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectedLines = useMemo(
    () => objects.filter((o) => selectedIds.has(o.id) && o.type === "line" && o.visible),
    [objects, selectedIds],
  );

  const addObject = (o: CanvasObject) => {
    setObjects((prev) => [...prev, o]);
  };

  const runPresetComplete = useCallback(
    (preset: XrayPreset, objs: CanvasObject[]) => {
      const byName = (n: string) => objs.find((o) => o.name === n && o.type === "line");
      const mk = (
        type: MeasurementType,
        label: string,
        value: number,
        unit: string,
        status: MeasurementStatus,
        normalRange: string | undefined,
        used: string[],
      ) => {
        const m: Measurement = {
          id: newId(),
          type,
          label,
          value,
          unit,
          status,
          normalRange,
          objectsUsed: used,
        };
        setMeasurements((prev) => [...prev, m]);
      };

      if (preset.id === "knee_alignment") {
        const a = byName("Mechanical axis femur");
        const b = byName("Mechanical axis tibia");
        if (a && b) {
          const deg = angleBetweenLinesDeg(a, b);
          if (deg != null)
            mk("angle", "Mechanical axis interline angle (approx.)", deg, "degrees", "unchecked", "—", [a.id, b.id]);
        }
      } else if (preset.id === "hip_dysplasia") {
        const a = byName("Weight-bearing line");
        const b = byName("Acetabular roof line");
        if (a && b) {
          const deg = angleBetweenLinesDeg(a, b);
          if (deg != null)
            mk("angle", "Acetabular–weight-bearing angle (approx.)", deg, "degrees", "unchecked", "25–40°", [a.id, b.id]);
        }
      } else if (preset.id === "scoliosis") {
        const a = byName("Superior endplate line");
        const b = byName("Inferior endplate line");
        if (a && b) {
          const deg = cobbAngleDeg(a, b);
          if (deg != null) {
            const st = scoliosisCobbStatus(deg);
            mk("cobb", "Cobb angle", deg, "degrees", mapScoliosisToMeasurementStatus(st), "<10° mild", [a.id, b.id]);
          }
        }
      } else if (preset.id === "foot_ankle") {
        const a = byName("Calcaneal axis");
        const b = byName("Talar axis");
        if (a && b) {
          const deg = angleBetweenLinesDeg(a, b);
          if (deg != null) mk("angle", "Inter-axis angle (Böhler/HVA context)", deg, "degrees", "unchecked", "—", [a.id, b.id]);
        }
      } else if (preset.id === "cervical_spine") {
        const a = byName("C2 line");
        const b = byName("C7 line");
        if (a && b) {
          const deg = cobbAngleDeg(a, b);
          if (deg != null) {
            let st: MeasurementStatus = "unchecked";
            if (deg >= 20 && deg <= 40) st = "normal";
            else if (deg < 20) st = "borderline";
            else st = "abnormal";
            mk("cobb", "Cervical lordosis (C2–C7)", deg, "degrees", st, "20–40°", [a.id, b.id]);
          }
        }
      } else if (preset.id === "craniovertebral") {
        const a = byName("Basion–opisthion line");
        const b = byName("Odontoid tip line");
        if (a && b) {
          const deg = angleBetweenLinesDeg(a, b);
          if (deg != null) mk("angle", "Cobb–Webb angle (approx.)", deg, "degrees", "unchecked", "—", [a.id, b.id]);
        }
        const adi = byName("ADI line");
        if (adi && adi.p1 && adi.p2) {
          const px = lineLengthPx(adi);
          if (px != null) {
            const mm = pxToMm(px);
            const val = calibration.isCalibrated ? mm : px;
            const st: MeasurementStatus =
              calibration.isCalibrated && mm < 3 ? "normal" : calibration.isCalibrated ? "abnormal" : "unchecked";
            mk("distance", "ADI (approx.)", val, calibration.isCalibrated ? "mm" : "px", st, "<3 mm adult", [adi.id]);
          }
        }
      } else if (preset.id === "lumbar_spine") {
        const a = byName("L1 endplate");
        const b = byName("S1 endplate");
        if (a && b) {
          const deg = cobbAngleDeg(a, b);
          if (deg != null) {
            let st: MeasurementStatus = "unchecked";
            if (deg >= 40 && deg <= 60) st = "normal";
            else st = "borderline";
            mk("cobb", "Lumbar lordosis (L1–S1)", deg, "degrees", st, "40–60°", [a.id, b.id]);
          }
        }
      }
      toast.success("Preset measurements added");
    },
    [calibration.isCalibrated, pxToMm],
  );

  const finishLine = (p1: CanvasPoint, p2: CanvasPoint) => {
    const id = newId();
    const stepName =
      activePreset && activePreset.steps[presetStep] ? activePreset.steps[presetStep].objectName : undefined;
    const label =
      stepName ?? `Line ${objects.filter((x) => x.type === "line").length + 1}`;
    const newObj: CanvasObject = {
      id,
      type: "line",
      name: label,
      color: COLORS.line,
      visible: true,
      selected: false,
      p1,
      p2,
    };
    setObjects((prev) => {
      const next = [...prev, newObj];
      if (activePreset) {
        setPresetStep((ps) => {
          const ns = ps + 1;
          if (ns >= activePreset.steps.length) {
            queueMicrotask(() => runPresetComplete(activePreset, next));
          }
          return ns;
        });
      }
      return next;
    });
    setDraft(null);
  };

  const onImageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageSrc) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * natural.w;
    const y = ((e.clientY - rect.top) / rect.height) * natural.h;
    const pt: CanvasPoint = { x, y };

    if (tool === "pan") {
      setDrag({ type: "pan", startClient: { x: e.clientX, y: e.clientY } });
      return;
    }

    if (tool === "select") {
      for (const o of objects) {
        if (!o.visible) continue;
        if (o.type === "line" && o.p1 && o.p2) {
          const d1 = Math.hypot(pt.x - o.p1.x, pt.y - o.p1.y);
          const d2 = Math.hypot(pt.x - o.p2.x, pt.y - o.p2.y);
          if (d1 < 14 / zoom) {
            setDrag({ type: "handle", startClient: pt, startObj: { ...o }, handle: "p1" });
            return;
          }
          if (d2 < 14 / zoom) {
            setDrag({ type: "handle", startClient: pt, startObj: { ...o }, handle: "p2" });
            return;
          }
        }
      }
      return;
    }

    const effectiveTool =
      activePreset && activePreset.steps[presetStep]
        ? (activePreset.steps[presetStep].toolHint as Tool)
        : tool;

    if (effectiveTool === "point") {
      addObject({
        id: newId(),
        type: "point",
        name: `Point ${objects.filter((x) => x.type === "point").length + 1}`,
        color: COLORS.point,
        visible: true,
        selected: false,
        position: pt,
      });
      return;
    }

    if (effectiveTool === "line") {
      if (!draft || draft.kind !== "line") {
        setDraft({ kind: "line", p1: pt, ghost: pt });
        return;
      }
      if (draft.p1) {
        finishLine(draft.p1, pt);
      }
    }

    if (effectiveTool === "circle") {
      if (!draft || draft.kind !== "circle") {
        setDraft({ kind: "circle", center: pt, ghost: pt });
        return;
      }
      if (draft.center) {
        const r = Math.hypot(pt.x - draft.center.x, pt.y - draft.center.y);
        addObject({
          id: newId(),
          type: "circle",
          name: `Circle ${objects.filter((x) => x.type === "circle").length + 1}`,
          color: COLORS.circle,
          visible: true,
          selected: false,
          center: draft.center,
          radius: r,
        });
        setDraft(null);
      }
    }
  };

  const onImageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * natural.w;
    const y = ((e.clientY - rect.top) / rect.height) * natural.h;
    const pt: CanvasPoint = { x, y };

    if (drag?.type === "pan" && containerRef.current) {
      containerRef.current.scrollLeft -= e.movementX;
      containerRef.current.scrollTop -= e.movementY;
      return;
    }

    if (drag?.type === "handle" && drag.startObj && drag.handle) {
      const id = drag.startObj.id;
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id || o.type !== "line" || !o.p1 || !o.p2) return o;
          if (drag.handle === "p1") return { ...o, p1: pt };
          if (drag.handle === "p2") return { ...o, p2: pt };
          return o;
        }),
      );
      return;
    }

    if (draft?.kind === "line" && draft.p1) setDraft({ ...draft, ghost: pt });
    if (draft?.kind === "circle" && draft.center) setDraft({ ...draft, ghost: pt });
  };

  const onImageMouseUp = () => {
    setDrag(null);
  };

  const runCalibrate = () => {
    const sel = selectedLines;
    if (sel.length !== 1) {
      toast.error("Select exactly one line for calibration.");
      return;
    }
    const lenPx = lineLengthPx(sel[0]);
    if (lenPx == null || lenPx <= 0) {
      toast.error("Invalid line.");
      return;
    }
    const mmStr = window.prompt("Enter known length of this line in millimetres:", "10");
    if (mmStr == null) return;
    const mm = parseFloat(mmStr);
    if (!Number.isFinite(mm) || mm <= 0) {
      toast.error("Invalid number.");
      return;
    }
    setCalibration({
      isCalibrated: true,
      pxPerMm: lenPx / mm,
      referenceLabel: `${mm} mm reference`,
    });
    toast.success("Calibration applied");
    setCalibrationMode(false);
  };

  const addAngleMeasurement = () => {
    if (selectedLines.length !== 2) return;
    const [a, b] = selectedLines;
    const deg = angleBetweenLinesDeg(a, b);
    if (deg == null) return;
    setMeasurements((prev) => [
      ...prev,
      {
        id: newId(),
        type: "angle",
        label: "Angle",
        value: deg,
        unit: "degrees",
        status: "unchecked",
        objectsUsed: [a.id, b.id],
      },
    ]);
  };

  const addDistanceMeasurement = () => {
    if (selectedLines.length !== 1) return;
    const len = lineLengthPx(selectedLines[0]);
    if (len == null) return;
    const val = pxToMm(len);
    setMeasurements((prev) => [
      ...prev,
      {
        id: newId(),
        type: "distance",
        label: "Distance",
        value: val,
        unit: calibration.isCalibrated ? "mm" : "px",
        status: "unchecked",
        objectsUsed: [selectedLines[0].id],
      },
    ]);
  };

  const addRatioMeasurement = () => {
    if (selectedLines.length !== 2) return;
    const r = ratioOfLineLengths(selectedLines[0], selectedLines[1]);
    if (r == null) return;
    setMeasurements((prev) => [
      ...prev,
      {
        id: newId(),
        type: "ratio",
        label: "Ratio",
        value: r,
        unit: "ratio",
        status: "unchecked",
        objectsUsed: [selectedLines[0].id, selectedLines[1].id],
      },
    ]);
  };

  const addCobbMeasurement = () => {
    if (selectedLines.length !== 2) return;
    const deg = cobbAngleDeg(selectedLines[0], selectedLines[1]);
    if (deg == null) return;
    const st = scoliosisCobbStatus(deg);
    setMeasurements((prev) => [
      ...prev,
      {
        id: newId(),
        type: "cobb",
        label: "Cobb angle",
        value: deg,
        unit: "degrees",
        status: mapScoliosisToMeasurementStatus(st),
        normalRange: "<10° mild",
        objectsUsed: [selectedLines[0].id, selectedLines[1].id],
      },
    ]);
  };

  const handleSave = async () => {
    const summary = summaryText.trim() || buildSummary(specialty, measurements, calibration);
    setSaving(true);
    const { error } = await upsertXrayMeasurement(supabase, {
      encounterId,
      patientId,
      hospitalId,
      doctorId: doctorId ?? null,
      specialty,
      canvasObjects: objects,
      measurements,
      calibration,
      summaryText: summary,
      presetUsed: activePreset?.id ?? null,
      presetStep,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Radiological measurements saved");
    onSave?.(summary);
    onClose();
  };

  const toolButton = (t: Tool, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      key={t}
      type="button"
      onClick={() => {
        setTool(t);
        setDraft(null);
      }}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
        tool === t ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  const presetStepHint =
    activePreset && activePreset.steps[presetStep]
      ? `Step ${presetStep + 1}/${activePreset.steps.length}: ${activePreset.steps[presetStep].instruction}`
      : null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-800 bg-gradient-to-r from-blue-600 via-cyan-500 to-teal-600 px-4 py-3">
        <Ruler className="h-6 w-6 text-white" />
        <h1 className="text-lg font-bold">Radiological Measurements</h1>
        <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs font-semibold capitalize">{specialty}</span>
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => setImageSrc(String(r.result));
            r.readAsDataURL(f);
          }} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="bg-white/15 text-white hover:bg-white/25"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="mr-1 h-4 w-4" />
            Upload
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-white text-teal-800 hover:bg-gray-100"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save
          </Button>
          <button type="button" className="rounded-lg p-2 hover:bg-white/10" aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          ref={containerRef}
          className="relative min-w-0 flex-1 overflow-auto bg-black"
          style={{ cursor: tool === "pan" ? "grab" : tool === "line" || tool === "circle" || tool === "point" ? "crosshair" : "default" }}
        >
          {!imageSrc ? (
            <div className="flex h-full min-h-[320px] items-center justify-center text-gray-500">
              <button
                type="button"
                className="rounded-xl border border-dashed border-gray-700 px-6 py-8 text-sm hover:border-gray-500"
                onClick={() => fileRef.current?.click()}
              >
                Upload X-ray to begin
              </button>
            </div>
          ) : (
            <div
              className="relative inline-block"
              style={{ width: natural.w * zoom, height: natural.h * zoom }}
              onMouseDown={onImageMouseDown}
              onMouseMove={onImageMouseMove}
              onMouseUp={onImageMouseUp}
              onMouseLeave={onImageMouseUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageSrc}
                alt="X-ray"
                className="absolute left-0 top-0 block h-full w-full select-none"
                draggable={false}
                onLoad={(e) => {
                  const im = e.currentTarget;
                  setNatural({ w: im.naturalWidth, h: im.naturalHeight });
                }}
              />
              <svg
                className="absolute left-0 top-0"
                width={natural.w * zoom}
                height={natural.h * zoom}
                viewBox={`0 0 ${natural.w} ${natural.h}`}
                style={{ pointerEvents: "none" }}
              >
                {objects.map((o) => {
                  if (!o.visible) return null;
                  if (o.type === "line" && o.p1 && o.p2) {
                    return (
                      <line
                        key={o.id}
                        x1={o.p1.x}
                        y1={o.p1.y}
                        x2={o.p2.x}
                        y2={o.p2.y}
                        stroke={o.color}
                        strokeWidth={2 / zoom}
                      />
                    );
                  }
                  if (o.type === "circle" && o.center && o.radius != null) {
                    return (
                      <circle
                        key={o.id}
                        cx={o.center.x}
                        cy={o.center.y}
                        r={o.radius}
                        fill="none"
                        stroke={o.color}
                        strokeWidth={2 / zoom}
                      />
                    );
                  }
                  if (o.type === "point" && o.position) {
                    return (
                      <circle key={o.id} cx={o.position.x} cy={o.position.y} r={4 / zoom} fill={o.color} />
                    );
                  }
                  return null;
                })}
                {draft?.kind === "line" && draft.p1 && draft.ghost && (
                  <line
                    x1={draft.p1.x}
                    y1={draft.p1.y}
                    x2={draft.ghost.x}
                    y2={draft.ghost.y}
                    stroke="#94A3B8"
                    strokeWidth={1 / zoom}
                    strokeDasharray="6 4"
                  />
                )}
                {draft?.kind === "circle" && draft.center && draft.ghost && (
                  <circle
                    cx={draft.center.x}
                    cy={draft.center.y}
                    r={Math.hypot(draft.ghost.x - draft.center.x, draft.ghost.y - draft.center.y)}
                    fill="none"
                    stroke="#94A3B8"
                    strokeWidth={1 / zoom}
                    strokeDasharray="6 4"
                  />
                )}
              </svg>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-4 left-4 flex gap-2 rounded-lg bg-gray-900/90 p-1 text-xs">
            <span className="pointer-events-auto flex gap-1">
              <button
                type="button"
                className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
                onClick={() => setZoom((z) => Math.min(4, z * 1.2))}
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700"
                onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))}
              >
                <Minus className="h-3 w-3" />
              </button>
              <button type="button" className="rounded bg-gray-800 px-2 py-1 hover:bg-gray-700" onClick={() => setZoom(1)}>
                Reset
              </button>
            </span>
          </div>
        </div>

        <aside className="flex w-[min(100%,380px)] shrink-0 flex-col overflow-y-auto border-l border-gray-800 bg-gray-900">
          <section className="border-b border-gray-800 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Drawing tools</p>
            <div className="flex flex-wrap gap-1.5">
              {toolButton("none", "None", Ban)}
              {toolButton("select", "Select", MousePointer2)}
              {toolButton("pan", "Pan", Move)}
              {toolButton("point", "Point", CircleIcon)}
              {toolButton("line", "Line", Ruler)}
              {toolButton("circle", "Circle", CircleIcon)}
            </div>
          </section>

          <section className="border-b border-gray-800 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Presets</p>
            <select
              className="mb-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm"
              value={activePreset?.id ?? ""}
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                setActivePreset(p ?? null);
                setPresetStep(0);
              }}
            >
              <option value="">— None —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {activePreset ? (
              <div className="space-y-2 text-xs text-gray-300">
                <p className="text-gray-400">{activePreset.description}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                  <div
                    className="h-full bg-teal-500 transition-all"
                    style={{ width: `${((presetStep + 1) / activePreset.steps.length) * 100}%` }}
                  />
                </div>
                {presetStepHint ? <p className="text-teal-300/90">{presetStepHint}</p> : null}
              </div>
            ) : null}
          </section>

          <section className="border-b border-gray-800 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Calibration</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full border-gray-600 bg-gray-950 text-gray-200 hover:bg-gray-800"
              onClick={() => {
                setCalibrationMode(true);
                toast.message("Select one line, then click Calibrate again to enter length.");
              }}
            >
              Calibrate (px→mm)
            </Button>
            {calibrationMode ? (
              <Button type="button" size="sm" className="mt-2 w-full bg-teal-600 hover:bg-teal-500" onClick={runCalibrate}>
                Apply calibration from selected line
              </Button>
            ) : null}
            {calibration.isCalibrated ? (
              <p className="mt-2 text-xs text-emerald-400">✓ Calibrated · {calibration.referenceLabel}</p>
            ) : null}
          </section>

          <section className="border-b border-gray-800 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Objects on canvas</p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {objects.map((o) => (
                <li key={o.id} className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/80 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(o.id)}
                    onChange={() => toggleSelect(o.id)}
                    className="rounded border-gray-600"
                  />
                  <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <button
                    type="button"
                    className="text-gray-500 hover:text-white"
                    onClick={() => setObjects((prev) => prev.map((x) => (x.id === o.id ? { ...x, visible: !x.visible } : x)))}
                  >
                    {o.visible ? "hide" : "show"}
                  </button>
                  <button
                    type="button"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => {
                      setObjects((prev) => prev.filter((x) => x.id !== o.id));
                      setMeasurements((prev) => prev.filter((m) => !m.objectsUsed.includes(o.id)));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="border-b border-gray-800 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Calculate from selected</p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="bg-gray-800"
                disabled={selectedLines.length !== 2}
                onClick={addAngleMeasurement}
              >
                Angle
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="bg-gray-800"
                disabled={selectedLines.length !== 1}
                onClick={addDistanceMeasurement}
              >
                Distance
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="bg-gray-800"
                disabled={selectedLines.length !== 2}
                onClick={addRatioMeasurement}
              >
                Ratio
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="bg-gray-800"
                disabled={selectedLines.length !== 2}
                onClick={addCobbMeasurement}
              >
                Cobb
              </Button>
            </div>
          </section>

          <section className="border-b border-gray-800 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Measurements</p>
            <ul className="space-y-2">
              {measurements.map((m) => (
                <li key={m.id} className="rounded-lg border border-gray-800 bg-gray-950/80 p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    {editingLabelId === m.id ? (
                      <input
                        className="flex-1 rounded border border-gray-600 bg-black px-1 py-0.5 text-white"
                        value={editingLabelText}
                        onChange={(e) => setEditingLabelText(e.target.value)}
                        onBlur={() => {
                          setMeasurements((prev) =>
                            prev.map((x) => (x.id === m.id ? { ...x, label: editingLabelText.trim() || x.label } : x)),
                          );
                          setEditingLabelId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : (
                      <span className="font-medium text-gray-200">{m.label}</span>
                    )}
                    <button
                      type="button"
                      className="text-gray-500 hover:text-white"
                      onClick={() => {
                        setEditingLabelId(m.id);
                        setEditingLabelText(m.label);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="text-red-400"
                      onClick={() => setMeasurements((prev) => prev.filter((x) => x.id !== m.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 text-gray-300">
                    {m.unit === "ratio" ? m.value.toFixed(3) : m.value.toFixed(1)} {m.unit === "degrees" ? "°" : m.unit}
                  </p>
                  {m.normalRange ? <p className="text-[10px] text-gray-500">Ref: {m.normalRange}</p> : null}
                  <span className={cn("mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px]", statusBadgeClass(m.status))}>
                    {m.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Summary</p>
            <textarea
              className="min-h-[88px] w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-200"
              placeholder="Summary text (auto-filled on save if empty)"
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
