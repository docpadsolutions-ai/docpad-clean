import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalibrationState, CanvasObject, Measurement, Specialty } from "@/app/components/measurements/xray-types";
import { unwrapRpcArray } from "@/app/lib/ipdConsults";

/** Normalize RPC row to session fields (handles multiple possible DB shapes). */
export function parseXraySessionRow(data: unknown): {
  canvasObjects: CanvasObject[];
  measurements: Measurement[];
  calibration: CalibrationState;
  presetUsed?: string;
  presetStep?: number;
  summaryText?: string;
} | null {
  if (data == null) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;

  const session =
    (parseJsonField(row.session_data) as Record<string, unknown> | null) ??
    (parseJsonField(row.session) as Record<string, unknown> | null) ??
    row;

  const canvasObjects = (session.canvas_objects ?? session.canvasObjects ?? row.canvas_objects) as
    | CanvasObject[]
    | undefined;
  const measurements = (session.measurements ?? row.measurements) as Measurement[] | undefined;
  const calibration = (session.calibration ?? row.calibration) as CalibrationState | undefined;

  if (
    canvasObjects == null &&
    measurements == null &&
    calibration == null &&
    row.canvas_objects == null &&
    row.measurements == null
  ) {
    return null;
  }

  return {
    canvasObjects: Array.isArray(canvasObjects) ? canvasObjects : [],
    measurements: Array.isArray(measurements) ? measurements : [],
    calibration: calibration ?? {
      isCalibrated: false,
      pxPerMm: null,
      referenceLabel: "",
    },
    presetUsed:
      typeof session.preset_used === "string"
        ? session.preset_used
        : typeof row.preset_used === "string"
          ? row.preset_used
          : undefined,
    presetStep:
      typeof session.preset_step === "number"
        ? session.preset_step
        : typeof row.preset_step === "number"
          ? row.preset_step
          : undefined,
    summaryText: typeof row.summary_text === "string" ? row.summary_text : undefined,
  };
}

function parseJsonField(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

export async function fetchXrayMeasurementsForEncounter(
  supabase: SupabaseClient,
  encounterId: string,
): Promise<{ data: ReturnType<typeof parseXraySessionRow>; error: Error | null }> {
  const { data, error } = await supabase.rpc("get_xray_measurements_for_encounter", {
    p_encounter_id: encounterId,
  });
  if (error) return { data: null, error: new Error(error.message) };
  const rows = unwrapRpcArray(data);
  const parsed = parseXraySessionRow(rows.length ? rows[0] : data);
  return { data: parsed, error: null };
}

export async function upsertXrayMeasurement(
  supabase: SupabaseClient,
  args: {
    encounterId: string;
    patientId: string;
    hospitalId: string;
    doctorId?: string | null;
    specialty: Specialty;
    canvasObjects: CanvasObject[];
    measurements: Measurement[];
    calibration: CalibrationState;
    summaryText: string;
    presetUsed?: string | null;
    presetStep?: number | null;
  },
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc("upsert_xray_measurement", {
    p_encounter_id: args.encounterId,
    p_patient_id: args.patientId,
    p_hospital_id: args.hospitalId,
    p_doctor_id: args.doctorId ?? null,
    p_specialty: args.specialty,
    p_canvas_objects: args.canvasObjects,
    p_measurements: args.measurements,
    p_calibration: args.calibration,
    p_summary_text: args.summaryText,
    p_preset_id: args.presetUsed ?? null,
    p_preset_step: args.presetStep ?? null,
  } as Record<string, unknown>);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}
