import type { CanvasObject, CanvasPoint } from "./xray-types";

export function lineVector(o: CanvasObject): { p1: CanvasPoint; p2: CanvasPoint } | null {
  if (o.type !== "line" || !o.p1 || !o.p2) return null;
  return { p1: o.p1, p2: o.p2 };
}

export function lineLengthPx(o: CanvasObject): number | null {
  const lv = lineVector(o);
  if (!lv) return null;
  const dx = lv.p2.x - lv.p1.x;
  const dy = lv.p2.y - lv.p1.y;
  return Math.hypot(dx, dy);
}

/** Angle of line vs horizontal, radians */
export function lineAngleRad(o: CanvasObject): number | null {
  const lv = lineVector(o);
  if (!lv) return null;
  return Math.atan2(lv.p2.y - lv.p1.y, lv.p2.x - lv.p1.x);
}

/** Angle between two lines in degrees (0–90] acute convention for Cobb helper). */
export function angleBetweenLinesDeg(a: CanvasObject, b: CanvasObject): number | null {
  const t1 = lineAngleRad(a);
  const t2 = lineAngleRad(b);
  if (t1 == null || t2 == null) return null;
  let deg = (Math.abs(t1 - t2) * 180) / Math.PI;
  if (deg > 90) deg = 180 - deg;
  return deg;
}

/**
 * Cobb-style angle between two lines (perpendicular method simplified to line intersection angle).
 * Same as angleBetweenLinesDeg for two infinite lines.
 */
export function cobbAngleDeg(a: CanvasObject, b: CanvasObject): number | null {
  const lv = lineVector(a);
  const lv2 = lineVector(b);
  if (!lv || !lv2) return null;
  const t1 = Math.atan2(lv.p2.y - lv.p1.y, lv.p2.x - lv.p1.x);
  const t2 = Math.atan2(lv2.p2.y - lv2.p1.y, lv2.p2.x - lv2.p1.x);
  let cobb = (Math.abs(t1 - t2) * 180) / Math.PI;
  if (cobb > 90) cobb = 180 - cobb;
  return cobb;
}

export function scoliosisCobbStatus(deg: number): "normal" | "borderline" | "abnormal" | "severe" {
  if (deg < 10) return "normal";
  if (deg <= 25) return "borderline";
  if (deg <= 40) return "abnormal";
  return "severe";
}

export function ratioOfLineLengths(a: CanvasObject, b: CanvasObject): number | null {
  const la = lineLengthPx(a);
  const lb = lineLengthPx(b);
  if (la == null || lb == null || lb === 0) return null;
  return la / lb;
}
