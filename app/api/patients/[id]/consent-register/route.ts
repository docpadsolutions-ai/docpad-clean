import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/patients/<id>/consent-register
 *
 * The patient's consent register: what they agreed to and when, who recorded it,
 * anything they have withdrawn, and every access / correction / erasure request
 * and grievance raised on their behalf — the record a data principal is entitled
 * to ask for under the DPDP Act, and the one to hand a regulator.
 *
 * ?download=1 sends it as a file. The RPC asserts hospital scope and logs the
 * read against the patient, so pulling a register is itself auditable.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireStaff();
  if (!gate.ok) return gate.response;
  const { supabase } = gate.staff;

  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid patient id." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("get_patient_consent_register", { p_patient_id: id });

  if (error) {
    const forbidden = error.code === "42501" || /another hospital/i.test(error.message ?? "");
    return NextResponse.json(
      { error: forbidden ? "Not permitted." : "Could not build the consent register." },
      { status: forbidden ? 403 : 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (req.nextUrl.searchParams.get("download")) {
    const docpadId =
      (data as { patient?: { docpad_id?: string | null } }).patient?.docpad_id ?? id;
    headers["Content-Disposition"] = `attachment; filename="consent-register-${docpadId}.json"`;
  }

  return new NextResponse(JSON.stringify(data, null, 2), { status: 200, headers });
}
