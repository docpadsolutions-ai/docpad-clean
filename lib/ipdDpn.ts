import type { SupabaseClient } from "@supabase/supabase-js";

function unwrapRpcRow<T extends Record<string, unknown>>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? (first as T) : null;
  }
  if (typeof data === "object") return data as T;
  return null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** RPC may return uuid string or `{ id: uuid }`. */
function parseUuidReturn(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === "string" && str(data)) return str(data);
  if (typeof data === "object" && data !== null && "id" in data) {
    const id = (data as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

export async function rpcGetDpnTimeline(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ rows: Record<string, unknown>[]; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_dpn_timeline", {
    p_admission_id: admissionId,
  });
  if (error) return { rows: [], error: new Error(error.message) };
  const list = Array.isArray(data) ? data : data != null ? [data] : [];
  return { rows: list as Record<string, unknown>[], error: null };
}

export async function rpcGetDpnFullNote(
  supabase: SupabaseClient,
  noteId: string,
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_dpn_full_note", {
    p_note_id: noteId,
  });
  if (error) return { data: null, error: new Error(error.message) };
  if (data == null) return { data: null, error: null };
  if (typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    /** Some deployments return `{ data: { note, vitals, ... } }`. */
    const inner = o.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner) && ("note" in inner || "vitals" in inner)) {
      return { data: inner as Record<string, unknown>, error: null };
    }
    return { data: o, error: null };
  }
  const row = unwrapRpcRow<Record<string, unknown>>(data);
  return { data: row, error: null };
}

export async function rpcGetDpnRightPanel(
  supabase: SupabaseClient,
  admissionId: string,
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_dpn_right_panel", {
    p_admission_id: admissionId,
  });
  if (error) return { data: null, error: new Error(error.message) };
  if (data == null) return { data: null, error: null };
  if (typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const inner = o.data;
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      ("diagnosis" in inner || "admission" in inner || "admitted_formatted" in inner || "surgeon_name" in inner)
    ) {
      return { data: inner as Record<string, unknown>, error: null };
    }
    return { data: o, error: null };
  }
  const row = unwrapRpcRow<Record<string, unknown>>(data);
  return { data: row, error: null };
}

/**
 * Passes through to `upsert_dpn_note` — keys must match your deployed RPC signature.
 * Typical: p_admission_id, p_hospital_id, p_patient_id, p_note_date, p_note_id?, plus SOAP / wound / I/O / NABH fields.
 */
export async function rpcUpsertDpnNote(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<{ noteId: string | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("upsert_dpn_note", payload);
  if (error) return { noteId: null, error: new Error(error.message) };
  const noteId = parseUuidReturn(data);
  return { noteId, error: null };
}

export async function rpcSignDpnNote(
  supabase: SupabaseClient,
  args: { noteId: string; signedBy: string },
): Promise<{ ok: boolean; error: Error | null }> {
  const { data, error } = await supabase.rpc("sign_dpn_note", {
    p_note_id: args.noteId,
    p_signed_by: args.signedBy,
  });
  if (error) return { ok: false, error: new Error(error.message) };
  const ok = data === true || data === 1 || str(data).toLowerCase() === "true";
  return { ok, error: null };
}

export async function rpcOrderDpnInvestigation(
  supabase: SupabaseClient,
  args: {
    admissionId: string;
    hospitalId: string;
    patientId: string;
    noteId: string;
    testName: string;
    testCategory: string;
    priority: string;
  },
): Promise<{ orderId: string | null; error: Error | null }> {
  const { data, error } = await supabase.rpc("order_dpn_investigation", {
    p_admission_id: args.admissionId,
    p_hospital_id: args.hospitalId,
    p_patient_id: args.patientId,
    p_note_id: args.noteId,
    p_test_name: args.testName,
    p_test_category: args.testCategory,
    p_priority: args.priority,
  });
  if (error) return { orderId: null, error: new Error(error.message) };
  return { orderId: parseUuidReturn(data), error: null };
}

export async function acknowledgeCriticalInvestigation(
  supabase: SupabaseClient,
  orderId: string,
  acknowledgedBy: string | null,
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from("ipd_investigation_orders")
    .update({
      critical_acknowledged_at: new Date().toISOString(),
      ...(acknowledgedBy ? { critical_acknowledged_by: acknowledgedBy } : {}),
    })
    .eq("id", orderId);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function insertIpdTreatmentRow(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ id: string | null; error: Error | null }> {
  const { data, error } = await supabase.from("ipd_treatments").insert(row).select("id").maybeSingle();
  if (error) return { id: null, error: new Error(error.message) };
  const id = data && typeof data === "object" && "id" in data ? str((data as { id: unknown }).id) : "";
  return { id: id || null, error: null };
}
