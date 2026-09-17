import { cn } from "@/lib/utils";
import { AlertBanner, type AlertSeverity } from "@/src/components/ui/alert-banner";

/** Destructive banner — delegates to the shared severity system (default: high). */
export default function ErrorBanner({
  message,
  className,
  severity = "high",
  title = "Error",
}: {
  message: string;
  className?: string;
  severity?: AlertSeverity;
  title?: string;
}) {
  return <AlertBanner severity={severity} title={title} body={message} className={cn("text-sm", className)} />;
}
