"use client";

import { formatDistanceToNow } from "date-fns";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Bandage,
  Bone,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
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
import { supabase } from "@/lib/supabase";
import { MANUAL_TASK_CATEGORY_OPTIONS, type NursingTaskCategoryDb } from "./nursing/NursingTaskQueue";
import { NursingTaskCompleteModal, type NursingTaskForCompletion } from "./nursing/NursingTaskCompleteModal";
import TimeWheelPicker, { time12hTo24hForDb, time24hTo12hDisplay } from "@/components/TimeWheelPicker";
import { useToast } from "@/components/ui/toast-provider";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";

export type ShiftKey = "morning" | "afternoon" | "night";

export interface NursingShiftChecklistProps {
  admissionId: string;
  patientName: string;
  /** Optional — used for manual task insert when available */
  patientId?: string;
}

type TaskRow = {
  id: string;
  admission_id: string;
  hospital_id: string;
  task_name: string;
  task_category: string;
  priority: string;
  instructions: string | null;
  source_order_text: string | null;
  scheduled_shift: string;
  scheduled_date: string;
  due_date: string | null;
  due_time: string | null;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  completed_notes: string | null;
  outcome_json: Record<string, unknown> | null;
  skip_reason: string | null;
  skipped_at: string | null;
  skipped_by: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_by_name?: string | null;
  skipped_by_name?: string | null;
};

/** Fixed display order (matches product spec). */
const CATEGORY_ORDER = [
  "vascular_check",
  "neuro_check",
  "wound_care",
  "drain_care",
  "traction_check",
  "cast_check",
  "vitals",
  "iv_care",
  "medication",
  "mobilisation",
  "positioning",
  "other",
] as const;

const CATEGORY_META: Record<
  string,
  { emoji: string; title: string; lucide: ReactNode }
> = {
  vascular_check: { emoji: "🩸", title: "Vascular", lucide: <HeartPulse className="h-4 w-4" /> },
  neuro_check: { emoji: "🧠", title: "Neuro", lucide: <Brain className="h-4 w-4" /> },
  wound_care: { emoji: "🩹", title: "Wound Care", lucide: <Bandage className="h-4 w-4" /> },
  drain_care: { emoji: "💧", title: "Drain", lucide: <Droplets className="h-4 w-4" /> },
  traction_check: { emoji: "⚙️", title: "Traction", lucide: <StretchHorizontal className="h-4 w-4" /> },
  cast_check: { emoji: "🦴", title: "Cast", lucide: <Bone className="h-4 w-4" /> },
  vitals: { emoji: "📊", title: "Vitals", lucide: <Activity className="h-4 w-4" /> },
  iv_care: { emoji: "💉", title: "IV Care", lucide: <Syringe className="h-4 w-4" /> },
  medication: { emoji: "💊", title: "Medication", lucide: <Pill className="h-4 w-4" /> },
  mobilisation: { emoji: "🚶", title: "Mobilisation", lucide: <PersonStanding className="h-4 w-4" /> },
  positioning: { emoji: "🔄", title: "Positioning", lucide: <Move className="h-4 w-4" /> },
  other: { emoji: "📋", title: "Other", lucide: <ClipboardList className="h-4 w-4" /> },
};

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function localTodayYmd(): string {
  const d = new Date();
  return d.toISOString().split("T")[0]!;
}

/** Calendar date in Asia/Kolkata (yyyy-MM-dd). */
function todayYmdIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizeTimeForIsoDateParse(t: string): string {
  const s = t.trim();
  const parts = s.split(":");
  if (parts.length >= 2) {
    const h = parts[0]!.padStart(2, "0");
    const m = parts[1]!.slice(0, 2).padStart(2, "0");
    const sec = parts.length >= 3 ? parts[2]!.slice(0, 2).padStart(2, "0") : "00";
    return `${h}:${m}:${sec}`;
  }
  return s;
}

function taskDueSortKeyMs(t: TaskRow): number {
  if (t.due_time == null || String(t.due_time).trim() === "") return Infinity;
  const d = (t.due_date ?? t.scheduled_date)?.trim();
  if (!d) return Infinity;
  const timePart = normalizeTimeForIsoDateParse(String(t.due_time));
  const ms = Date.parse(`${d}T${timePart}`);
  return Number.isFinite(ms) ? ms : Infinity;
}

export function detectShiftFromLocalClock(): ShiftKey {
  const h = new Date().getHours();
  if (h >= 7 && h <= 13) return "morning";
  if (h >= 14 && h <= 20) return "afternoon";
  return "night";
}

function shiftLabelCapitalized(key: ShiftKey): string {
  if (key === "morning") return "Morning";
  if (key === "afternoon") return "Afternoon";
  return "Night";
}

function shiftBadgeClasses(key: ShiftKey): string {
  switch (key) {
    case "morning":
      return "bg-amber-100 text-amber-950 ring-1 ring-amber-300";
    case "afternoon":
      return "bg-blue-100 text-blue-950 ring-1 ring-blue-300/80";
    case "night":
      return "bg-indigo-100 text-indigo-950 ring-1 ring-indigo-300/80";
    default:
      return "bg-gray-100 text-gray-900 ring-1 ring-gray-200";
  }
}

function categoryAccentBorder(cat: string): string {
  switch (cat) {
    case "vascular_check":
      return "border-l-blue-500";
    case "neuro_check":
      return "border-l-purple-500";
    case "wound_care":
      return "border-l-rose-500";
    case "drain_care":
      return "border-l-cyan-500";
    default:
      return "border-l-gray-300";
  }
}

function parseTasks(data: unknown): TaskRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: s(r.id),
      admission_id: s(r.admission_id),
      hospital_id: s(r.hospital_id),
      task_name: s(r.task_name),
      task_category: s(r.task_category),
      priority: s(r.priority) || "routine",
      instructions: r.instructions != null ? String(r.instructions) : null,
      source_order_text: r.source_order_text != null ? String(r.source_order_text) : null,
      scheduled_shift: s(r.scheduled_shift),
      scheduled_date: s(r.scheduled_date),
      due_date: r.due_date != null ? String(r.due_date).slice(0, 10) : null,
      due_time: r.due_time != null ? String(r.due_time) : null,
      status: s(r.status) || "pending",
      completed_at: r.completed_at != null ? String(r.completed_at) : null,
      completed_by: r.completed_by != null ? String(r.completed_by) : null,
      completed_notes: r.completed_notes != null ? String(r.completed_notes) : null,
      outcome_json:
        r.outcome_json != null && typeof r.outcome_json === "object" && !Array.isArray(r.outcome_json)
          ? (r.outcome_json as Record<string, unknown>)
          : {},
      skip_reason: r.skip_reason != null ? String(r.skip_reason) : null,
      skipped_at: r.skipped_at != null ? String(r.skipped_at) : null,
      skipped_by: r.skipped_by != null ? String(r.skipped_by) : null,
      created_by: r.created_by != null ? String(r.created_by) : null,
      created_at: r.created_at != null ? String(r.created_at) : null,
      updated_at: r.updated_at != null ? String(r.updated_at) : null,
      completed_by_name: r.completed_by_name != null ? String(r.completed_by_name) : null,
      skipped_by_name: r.skipped_by_name != null ? String(r.skipped_by_name) : null,
    };
  });
}

function formatDueLabel(t: TaskRow): string | null {
  if (t.due_time == null || String(t.due_time).trim() === "") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t.due_time).trim());
  if (!m) return null;
  const hh = Number.parseInt(m[1]!, 10);
  const mm = Number.parseInt(m[2]!, 10);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function NursingShiftChecklist({
  admissionId,
  patientName,
  patientId: patientIdProp,
}: NursingShiftChecklistProps) {
  const { toast } = useToast();
  const clockShift = useMemo(() => detectShiftFromLocalClock(), []);
  const [viewShift, setViewShift] = useState<ShiftKey>(clockShift);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [patientIdResolved, setPatientIdResolved] = useState<string | null>(null);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [liveOk, setLiveOk] = useState(true);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});

  const [completingTask, setCompletingTask] = useState<NursingTaskForCompletion | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  /** Must match `nursing_tasks_category_chk` (lowercase slugs). */
  const [addCategory, setAddCategory] = useState<NursingTaskCategoryDb>("other");
  const [addPriority, setAddPriority] = useState<"routine" | "urgent" | "stat">("routine");
  const [addShift, setAddShift] = useState<ShiftKey>(clockShift);
  /** 12h display string (e.g. "02:30 PM"); empty = no due time. */
  const [addDueTime12h, setAddDueTime12h] = useState("");
  const [dueTimeWheelOpen, setDueTimeWheelOpen] = useState(false);
  const [addInstructions, setAddInstructions] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const todayYmd = useMemo(() => localTodayYmd(), []);

  useEffect(() => {
    if (!addOpen) setDueTimeWheelOpen(false);
  }, [addOpen]);

  const patientId = patientIdProp?.trim() || patientIdResolved;

  const loadTasks = useCallback(async () => {
    if (!admissionId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_nursing_shift_tasks", {
      p_admission_id: admissionId,
      p_shift: viewShift,
      p_date: todayYmd,
    });
    setLoading(false);
    if (error) {
      toast.error({ title: "Could not load tasks", body: error.message });
      setTasks([]);
      return;
    }
    const rows = parseTasks(data);
    setTasks(rows);
    const o: Record<string, boolean> = {};
    for (const c of CATEGORY_ORDER) {
      if (rows.some((t) => t.task_category === c)) o[c] = true;
    }
    setOpenCats((prev) => ({ ...o, ...prev }));
  }, [admissionId, viewShift, todayYmd, toast]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: adm } = await supabase
        .from("ipd_admissions")
        .select("hospital_id, patient_id")
        .eq("id", admissionId)
        .maybeSingle();
      if (cancelled || !adm || typeof adm !== "object") return;
      const rec = adm as Record<string, unknown>;
      const hid = s(rec.hospital_id);
      const pid = s(rec.patient_id);
      if (hid) setHospitalId(hid);
      if (pid) setPatientIdResolved(pid);
    })();
    return () => {
      cancelled = true;
    };
  }, [admissionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id;
      if (!uid || cancelled) return;
      const { data: pr } = await supabase.from("practitioners").select("id").eq("user_id", uid).maybeSingle();
      if (pr && typeof pr === "object" && "id" in pr) {
        setPractitionerId(s(pr.id));
        return;
      }
      const { data: pr2 } = await supabase.from("practitioners").select("id").eq("id", uid).maybeSingle();
      if (pr2 && typeof pr2 === "object" && "id" in pr2) setPractitionerId(s(pr2.id));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!admissionId) return;
    const channel = supabase
      .channel(`nursing_tasks_${admissionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "nursing_tasks",
          filter: `admission_id=eq.${admissionId}`,
        },
        () => void loadTasks(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLiveOk(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLiveOk(false);
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [admissionId, loadTasks]);

  const { doneCount, totalCount, pct } = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status !== "pending").length;
    const p = total === 0 ? 0 : Math.round((done / total) * 100);
    return { doneCount: done, totalCount: total, pct: p };
  }, [tasks]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const c of CATEGORY_ORDER) map.set(c, []);
    for (const t of tasks) {
      const cat = CATEGORY_ORDER.includes(t.task_category as (typeof CATEGORY_ORDER)[number])
        ? t.task_category
        : "other";
      map.get(cat)!.push(t);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const ap = a.status === "pending" ? 0 : 1;
        const bp = b.status === "pending" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const da = taskDueSortKeyMs(a);
        const db = taskDueSortKeyMs(b);
        if (da !== db) return da - db;
        return a.task_name.localeCompare(b.task_name);
      });
    }
    return map;
  }, [tasks]);

  const viewingNonLiveShift = viewShift !== clockShift;

  const openCompleteSheet = (t: TaskRow) => {
    if (t.status !== "pending") return;
    setCompletingTask({ id: t.id, task_name: t.task_name, task_category: t.task_category, instructions: t.instructions });
  };

  const handleAddManual = async () => {
    if (!hospitalId || !practitionerId) {
      toast.error({ title: "Missing session", body: "Hospital or practitioner not loaded." });
      return;
    }
    if (!patientId) {
      toast.error({ title: "Missing patient", body: "Patient could not be resolved for this admission." });
      return;
    }
    const name = addName.trim();
    if (!name) {
      toast.warning({ title: "Enter a task name" });
      return;
    }
    setAddBusy(true);

    let dueDateStr: string | null = null;
    let dueTimeStr: string | null = null;
    if (addDueTime12h.trim()) {
      const h24 = time12hTo24hForDb(addDueTime12h.trim());
      if (h24) {
        dueDateStr = todayYmdIST();
        dueTimeStr = `${h24.slice(0, 5)}:00`;
      }
    }

    const scheduledDate = dueDateStr ?? todayYmd;

    const shiftValue = addShift.toLowerCase();
    const row: Record<string, unknown> = {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      task_name: name,
      task_category: addCategory,
      priority: addPriority,
      shift: shiftValue,
      scheduled_shift: shiftValue,
      scheduled_date: scheduledDate,
      ...(dueDateStr && dueTimeStr ? { due_date: dueDateStr, due_time: dueTimeStr } : {}),
      instructions: addInstructions.trim() || null,
      status: "pending",
      created_by: practitionerId,
      frequency: "once",
      is_recurring: false,
      source_kind: "manual",
    };

    const { error } = await supabase.from("nursing_tasks").insert(row);
    setAddBusy(false);
    if (error) {
      toast.error({ title: "Could not add task", body: error.message });
      return;
    }
    toast.success({ title: "Task added" });
    setAddOpen(false);
    setAddName("");
    setAddInstructions("");
    setAddDueTime12h("");
    setDueTimeWheelOpen(false);
    setAddCategory("other");
    setAddPriority("routine");
    setAddShift(viewShift);
    void loadTasks();
  };

  return (
    <div
      className={cn(
        "relative flex min-h-[320px] flex-col rounded-xl border border-gray-200 bg-white text-gray-900 shadow-sm",
        viewingNonLiveShift && "opacity-90",
      )}
    >
      {!liveOk ? (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-900">
          Live updates paused — reconnecting…
        </div>
      ) : null}

      {/* Sticky header */}
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold",
                shiftBadgeClasses(viewShift),
              )}
            >
              {shiftLabelCapitalized(viewShift)}
            </span>
            <span className="text-sm text-gray-500">{todayYmd}</span>
          </div>

          <div className="min-w-0 px-0 lg:px-2">
            <div className="mb-1 flex justify-between text-xs font-semibold text-gray-700">
              <span>
                {doneCount} / {totalCount} done
              </span>
              {totalCount > 0 ? <span>{pct}%</span> : null}
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500 ease-out",
                  pct >= 100 ? "bg-emerald-500" : "bg-blue-600",
                )}
                style={{ width: `${totalCount === 0 ? 0 : pct}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end lg:text-right">
            <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              Add Task
            </Button>
            <p className="text-sm text-gray-500">
              Patient: <span className="font-semibold text-gray-900">{patientName}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Shift pills */}
      <div className="flex flex-wrap gap-2 border-b border-gray-100 px-4 py-3">
        {(["morning", "afternoon", "night"] as const).map((sh) => {
          const active = viewShift === sh;
          const isClock = clockShift === sh;
          return (
            <button
              key={sh}
              type="button"
              onClick={() => setViewShift(sh)}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-semibold transition",
                active
                  ? "bg-blue-600 text-white shadow-sm ring-2 ring-blue-600/30"
                  : "border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100",
                isClock && !active && "ring-1 ring-amber-300/80",
              )}
            >
              {shiftLabelCapitalized(sh)}
              {isClock ? <span className="ml-1 text-[10px] opacity-80">●</span> : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 p-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-14 text-center">
            <div className="mb-4 text-5xl" aria-hidden>
              📋
            </div>
            <p className="text-base font-semibold text-gray-900">No tasks scheduled for this shift</p>
            <p className="mt-2 max-w-sm text-sm text-gray-500">
              Tasks auto-appear when doctor writes nursing orders. Use <span className="font-medium text-gray-700">Add Task</span>{" "}
              above to add one manually.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {CATEGORY_ORDER.map((cat) => {
              const list = grouped.get(cat) ?? [];
              if (list.length === 0) return null;
              const doneInCat = list.filter((t) => t.status !== "pending").length;
              const open = openCats[cat] ?? true;
              const meta = CATEGORY_META[cat] ?? CATEGORY_META.other!;
              return (
                <div
                  key={cat}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white"
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50"
                    onClick={() => setOpenCats((o) => ({ ...o, [cat]: !open }))}
                  >
                    <span className="flex items-center gap-2 font-bold text-gray-900">
                      <span aria-hidden>{meta.emoji}</span>
                      {meta.lucide}
                      {meta.title}
                    </span>
                    <span className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5">
                        {doneInCat}/{list.length} done
                      </span>
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                  {open ? (
                    <ul className="space-y-2 border-t border-gray-100 px-3 pb-3 pt-2">
                      {list.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          borderAccent={categoryAccentBorder(cat)}
                          onToggleComplete={() => openCompleteSheet(t)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Complete / skip modal */}
      <NursingTaskCompleteModal
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={() => void loadTasks()}
      />

      {/* Add task bottom sheet */}
      {addOpen ? (
        <div className="fixed inset-0 z-[150] flex flex-col justify-end bg-black/50 p-0 sm:p-4">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={() => setAddOpen(false)} />
          <div className="relative mx-auto w-full max-h-[90vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Add manual task</h3>
              <button type="button" className="rounded-lg p-2 hover:bg-gray-100" onClick={() => setAddOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Task name</Label>
                <Input
                  autoFocus
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Category</Label>
                <select
                  value={addCategory}
                  onChange={(e) => setAddCategory(e.target.value as NursingTaskCategoryDb)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {MANUAL_TASK_CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Priority</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: "routine", label: "ROUTINE" },
                      { value: "urgent", label: "URGENT" },
                      { value: "stat", label: "STAT" },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setAddPriority(p.value)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-bold",
                        addPriority === p.value
                          ? "border-blue-600 bg-blue-600/15 text-blue-700"
                          : "border-gray-200",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Shift</Label>
                <select
                  value={addShift}
                  onChange={(e) => setAddShift(e.target.value as ShiftKey)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="night">Night</option>
                </select>
              </div>
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-gray-50"
                  onClick={() => {
                    setDueTimeWheelOpen((o) => {
                      const opening = !o;
                      if (opening && !addDueTime12h.trim()) {
                        const d = new Date();
                        setAddDueTime12h(time24hTo12hDisplay(d.getHours(), d.getMinutes()));
                      }
                      return opening;
                    });
                  }}
                  aria-expanded={dueTimeWheelOpen}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-gray-500 transition-transform",
                      dueTimeWheelOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      Due time (optional)
                    </span>
                    {!dueTimeWheelOpen ? (
                      <span className="mt-0.5 block text-sm tabular-nums text-gray-800">
                        {addDueTime12h.trim() ? addDueTime12h : "Not set"}
                      </span>
                    ) : null}
                  </div>
                </button>
                {dueTimeWheelOpen ? (
                  <div className="space-y-2 border-t border-gray-100 px-3 pb-3 pt-2">
                    <div className="flex justify-center">
                      <TimeWheelPicker
                        value={addDueTime12h.trim() ? addDueTime12h : "12:00 PM"}
                        onChange={(next) => setAddDueTime12h(next)}
                      />
                    </div>
                    {addDueTime12h.trim() ? (
                      <button
                        type="button"
                        className="w-full text-center text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
                        onClick={() => {
                          setAddDueTime12h("");
                          setDueTimeWheelOpen(false);
                        }}
                      >
                        Clear due time
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <Label>Instructions (optional)</Label>
                <Textarea value={addInstructions} onChange={(e) => setAddInstructions(e.target.value)} rows={3} className="mt-1" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={addBusy} onClick={() => void handleAddManual()}>
                {addBusy ? "…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  borderAccent,
  onToggleComplete,
}: {
  task: TaskRow;
  borderAccent: string;
  onToggleComplete: () => void;
}) {
  const [instrOpen, setInstrOpen] = useState(false);
  const pending = task.status === "pending";
  const done = task.status === "completed";
  const skipped = task.status === "skipped";
  const pri = task.priority.toUpperCase();
  const showStat = pri === "STAT";
  const showUrgent = pri === "URGENT";

  const doneRel =
    task.completed_at && !Number.isNaN(new Date(task.completed_at).getTime())
      ? formatDistanceToNow(new Date(task.completed_at), { addSuffix: true })
      : "";

  const dueLabel = formatDueLabel(task);

  return (
    <li
      className={cn(
        "flex gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition hover:shadow-md",
        "border-l-4",
        borderAccent,
        done || skipped ? "opacity-60" : "",
      )}
    >
      <button
        type="button"
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 transition",
          pending
            ? "border-blue-600 text-blue-600 hover:bg-blue-600/10"
            : "cursor-default border-gray-200",
        )}
        onClick={() => pending && onToggleComplete()}
        aria-label={pending ? "Complete task" : done ? "Completed" : "Skipped"}
      >
        {done ? <Check className="h-5 w-5 text-emerald-600" strokeWidth={2.5} /> : skipped ? <X className="h-5 w-5 text-gray-500" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "font-semibold text-gray-900",
              (done || skipped) && "line-through decoration-gray-400",
            )}
          >
            {task.task_name}
          </span>
          {showStat ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
              </span>
              STAT
            </span>
          ) : null}
          {showUrgent ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-950">
              URGENT
            </span>
          ) : null}
          {dueLabel ? (
            <span className="text-[11px] text-gray-500">Due {dueLabel}</span>
          ) : null}
        </div>
        {task.instructions ? (
          <div className="mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600"
              onClick={() => setInstrOpen((o) => !o)}
            >
              {instrOpen ? "Hide instructions" : "Show instructions"}
              {instrOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {instrOpen ? <p className="mt-1 text-xs text-gray-500">{task.instructions}</p> : null}
          </div>
        ) : null}
        {done ? (
          <p className="mt-2 text-xs text-emerald-700">
            <Check className="mr-1 inline h-3.5 w-3.5" />
            {task.completed_by_name ? `${task.completed_by_name} · ` : ""}
            {doneRel}
          </p>
        ) : null}
        {skipped ? (
          <p className="mt-2 text-xs italic text-gray-500 line-through">
            Skipped{task.skip_reason ? ` — ${task.skip_reason}` : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
}
