/** Hardcoded adult normal ranges for IPD nursing vitals highlighting (not configurable yet). */

export type IpdNursingVitalsAbnormalFlags = {
  bp: boolean;
  pulse: boolean;
  temp: boolean;
  spo2: boolean;
  rr: boolean;
};

const BP_SYS_LO = 90;
const BP_SYS_HI = 140;
const BP_DIA_LO = 60;
const BP_DIA_HI = 90;
const PULSE_LO = 50;
const PULSE_HI = 100;
const TEMP_LO = 35.0;
const TEMP_HI = 38.5;
const SPO2_LO = 94;
const RR_LO = 12;
const RR_HI = 20;

export function parseBloodPressureText(raw: string | null | undefined): { sys: number; dia: number } | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (!m) return null;
  const sys = Number.parseInt(m[1], 10);
  const dia = Number.parseInt(m[2], 10);
  if (!Number.isFinite(sys) || !Number.isFinite(dia)) return null;
  return { sys, dia };
}

export function bloodPressureAbnormal(raw: string | null | undefined): boolean {
  const p = parseBloodPressureText(raw);
  if (!p) return false;
  return p.sys > BP_SYS_HI || p.sys < BP_SYS_LO || p.dia > BP_DIA_HI || p.dia < BP_DIA_LO;
}

export function pulseAbnormal(v: number | null | undefined): boolean {
  if (v == null || Number.isNaN(v)) return false;
  return v > PULSE_HI || v < PULSE_LO;
}

export function temperatureAbnormalC(v: number | null | undefined): boolean {
  if (v == null || Number.isNaN(v)) return false;
  return v > TEMP_HI || v < TEMP_LO;
}

export function spo2Abnormal(v: number | null | undefined): boolean {
  if (v == null || Number.isNaN(v)) return false;
  return v < SPO2_LO;
}

export function respiratoryRateAbnormal(v: number | null | undefined): boolean {
  if (v == null || Number.isNaN(v)) return false;
  return v < RR_LO || v > RR_HI;
}

export function abnormalFlagsForIpdNursingVitalsRow(row: {
  blood_pressure?: unknown;
  pulse?: unknown;
  temperature?: unknown;
  spo2?: unknown;
  respiratory_rate?: unknown;
}): IpdNursingVitalsAbnormalFlags {
  const bp = typeof row.blood_pressure === "string" ? row.blood_pressure : row.blood_pressure != null ? String(row.blood_pressure) : "";
  const pulse = typeof row.pulse === "number" ? row.pulse : row.pulse != null ? Number(row.pulse) : null;
  const temp = typeof row.temperature === "number" ? row.temperature : row.temperature != null ? Number(row.temperature) : null;
  const spo2 = typeof row.spo2 === "number" ? row.spo2 : row.spo2 != null ? Number(row.spo2) : null;
  const rr = typeof row.respiratory_rate === "number" ? row.respiratory_rate : row.respiratory_rate != null ? Number(row.respiratory_rate) : null;

  return {
    bp: bloodPressureAbnormal(bp),
    pulse: pulseAbnormal(pulse),
    temp: temperatureAbnormalC(temp),
    spo2: spo2Abnormal(spo2),
    rr: respiratoryRateAbnormal(rr),
  };
}
