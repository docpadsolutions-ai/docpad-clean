import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/encounters/<id>/fhir
 *
 * Returns the encounter's OP Consult Record as a FHIR R4 document Bundle.
 * The RPC runs SECURITY DEFINER but asserts hospital scope and writes a PHI
 * read to audit_logs, so a doctor from another hospital gets a 403 and every
 * export is traceable.
 *
 * ?download=1 sends it as a file attachment instead of an inline response.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireStaff();
  if (!gate.ok) return gate.response;
  const { supabase } = gate.staff;

  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid encounter id." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("get_opd_consult_bundle", { p_encounter_id: id });

  if (error) {
    // 42501 is the hospital-scope guard inside _assert_hospital_scope().
    const forbidden = error.code === "42501" || /another hospital/i.test(error.message ?? "");
    return NextResponse.json(
      { error: forbidden ? "Not permitted." : "Could not build the consult record." },
      { status: forbidden ? 403 : 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Encounter not found." }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/fhir+json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (req.nextUrl.searchParams.get("download")) {
    headers["Content-Disposition"] = `attachment; filename="op-consult-${id}.json"`;
  }

  return new NextResponse(JSON.stringify(data, null, 2), { status: 200, headers });
}
