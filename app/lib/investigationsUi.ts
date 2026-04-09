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
  if (k === "ready") return "bg-emerald-500";
  if (k === "pending") return "bg-amber-400";
  if (k === "reviewed") return "bg-gray-400";
  if (k === "critical") return "bg-red-600";
  return "bg-slate-300";
}

export function resultStatusBadgeClass(status: string | null | undefined): string {
  const k = normalizeResultStatus(status);
  if (k === "lost" || k === "late") return "border-red-200 bg-red-50 text-red-800";
  if (k === "abnormal" || k === "critical") return "border-orange-200 bg-orange-50 text-orange-900";
  if (k === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-900";
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
