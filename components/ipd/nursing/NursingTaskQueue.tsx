"use client";

import { format } from "date-fns";
import { Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { NursingTaskCompleteModal, type NursingTaskForCompletion } from "./NursingTaskCompleteModal";

export type NursingShiftUi = "Morning" | "Afternoon" | "Night";

export type NursingTaskQueueProps = {
  hospitalId: string;
  nurseId: string;
  /** When both `shiftUi` and `onShiftUiChange` are set, shift is controlled by the parent. */
  shiftUi?: NursingShiftUi;
  onShiftUiChange?: (s: NursingShiftUi) => void;
  /** Local calendar date for task rows (yyyy-mm-dd). Defaults to today. */
  dateYmd?: string;
  /** Show Morning / Afternoon / Night pills inside this block. Set false when the parent already has a shift control. */
  embedShiftSelector?: boolean;
  className?: string;
};

type QueueTaskRow = {
  task_id: string;
  patient_name: string;
  bed_number: string;
  ward_name: string;
  task_name: string;
  task_category: string;
  priority: string;
  shift: string;
  due_time: string | null;
  status: string;
  instructions: string | null;
  source: string;
  admission_id: string;
  hospital_id: string;
};

type WardPatientOption = {
  admission_id: string;
  patient_id: string;
  patient_name: string;
  bed_number: string;
  ward_name: string;
};

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Morning 07:00–15:00 · Afternoon 15:00–23:00 · Night 23:00–07:00 (local clock). */
export function defaultNursingShiftFromClockQueue(): NursingShiftUi {
  const h = new Date().getHours();
  if (h >= 7 && h < 15) return "Morning";
  if (h >= 15 && h < 23) return "Afternoon";
  return "Night";
}

/** DB / RPC shift tokens (check constraints) — keep in sync with `<option value>` in forms. */
export type NursingShiftDb = "morning" | "afternoon" | "night";

/** Matches `nursing_tasks_priority_chk` — lowercase option values only. */
export type NursingTaskPriorityDb = "stat" | "urgent" | "high" | "routine";

/** Matches `nursing_tasks_category_chk` — lowercase snake_case option values only. */
export type NursingTaskCategoryDb =
  | "vascular_check"
  | "neuro_check"
  | "wound_care"
  | "drain_care"
  | "traction_check"
  | "cast_check"
  | "vitals"
  | "medication"
  | "iv_care"
  | "mobilisation"
  | "positioning"
  | "vte"
  | "fall_risk"
  | "pressure_sore"
  | "other";

/** Shared by ward queue + IPD checklist “add task” so `task_category` always matches DB check. */
export const MANUAL_TASK_CATEGORY_OPTIONS: { value: NursingTaskCategoryDb; label: string }[] = [
  { value: "vte", label: "VTE" },
  { value: "fall_risk", label: "Fall Risk" },
  { value: "pressure_sore", label: "Pressure" },
  { value: "wound_care", label: "Wound Care" },
  { value: "medication", label: "Medication" },
  { value: "vitals", label: "Vitals" },
  { value: "iv_care", label: "IV Care" },
  { value: "drain_care", label: "Drain Care" },
  { value: "vascular_check", label: "Vascular Check" },
  { value: "neuro_check", label: "Neuro Check" },
  { value: "traction_check", label: "Traction Check" },
  { value: "cast_check", label: "Cast Check" },
  { value: "mobilisation", label: "Mobilisation" },
  { value: "positioning", label: "Positioning" },
  { value: "other", label: "Other" },
];

function shiftUiToRpcKey(s: NursingShiftUi): NursingShiftDb {
  return s.toLowerCase() as NursingShiftDb;
}

function shiftLabelWithWindow(s: NursingShiftUi): string {
  if (s === "Morning") return "Morning (07:00–15:00)";
  if (s === "Afternoon") return "Afternoon (15:00–23:00)";
  return "Night (23:00–07:00)";
}

function categoryBadgeClass(cat: string): string {
  const c = cat.trim().toLowerCase();
  if (c === "vte") return "bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200";
  if (c === "fall_risk") return "bg-amber-100 text-amber-950 ring-1 ring-amber-200";
  if (c === "pressure_sore") return "bg-rose-100 text-rose-900 ring-1 ring-rose-200";
  return "bg-slate-100 text-slate-800 ring-1 ring-slate-200";
}

function categoryLabel(cat: string): string {
  const c = cat.trim().toLowerCase();
  if (!c) return "—";
  if (c === "vte") return "VTE";
  const fromOpts = MANUAL_TASK_CATEGORY_OPTIONS.find((o) => o.value === c);
  if (fromOpts) return fromOpts.label;
  return c
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function priorityMeta(priority: string): {
  label: string;
  dotClass: string;
  pulse: boolean;
} {
  const p = priority.trim().toUpperCase();
  if (p === "STAT")
    return { label: "STAT", dotClass: "bg-red-600", pulse: true };
  if (p === "URGENT")
    return { label: "Urgent", dotClass: "bg-amber-500", pulse: false };
  if (p === "HIGH")
    return { label: "High", dotClass: "bg-yellow-400", pulse: false };
  return { label: "Routine", dotClass: "bg-slate-400", pulse: false };
}

function sourcePillClass(source: string): string {
  const s = source.trim();
  if (s === "Doctor Order")
    return "bg-blue-50 text-blue-900 ring-1 ring-blue-200/80";
  if (s === "Care Plan")
    return "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80";
  return "bg-gray-100 text-gray-800 ring-1 ring-gray-200/80";
}

/**
 * RPC may return `due_time` as timestamptz (ISO) or Postgres `time` as "HH:MM:SS" only.
 * JS `new Date("23:00:00")` is invalid — anchor time-only values to the queue list date.
 */
function parseTaskDueInstant(dueTime: string | null, queueDateYmd: string): Date | null {
  if (!dueTime?.trim()) return null;
  const raw = dueTime.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(queueDateYmd)) return null;

  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) return direct;

  const timeOnly =
    /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(raw) &&
    !raw.includes("T") &&
    !/^\d{4}-\d{2}-\d{2}/.test(raw);
  if (!timeOnly) return null;

  const normalized = /^\d{1,2}:\d{2}$/.test(raw) ? `${raw}:00` : raw;
  const combined = new Date(`${queueDateYmd}T${normalized}`);
  return Number.isFinite(combined.getTime()) ? combined : null;
}

function isOverdue(row: QueueTaskRow, queueDateYmd: string): boolean {
  if (row.status !== "pending" || !row.due_time) return false;
  const t = parseTaskDueInstant(row.due_time, queueDateYmd)?.getTime();
  return t != null && t < Date.now();
}

export function NursingTaskQueue({
  hospitalId,
  nurseId,
  shiftUi: shiftUiProp,
  onShiftUiChange,
  dateYmd: dateYmdProp,
  embedShiftSelector = true,
  className,
}: NursingTaskQueueProps) {
  const [internalShift, setInternalShift] = useState<NursingShiftUi>(
    () => defaultNursingShiftFromClockQueue(),
  );
  const shiftUi = shiftUiProp ?? internalShift;
  const setShiftUi = onShiftUiChange ?? setInternalShift;

  const dateYmd = dateYmdProp ?? todayYmdLocal();

  const [tasks, setTasks] = useState<QueueTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState<NursingTaskForCompletion | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());

  const [fabOpen, setFabOpen] = useState(false);
  const [wardPatients, setWardPatients] = useState<WardPatientOption[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [manualTaskName, setManualTaskName] = useState("");
  const [manualCategory, setManualCategory] = useState<NursingTaskCategoryDb>("vte");
  const [manualPriority, setManualPriority] = useState<NursingTaskPriorityDb>("routine");
  const [manualShift, setManualShift] = useState<NursingShiftDb>(() =>
    shiftUiToRpcKey(defaultNursingShiftFromClockQueue()),
  );
  const [manualAdmissionId, setManualAdmissionId] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    const { data, error } = await supabase.rpc("get_nursing_shift_tasks", {
      p_shift: shiftUiToRpcKey(shiftUi),
      p_date: dateYmd,
    });
    setLoading(false);
    if (error) {
      setLoadErr(error.message);
      setTasks([]);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    const mapped: QueueTaskRow[] = rows.map((raw: Record<string, unknown>) => ({
      task_id: String(raw.task_id ?? ""),
      patient_name: String(raw.patient_name ?? ""),
      bed_number: String(raw.bed_number ?? "—"),
      ward_name: String(raw.ward_name ?? ""),
      task_name: String(raw.task_name ?? ""),
      task_category: String(raw.task_category ?? "other"),
      priority: String(raw.priority ?? "routine"),
      shift: String(raw.shift ?? ""),
      due_time: raw.due_time != null ? String(raw.due_time) : null,
      status: String(raw.status ?? "pending"),
      instructions:
        raw.instructions != null ? String(raw.instructions) : null,
      source: String(raw.source ?? "Manual"),
      admission_id: String(raw.admission_id ?? ""),
      hospital_id: String(raw.hospital_id ?? hospitalId),
    }));
    setTasks(mapped.filter((r) => r.task_id));
  }, [dateYmd, hospitalId, shiftUi]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel(`nursing-task-queue-${hospitalId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "nursing_tasks",
          filter: `hospital_id=eq.${hospitalId}`,
        },
        () => {
          void loadTasks();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hospitalId, loadTasks]);

  const loadWardPatients = useCallback(async () => {
    setLoadingPatients(true);
    const { data, error } = await supabase.rpc("get_nurse_ward_patients", {
      p_nurse_id: nurseId,
      p_hospital_id: hospitalId,
      p_shift: shiftUi,
      p_date: dateYmd,
    });
    setLoadingPatients(false);
    if (error) {
      toast.error(error.message);
      setWardPatients([]);
      return;
    }
    const arr = Array.isArray(data) ? data : [];
    const opts: WardPatientOption[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const aid = String(o.admission_id ?? "");
      if (!aid) continue;
      opts.push({
        admission_id: aid,
        patient_id: String(o.patient_id ?? ""),
        patient_name: String(o.patient_name ?? o.full_name ?? "Patient"),
        bed_number: String(o.bed_number ?? o.bed ?? "—"),
        ward_name: String(o.ward_name ?? o.ward ?? ""),
      });
    }
    setWardPatients(opts);
    setManualAdmissionId((prev) => {
      if (opts.some((p) => p.admission_id === prev)) return prev;
      return opts[0]?.admission_id ?? "";
    });
  }, [dateYmd, hospitalId, nurseId, shiftUi]);

  useEffect(() => {
    if (fabOpen) {
      setManualShift(shiftUiToRpcKey(shiftUi));
      void loadWardPatients();
    }
  }, [fabOpen, loadWardPatients, shiftUi]);

  const grouped = useMemo(() => {
    const map = new Map<string, QueueTaskRow[]>();
    for (const t of tasks) {
      const key = t.admission_id || `${t.patient_name}|${t.bed_number}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].sort(([, la], [, lb]) => {
      const a = la[0];
      const b = lb[0];
      const na = (a?.patient_name ?? "").localeCompare(b?.patient_name ?? "");
      if (na !== 0) return na;
      return (a?.bed_number ?? "").localeCompare(b?.bed_number ?? "");
    });
  }, [tasks]);


  const submitManual = async () => {
    const name = manualTaskName.trim();
    if (!name) {
      toast.error("Task name is required");
      return;
    }
    if (!manualAdmissionId) {
      toast.error("Select a patient");
      return;
    }
    const pick = wardPatients.find((p) => p.admission_id === manualAdmissionId);
    setSavingManual(true);
    const shiftValue = manualShift.toLowerCase();
    const { error } = await supabase.from("nursing_tasks").insert({
      hospital_id: hospitalId,
      admission_id: manualAdmissionId,
      patient_id: pick?.patient_id || null,
      task_name: name,
      task_category: manualCategory,
      priority: manualPriority,
      shift: shiftValue,
      scheduled_shift: shiftValue,
      scheduled_date: dateYmd,
      status: "pending",
      instructions: null,
      source_kind: "manual",
      created_by: nurseId,
    });
    setSavingManual(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Task added");
    setFabOpen(false);
    setManualTaskName("");
    void loadTasks();
  };

  return (
    <section className={cn("relative", className)}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">
            Task queue
          </h2>
          <p className="text-xs text-slate-500">
            {format(new Date(`${dateYmd}T12:00:00`), "EEE d MMM yyyy")}
            {!embedShiftSelector ? (
              <>
                {" · "}
                {shiftLabelWithWindow(shiftUi)}
              </>
            ) : null}
          </p>
        </div>
        {embedShiftSelector ? (
          <div className="flex flex-wrap gap-2">
            {(["Morning", "Afternoon", "Night"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setShiftUi(s)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                  shiftUi === s
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
                title={shiftLabelWithWindow(s)}
              >
                {shiftLabelWithWindow(s)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loadErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadErr}
        </div>
      ) : null}

      {loading && !tasks.length ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl bg-slate-200/80"
            />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-600">
          No pending tasks for this shift.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([groupKey, list]) => {
            const head = list[0];
            return (
              <div key={groupKey}>
                <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-slate-200 pb-1">
                  <span className="font-semibold text-slate-900">
                    {head.patient_name}
                  </span>
                  <span className="text-xs text-slate-500">
                    Bed {head.bed_number}
                    {head.ward_name ? ` · ${head.ward_name}` : ""}
                  </span>
                </div>
                <ul className="space-y-2">
                  {list.map((row) => {
                    const overdue = isOverdue(row, dateYmd);
                    const pri = priorityMeta(row.priority);
                    const removing = removingIds.has(row.task_id);
                    return (
                      <li
                        key={row.task_id}
                        className={cn(
                          "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 ease-out",
                          overdue ? "border-l-4 border-l-red-600 pl-0" : "border-l-4 border-l-transparent",
                          removing && "pointer-events-none scale-95 opacity-0",
                        )}
                        style={
                          {
                            transitionProperty: "opacity, transform",
                          } as CSSProperties
                        }
                      >
                        <button
                          type="button"
                          className="flex w-full flex-col gap-2 px-3 py-3 text-left sm:flex-row sm:items-start sm:justify-between"
                          onClick={() =>
                            setCompletingTask({
                              id: row.task_id,
                              task_name: row.task_name,
                              task_category: row.task_category,
                              instructions: row.instructions ?? null,
                            })
                          }
                        >
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-900">
                                {row.task_name}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                                  categoryBadgeClass(row.task_category),
                                )}
                              >
                                {categoryLabel(row.task_category)}
                              </span>
                              <span
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                                title={row.priority}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    pri.dotClass,
                                    pri.pulse && "animate-pulse",
                                  )}
                                />
                                <span className="text-slate-600">{pri.label}</span>
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                                  sourcePillClass(row.source),
                                )}
                              >
                                {row.source}
                              </span>
                            </div>
                            {row.due_time ? (
                              <p className="text-[11px] text-slate-500">
                                Due{" "}
                                {(() => {
                                  const dueAt = parseTaskDueInstant(
                                    row.due_time,
                                    dateYmd,
                                  );
                                  return dueAt
                                    ? format(dueAt, "dd MMM, HH:mm")
                                    : row.due_time;
                                })()}
                                {overdue ? (
                                  <span className="ml-1 font-semibold text-red-600">
                                    · Overdue
                                  </span>
                                ) : null}
                              </p>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        aria-label="Add manual task"
        onClick={() => setFabOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg",
          "transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        )}
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} />
      </button>

      {fabOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal
          onClick={() => setFabOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900">
              Add manual task
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Creates a task for the selected admission. Shift and date match your queue context unless changed below.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <Label className="text-xs">Patient</Label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={manualAdmissionId}
                  onChange={(e) => setManualAdmissionId(e.target.value)}
                  disabled={loadingPatients}
                >
                  {wardPatients.length === 0 ? (
                    <option value="">
                      {loadingPatients ? "Loading…" : "No ward patients"}
                    </option>
                  ) : (
                    wardPatients.map((p) => (
                      <option key={p.admission_id} value={p.admission_id}>
                        {p.patient_name} · Bed {p.bed_number}
                        {p.ward_name ? ` · ${p.ward_name}` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <Label className="text-xs">Task name</Label>
                <Input
                  value={manualTaskName}
                  onChange={(e) => setManualTaskName(e.target.value)}
                  className="mt-1"
                  placeholder="e.g. Turn patient"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Category</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                    value={manualCategory}
                    onChange={(e) =>
                      setManualCategory(e.target.value as NursingTaskCategoryDb)
                    }
                  >
                    {MANUAL_TASK_CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                    value={manualPriority}
                    onChange={(e) =>
                      setManualPriority(e.target.value as NursingTaskPriorityDb)
                    }
                  >
                    <option value="stat">STAT</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="routine">Routine</option>
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Shift</Label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={manualShift}
                  onChange={(e) =>
                    setManualShift(e.target.value as NursingShiftDb)
                  }
                >
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="night">Night</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFabOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submitManual()}
                disabled={savingManual}
              >
                {savingManual ? "Saving…" : "Save task"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <NursingTaskCompleteModal
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={() => {
          setTasks((prev) =>
            completingTask
              ? prev.filter((x) => x.task_id !== completingTask.id)
              : prev,
          );
          void loadTasks();
        }}
      />
    </section>
  );
}

export default NursingTaskQueue;
