import { redirect } from "next/navigation";

/**
 * Standalone triage is deprecated. The reception module is the unified front-desk + vitals workspace.
 * Prefer `/reception`. Middleware redirects this route with the query string preserved.
 */
export default function TriageDeprecatedPage() {
  redirect("/reception");
}
