export type Specialty = "orthopaedics" | "neurosurgery";

export type ObjectType = "line" | "circle" | "point";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasObject {
  id: string;
  type: ObjectType;
  name: string;
  color: string;
  visible: boolean;
  selected: boolean;
  p1?: CanvasPoint;
  p2?: CanvasPoint;
  center?: CanvasPoint;
  radius?: number;
  position?: CanvasPoint;
}

export type MeasurementType = "angle" | "distance" | "ratio" | "cobb";

export type MeasurementStatus = "normal" | "borderline" | "abnormal" | "unchecked" | "severe";

export interface Measurement {
  id: string;
  type: MeasurementType;
  label: string;
  value: number;
  unit: string;
  status: MeasurementStatus;
  normalRange?: string;
  objectsUsed: string[];
}

export interface CalibrationState {
  isCalibrated: boolean;
  pxPerMm: number | null;
  referenceLabel: string;
}

export interface XraySession {
  id?: string;
  encounterId: string;
  patientId: string;
  hospitalId: string;
  doctorId?: string;
  specialty: Specialty;
  presetUsed?: string;
  presetStep?: number;
  canvasObjects: CanvasObject[];
  measurements: Measurement[];
  calibration: CalibrationState;
  summaryText?: string;
}
