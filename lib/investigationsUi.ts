/** Maps `investigations.result_status` to UI dot + badge styles (Phase 2 spec). */

export type ResultStatusKey =
  | "lost"
  | "late"
  | "abnormal"
  | "ready"
  | "pending"
  | "reviewed"
  | "critical"
  | string;

export function normalizeResultStatus(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function resultStatusDotClass(status: string | null | undefined): string {
  const k = normalizeResultStatus(status);
  if (k === "lost" || k === "late") return "bg-red-500";
  if (k === "abnormal") return "bg-orange-500";
  if (k === "ready" || k === "resulted") return "bg-emerald-500";
  if (k === "pending") return "bg-amber-400";
  if (k === "reviewed") return "bg-gray-400";
  if (k === "critical") return "bg-red-600";
  return "bg-slate-300";
}

export function resultStatusBadgeClass(status: string | null | undefined): string {
  const k = normalizeResultStatus(status);
  if (k === "lost" || k === "late") return "border-red-200 bg-red-50 text-red-800";
  if (k === "critical") return "border-red-300 bg-red-50 text-red-900";
  if (k === "abnormal") return "border-orange-200 bg-orange-50 text-orange-900";
  if (k === "ready" || k === "resulted") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (k === "pending") return "border-amber-200 bg-amber-50 text-amber-900";
  if (k === "reviewed") return "border-gray-200 bg-gray-50 text-gray-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function formatOrderedDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 16);
  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function localYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function orderedOnLocalDay(iso: string | null | undefined, ymd: string): boolean {
  if (!iso?.trim()) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    const head = iso.trim().slice(0, 10);
    return head === ymd;
  }
  const d = new Date(t);
  return localYmd(d) === ymd;
}

/** Matches workflow states still awaiting a result (ordered / collected). */
export function investigationStatusPending(s: string | null | undefined): boolean {
  const x = (s ?? "").trim().toLowerCase();
  return x === "ordered" || x === "collected";
}

export function investigationIsOverduePending(inv: {
  status: string | null;
  ordered_at: string | null;
}): boolean {
  if (!investigationStatusPending(inv.status)) return false;
  const t = Date.parse(String(inv.ordered_at ?? ""));
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > 24 * 60 * 60 * 1000;
}

export type LabResultEntryLike = {
  parameter_name?: string | null;
  value_numeric?: number | null;
  value_text?: string | null;
  interpretation?: string | null;
  is_abnormal?: boolean | null;
};

/** Line-level critical value (e.g. hyperkalemia) or explicit critical interpretation. */
export function labEntryIsCritical(e: LabResultEntryLike, investigationResultStatus: string | null | undefined): boolean {
  const rs = normalizeResultStatus(investigationResultStatus);
  const interp = (e.interpretation ?? "").trim().toLowerCase();
  if (interp.includes("critical")) return true;
  if (rs === "critical" && e.is_abnormal === true) return true;
  let n: number | null = null;
  if (e.value_numeric != null && Number.isFinite(Number(e.value_numeric))) {
    n = Number(e.value_numeric);
  } else {
    const raw = (e.value_text ?? "").trim().replace(/,/g, "");
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null || !Number.isFinite(n)) return false;
  const name = (e.parameter_name ?? "").toLowerCase();
  const potassium =
    name.includes("potassium") || /\bk\+\b/.test(name) || /^k\+?$/.test(name.trim()) || name.includes("k+");
  if (potassium && n > 6.5) return true;
  return false;
}

export type LabRowSeverityClass = "critical" | "abnormal" | "normal";

export function labRowSeverity(
  e: LabResultEntryLike,
  investigationResultStatus: string | null | undefined,
): LabRowSeverityClass {
  if (labEntryIsCritical(e, investigationResultStatus)) return "critical";
  if (e.is_abnormal === true) return "abnormal";
  return "normal";
}

/** Pill labels on investigation cards: maps to clinical emphasis tiers. */
export type InvestigationResultPill = "critical" | "high" | "abnormal" | "normal";

export function deriveInvestigationResultPill(
  inv: {
    status: string | null;
    ordered_at: string | null;
    result_status: string | null;
  },
  entries: LabResultEntryLike[],
): InvestigationResultPill {
  const rs = normalizeResultStatus(inv.result_status);
  if (rs === "critical") return "critical";
  for (const e of entries) {
    if (labEntryIsCritical(e, inv.result_status)) return "critical";
  }
  if (rs === "lost" || rs === "late") return "high";
  if (investigationIsOverduePending(inv)) return "high";
  if (rs === "abnormal" || entries.some((e) => e.is_abnormal === true)) return "abnormal";
  return "normal";
}
