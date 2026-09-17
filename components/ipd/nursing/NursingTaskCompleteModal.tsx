"use client";

import {
  Activity,
  Bandage,
  Bone,
  Brain,
  ClipboardList,
  Droplets,
  HeartPulse,
  Move,
  PersonStanding,
  Pill,
  StretchHorizontal,
  Syringe,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../../lib/supabase";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";

export type NursingTaskForCompletion = {
  id: string;
  task_name: string;
  task_category: string;
  instructions: string | null;
};

const LIMB_KEYS = ["left_hand", "right_hand", "left_foot", "right_foot"] as const;
type LimbKey = (typeof LIMB_KEYS)[number];
type PulseState = "present" | "weakened" | "absent";

const CATEGORY_META: Record<string, { emoji: string; title: string; lucide: ReactNode }> = {
  vascular_check: { emoji: "🩸", title: "Vascular", lucide: <HeartPulse className="h-5 w-5" /> },
  neuro_check: { emoji: "🧠", title: "Neuro", lucide: <Brain className="h-5 w-5" /> },
  wound_care: { emoji: "🩹", title: "Wound Care", lucide: <Bandage className="h-5 w-5" /> },
  drain_care: { emoji: "💧", title: "Drain", lucide: <Droplets className="h-5 w-5" /> },
  traction_check: { emoji: "⚙️", title: "Traction", lucide: <StretchHorizontal className="h-5 w-5" /> },
  cast_check: { emoji: "🦴", title: "Cast", lucide: <Bone className="h-5 w-5" /> },
  vitals: { emoji: "📊", title: "Vitals", lucide: <Activity className="h-5 w-5" /> },
  iv_care: { emoji: "💉", title: "IV Care", lucide: <Syringe className="h-5 w-5" /> },
  medication: { emoji: "💊", title: "Medication", lucide: <Pill className="h-5 w-5" /> },
  mobilisation: { emoji: "🚶", title: "Mobilisation", lucide: <PersonStanding className="h-5 w-5" /> },
  positioning: { emoji: "🔄", title: "Positioning", lucide: <Move className="h-5 w-5" /> },
  other: { emoji: "📋", title: "Other", lucide: <ClipboardList className="h-5 w-5" /> },
};

function visibleLimbsFromTaskName(name: string): Record<LimbKey, boolean> {
  const n = name.toLowerCase();
  const has = (a: string) => n.includes(a) || n.includes(a.replace(" ", ""));
  if (has("left hand") || has("l hand") || has("left upper")) {
    return { left_hand: true, right_hand: false, left_foot: false, right_foot: false };
  }
  if (has("right hand") || has("r hand") || has("right upper")) {
    return { left_hand: false, right_hand: true, left_foot: false, right_foot: false };
  }
  if (has("left foot") || has("left lower") || has("l foot")) {
    return { left_hand: false, right_hand: false, left_foot: true, right_foot: false };
  }
  if (has("right foot") || has("right lower") || has("r foot")) {
    return { left_hand: false, right_hand: false, left_foot: false, right_foot: true };
  }
  return { left_hand: true, right_hand: true, left_foot: true, right_foot: true };
}

function limbLabel(k: LimbKey): string {
  switch (k) {
    case "left_hand": return "Left hand";
    case "right_hand": return "Right hand";
    case "left_foot": return "Left foot";
    case "right_foot": return "Right foot";
    default: return k;
  }
}

function guessNeuroLimb(taskName: string): string {
  const n = taskName.toLowerCase();
  if (n.includes("left")) return "Left";
  if (n.includes("right")) return "Right";
  if (n.includes("bilateral")) return "Bilateral";
  return "";
}

export function NursingTaskCompleteModal({
  task,
  onClose,
  onCompleted,
}: {
  task: NursingTaskForCompletion | null;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [sheetSkip, setSheetSkip] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [obsNotes, setObsNotes] = useState("");
  const [pulseByLimb, setPulseByLimb] = useState<Record<LimbKey, PulseState>>({
    left_hand: "present",
    right_hand: "present",
    left_foot: "present",
    right_foot: "present",
  });
  const [capillary, setCapillary] = useState<"normal" | "delayed">("normal");
  const [sensation, setSensation] = useState<"normal" | "reduced" | "absent">("normal");
  const [motorMrc, setMotorMrc] = useState("5");
  const [neuroLimb, setNeuroLimb] = useState("");
  const [drainMl, setDrainMl] = useState("");
  const [drainColour, setDrainColour] = useState<"clear" | "straw" | "haemoserous" | "haemorrhagic">("clear");
  const [woundAppearance, setWoundAppearance] = useState<"clean" | "minimal" | "soaked">("clean");

  useEffect(() => {
    if (!task) return;
    setSheetSkip(false);
    setSkipReason("");
    setObsNotes("");
    setCapillary("normal");
    setSensation("normal");
    setMotorMrc("5");
    setNeuroLimb(guessNeuroLimb(task.task_name));
    setDrainMl("");
    setDrainColour("clear");
    setWoundAppearance("clean");
    const vis = visibleLimbsFromTaskName(task.task_name);
    setPulseByLimb({
      left_hand: vis.left_hand ? "present" : "present",
      right_hand: vis.right_hand ? "present" : "present",
      left_foot: vis.left_foot ? "present" : "present",
      right_foot: vis.right_foot ? "present" : "present",
    });
  }, [task]);

  if (!task) return null;

  const visLimbs = visibleLimbsFromTaskName(task.task_name);

  const buildOutcomeJson = (): Record<string, unknown> => {
    const cat = task.task_category;
    if (cat === "vascular_check") {
      const limbs: Record<string, string> = {};
      for (const k of LIMB_KEYS) {
        if (visLimbs[k]) limbs[k] = pulseByLimb[k];
      }
      return { distal_pulses: limbs, capillary_refill: capillary };
    }
    if (cat === "neuro_check") {
      return {
        sensation,
        motor_mrc: Number.parseInt(motorMrc, 10),
        limb: neuroLimb.trim() || null,
      };
    }
    if (cat === "wound_care" || cat === "drain_care") {
      const ml = drainMl.trim() === "" ? null : Number.parseFloat(drainMl);
      return {
        drain_output_ml: ml != null && Number.isFinite(ml) ? ml : null,
        drain_colour: drainColour,
        wound_appearance: woundAppearance,
      };
    }
    return { observation_notes: obsNotes.trim() || null };
  };

  const notesForRpc = (): string => obsNotes.trim();

  const handleMarkComplete = async () => {
    const { error } = await supabase.rpc("complete_nursing_task", {
      p_task_id: task.id,
      p_notes: notesForRpc() || null,
      p_outcome_json: buildOutcomeJson(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Task completed");
    onCompleted();
    onClose();
  };

  const handleSkipSubmit = async () => {
    const reason = skipReason.trim();
    if (!reason) {
      toast.error("Enter a reason before skipping.");
      return;
    }
    const { error } = await supabase.rpc("skip_nursing_task", {
      p_task_id: task.id,
      p_skip_reason: reason,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Task skipped");
    onCompleted();
    onClose();
  };

  const catMeta = CATEGORY_META[task.task_category] ?? CATEGORY_META.other!;
  const isVascular = task.task_category === "vascular_check";
  const isNeuro = task.task_category === "neuro_check";
  const isWoundOrDrain = task.task_category === "wound_care" || task.task_category === "drain_care";
  const isGeneric = !isVascular && !isNeuro && !isWoundOrDrain;

  return (
    <div className="fixed inset-0 z-[140] flex flex-col justify-end bg-black/50 p-0 sm:p-4">
      {/* backdrop */}
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative mx-auto w-full max-h-[88vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
        role="dialog"
        aria-modal
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <div className="flex items-center gap-2 pr-6">
            {catMeta.lucide}
            <h2 className="text-base font-bold text-gray-900">{task.task_name}</h2>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {sheetSkip ? (
            <>
              <Label>Reason for skip</Label>
              <Textarea
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
                rows={4}
                placeholder="Required"
                className="mt-1"
              />
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setSheetSkip(false)}>
                  Back
                </Button>
                <Button
                  type="button"
                  className="flex-1 bg-blue-600 text-white"
                  disabled={!skipReason.trim()}
                  onClick={() => void handleSkipSubmit()}
                >
                  Submit skip
                </Button>
              </div>
            </>
          ) : (
            <>
              {task.instructions ? (
                <p className="text-sm text-gray-500">{task.instructions}</p>
              ) : null}

              {/* Vascular check */}
              {isVascular ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-gray-900">Distal pulses</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {LIMB_KEYS.filter((k) => visLimbs[k]).map((k) => (
                      <div key={k} className="rounded-lg border border-gray-200 p-3">
                        <p className="mb-2 text-xs font-medium">{limbLabel(k)}</p>
                        <div className="flex flex-wrap gap-1">
                          {(
                            [
                              ["present", "✅ Present"],
                              ["weakened", "⚠️ Weakened"],
                              ["absent", "❌ Absent"],
                            ] as const
                          ).map(([val, lab]) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setPulseByLimb((m) => ({ ...m, [k]: val }))}
                              className={cn(
                                "rounded-md border px-2 py-1 text-[11px] font-medium",
                                pulseByLimb[k] === val
                                  ? "border-blue-600 bg-blue-600/10 text-blue-700"
                                  : "border-gray-200 bg-white",
                              )}
                            >
                              {lab}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Capillary refill</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="cap"
                          checked={capillary === "normal"}
                          onChange={() => setCapillary("normal")}
                        />
                        &lt;2 sec (Normal)
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="cap"
                          checked={capillary === "delayed"}
                          onChange={() => setCapillary("delayed")}
                        />
                        &gt;2 sec (Delayed)
                      </label>
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={obsNotes} onChange={(e) => setObsNotes(e.target.value)} rows={2} className="mt-1" />
                  </div>
                </div>
              ) : null}

              {/* Neuro check */}
              {isNeuro ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold">Sensation</p>
                    <div className="mt-2 inline-flex rounded-lg border border-gray-200 p-0.5">
                      {(["normal", "reduced", "absent"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setSensation(v)}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-xs font-semibold capitalize",
                            sensation === v ? "bg-blue-600 text-white" : "text-gray-500",
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Motor power (MRC)</Label>
                    <select
                      value={motorMrc}
                      onChange={(e) => setMotorMrc(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      {[0, 1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={String(n)}>
                          {n} — {n === 0 ? "No movement" : n === 5 ? "Normal" : `Grade ${n}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Limb</Label>
                    <Input
                      value={neuroLimb}
                      onChange={(e) => setNeuroLimb(e.target.value)}
                      placeholder="e.g. Left lower limb"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={obsNotes} onChange={(e) => setObsNotes(e.target.value)} rows={2} className="mt-1" />
                  </div>
                </div>
              ) : null}

              {/* Wound / drain */}
              {isWoundOrDrain ? (
                <div className="space-y-3">
                  <div>
                    <Label>Drain output (mL)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={drainMl}
                      onChange={(e) => setDrainMl(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Drain colour</Label>
                    <select
                      value={drainColour}
                      onChange={(e) => setDrainColour(e.target.value as typeof drainColour)}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="clear">Clear</option>
                      <option value="straw">Straw</option>
                      <option value="haemoserous">Haemoserous</option>
                      <option value="haemorrhagic">Haemorrhagic</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Wound appearance</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ["clean", "Clean"],
                          ["minimal", "Minimal discharge"],
                          ["soaked", "Soaked"],
                        ] as const
                      ).map(([val, lab]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setWoundAppearance(val)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium",
                            woundAppearance === val
                              ? "border-blue-600 bg-blue-600/10 text-blue-700"
                              : "border-gray-200",
                          )}
                        >
                          {lab}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea value={obsNotes} onChange={(e) => setObsNotes(e.target.value)} rows={3} className="mt-1" />
                  </div>
                </div>
              ) : null}

              {/* Generic */}
              {isGeneric ? (
                <div>
                  <Label>Observation notes</Label>
                  <Textarea
                    value={obsNotes}
                    onChange={(e) => setObsNotes(e.target.value)}
                    rows={5}
                    className="mt-1"
                    placeholder="Document observations…"
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="order-2 sm:order-1" onClick={() => setSheetSkip(true)}>
                  Skip
                </Button>
                <Button
                  type="button"
                  className="order-1 bg-emerald-600 text-white hover:bg-emerald-500 sm:order-2"
                  onClick={() => void handleMarkComplete()}
                >
                  Mark complete
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
