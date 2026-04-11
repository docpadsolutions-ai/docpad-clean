import { cn } from "@/lib/utils";

/** Destructive inline alert — matches DocPad load/error styling (e.g. inpatient encounter `loadErr`). */
export default function ErrorBanner({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200",
        className,
      )}
      role="alert"
    >
      {message}
    </p>
  );
}
