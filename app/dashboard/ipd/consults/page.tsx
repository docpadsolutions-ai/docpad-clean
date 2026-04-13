import { redirect } from "next/navigation";

/** Canonical consult inbox lives at `/ipd/consults` (same dashboard shell via `app/ipd/layout`). */
export default function ConsultInboxRedirectPage() {
  redirect("/ipd/consults");
}
