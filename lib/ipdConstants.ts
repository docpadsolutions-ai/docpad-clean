/** Default hospital for IPD admit flow (per product spec). */
export const IPD_DEFAULT_HOSPITAL_ID = "e90e4607-dd60-4821-b736-02a2577432e0";

/** When true (default in dev), consent gating is skipped in the UI. Set NEXT_PUBLIC_DEV_BYPASS_CONSENTS=false to enforce. */
export function devBypassIpdConsents(): boolean {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEV_BYPASS_CONSENTS === "false") {
    return false;
  }
  return true;
}
