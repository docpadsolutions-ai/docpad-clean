"use client";

/**
 * Global DocPad toast stack (bottom-right, max 4, slide-in from right).
 * Wire `<ToastProvider>` in `app/layout.tsx` (project root layout).
 *
 * @example Critical (manual dismiss only)
 * ```tsx
 * const { toast } = useToast();
 * toast.critical({
 *   title: "Wrong patient risk",
 *   body: "Two patients with similar names detected",
 * });
 * ```
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
  X,
} from "lucide-react";
import { clsx } from "clsx";

export type ToastSeverity = "critical" | "error" | "warning" | "success" | "info";

export type ToastInput = { title: string; body?: string };

type ToastRecord = ToastInput & {
  id: string;
  severity: ToastSeverity;
  /** 0 = manual dismiss only */
  durationMs: number;
  createdAt: number;
  expiresAt: number | null;
};

const MAX_TOASTS = 4;

const AUTO_DURATION_MS: Record<Exclude<ToastSeverity, "critical">, number> = {
  error: 8000,
  warning: 6000,
  success: 4000,
  info: 4000,
};

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export type ToastApi = {
  critical: (opts: ToastInput) => string;
  error: (opts: ToastInput) => string;
  warning: (opts: ToastInput) => string;
  success: (opts: ToastInput) => string;
  info: (opts: ToastInput) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<{ toast: ToastApi } | null>(null);

export function useToast(): { toast: ToastApi } {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

function toastIcon(severity: ToastSeverity) {
  const className = "h-5 w-5 shrink-0";
  switch (severity) {
    case "critical":
      return <OctagonAlert className={className} strokeWidth={2} aria-hidden />;
    case "error":
      return <AlertCircle className={className} strokeWidth={2} aria-hidden />;
    case "warning":
      return <AlertTriangle className={className} strokeWidth={2} aria-hidden />;
    case "success":
      return <CheckCircle2 className={className} strokeWidth={2} aria-hidden />;
    default:
      return <Info className={className} strokeWidth={2} aria-hidden />;
  }
}

function toastSurface(severity: ToastSeverity): string {
  switch (severity) {
    case "critical":
      return "border-red-900/40 bg-red-600 text-white shadow-xl shadow-red-900/20";
    case "error":
      return "border-red-200 bg-red-50 text-red-950 shadow-lg";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-950 shadow-lg";
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-950 shadow-lg";
    default:
      return "border-blue-200 bg-blue-50 text-blue-950 shadow-lg";
  }
}

function progressTrack(severity: ToastSeverity): string {
  if (severity === "critical") return "bg-white/25";
  switch (severity) {
    case "error":
      return "bg-red-200/80";
    case "warning":
      return "bg-amber-200/80";
    case "success":
      return "bg-emerald-200/80";
    default:
      return "bg-blue-200/80";
  }
}

function progressFill(severity: ToastSeverity): string {
  if (severity === "critical") return "bg-white";
  switch (severity) {
    case "error":
      return "bg-red-600";
    case "warning":
      return "bg-amber-600";
    case "success":
      return "bg-emerald-600";
    default:
      return "bg-blue-600";
  }
}

function ToastItemView({
  item,
  onDismiss,
  now,
}: {
  item: ToastRecord;
  onDismiss: (id: string) => void;
  /** Supplied by the parent, which already runs the timer these bars need. */
  now: number;
}) {
  const showProgress = item.durationMs > 0 && item.expiresAt != null;
  const remainingPct = showProgress
    ? Math.max(0, Math.min(100, ((item.expiresAt! - now) / item.durationMs) * 100))
    : 100;

  const dismissBtnClass =
    item.severity === "critical"
      ? "rounded-md p-1 text-white/90 hover:bg-white/15"
      : "rounded-md p-1 text-current/70 hover:bg-black/5";

  return (
    <div
      className={clsx(
        "docpad-toast-enter pointer-events-auto relative w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border",
        toastSurface(item.severity),
      )}
      role={item.severity === "critical" ? "alert" : "status"}
      aria-live={item.severity === "critical" ? "assertive" : "polite"}
    >
      <div className="flex gap-3 p-3 pr-10">
        <div className="mt-0.5 shrink-0 opacity-95">{toastIcon(item.severity)}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{item.title}</p>
          {item.body ? (
            <p
              className={clsx(
                "mt-1 text-xs leading-relaxed",
                item.severity === "critical" ? "text-white/90" : "opacity-90",
              )}
            >
              {item.body}
            </p>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className={clsx("absolute right-2 top-2", dismissBtnClass)}
        aria-label="Dismiss"
        onClick={() => onDismiss(item.id)}
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
      {showProgress ? (
        <div className={clsx("h-1 w-full", progressTrack(item.severity))}>
          <div
            className={clsx("h-full transition-[width] duration-100 ease-linear", progressFill(item.severity))}
            style={{ width: `${remainingPct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const hasTimed = toasts.some((t) => t.durationMs > 0);
    if (!hasTimed) return;
    const id = window.setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(id);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-h-[calc(100vh-2rem)] flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItemView key={t.id} item={t} onDismiss={onDismiss} now={now} />
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const existing = timeoutsRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const enqueue = useCallback(
    (severity: ToastSeverity, input: ToastInput): string => {
      const id = genId();
      const durationMs = severity === "critical" ? 0 : AUTO_DURATION_MS[severity];
      const now = Date.now();
      const record: ToastRecord = {
        ...input,
        id,
        severity,
        durationMs,
        createdAt: now,
        expiresAt: durationMs > 0 ? now + durationMs : null,
      };

      setToasts((prev) => {
        let next = [...prev, record];
        while (next.length > MAX_TOASTS) {
          const evictIdx = next.findIndex((t) => t.durationMs > 0);
          const idx = evictIdx >= 0 ? evictIdx : 0;
          const removed = next[idx]!;
          next = next.filter((_, i) => i !== idx);
          const to = timeoutsRef.current.get(removed.id);
          if (to) {
            clearTimeout(to);
            timeoutsRef.current.delete(removed.id);
          }
        }
        return next;
      });

      if (durationMs > 0) {
        const tid = setTimeout(() => dismiss(id), durationMs);
        timeoutsRef.current.set(id, tid);
      }

      return id;
    },
    [dismiss],
  );

  const toastApi = useMemo<ToastApi>(
    () => ({
      critical: (opts) => enqueue("critical", opts),
      error: (opts) => enqueue("error", opts),
      warning: (opts) => enqueue("warning", opts),
      success: (opts) => enqueue("success", opts),
      info: (opts) => enqueue("info", opts),
      dismiss,
    }),
    [enqueue, dismiss],
  );

  useEffect(() => {
    return () => {
      for (const t of timeoutsRef.current.values()) clearTimeout(t);
      timeoutsRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast: toastApi }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
