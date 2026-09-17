import { redirect } from "next/navigation";

/** Legacy URL — canonical list is `/patients`. */
export default function OpdPatientsRedirectPage() {
  redirect("/patients");
}
