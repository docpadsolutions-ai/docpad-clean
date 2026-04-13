import type { Specialty } from "./xray-types";

export interface PresetStep {
  label: string;
  instruction: string;
  toolHint: "line" | "circle" | "point";
  objectName: string;
}

export interface XrayPreset {
  id: string;
  name: string;
  specialty: Specialty;
  description: string;
  steps: PresetStep[];
}

export const XRAY_PRESETS: XrayPreset[] = [
  {
    id: "knee_alignment",
    name: "Knee alignment (MAD / LDFA / MPTA)",
    specialty: "orthopaedics",
    description: "Mechanical axis of femur and tibia for deviation and angles.",
    steps: [
      {
        label: "Femoral mechanical axis",
        instruction: "Draw a line along the femoral mechanical axis (typically through femoral head center to knee center).",
        toolHint: "line",
        objectName: "Mechanical axis femur",
      },
      {
        label: "Tibial mechanical axis",
        instruction: "Draw a line along the tibial mechanical axis (typically through knee center to ankle center).",
        toolHint: "line",
        objectName: "Mechanical axis tibia",
      },
    ],
  },
  {
    id: "hip_dysplasia",
    name: "Hip dysplasia (CE angle / acetabular index)",
    specialty: "orthopaedics",
    description: "Weight-bearing line and acetabular roof for hip coverage angles.",
    steps: [
      {
        label: "Weight-bearing line",
        instruction: "Draw the weight-bearing line reference.",
        toolHint: "line",
        objectName: "Weight-bearing line",
      },
      {
        label: "Acetabular roof line",
        instruction: "Draw the acetabular roof / sourcil line.",
        toolHint: "line",
        objectName: "Acetabular roof line",
      },
    ],
  },
  {
    id: "scoliosis",
    name: "Scoliosis (Cobb angle)",
    specialty: "orthopaedics",
    description: "Endplate lines for Cobb angle with severity bands.",
    steps: [
      {
        label: "Superior endplate",
        instruction: "Draw along the superior endplate of the upper vertebra in the curve.",
        toolHint: "line",
        objectName: "Superior endplate line",
      },
      {
        label: "Inferior endplate",
        instruction: "Draw along the inferior endplate of the lower vertebra in the curve.",
        toolHint: "line",
        objectName: "Inferior endplate line",
      },
    ],
  },
  {
    id: "foot_ankle",
    name: "Foot & ankle (Böhler / HVA)",
    specialty: "orthopaedics",
    description: "Calcaneal and talar axes for hindfoot angles.",
    steps: [
      {
        label: "Calcaneal axis",
        instruction: "Draw the calcaneal longitudinal axis.",
        toolHint: "line",
        objectName: "Calcaneal axis",
      },
      {
        label: "Talar axis",
        instruction: "Draw the talar reference axis.",
        toolHint: "line",
        objectName: "Talar axis",
      },
    ],
  },
  {
    id: "cervical_spine",
    name: "Cervical lordosis (C2–C7)",
    specialty: "neurosurgery",
    description: "Lines on C2 and C7 for cervical lordosis Cobb.",
    steps: [
      {
        label: "C2 line",
        instruction: "Draw the reference line on C2 (e.g. inferior endplate or posterior margin per protocol).",
        toolHint: "line",
        objectName: "C2 line",
      },
      {
        label: "C7 line",
        instruction: "Draw the reference line on C7.",
        toolHint: "line",
        objectName: "C7 line",
      },
    ],
  },
  {
    id: "craniovertebral",
    name: "Craniovertebral junction",
    specialty: "neurosurgery",
    description: "Basion–opisthion, odontoid, and ADI lines.",
    steps: [
      {
        label: "Basion–opisthion",
        instruction: "Draw the basion–opisthion (McGregor) line.",
        toolHint: "line",
        objectName: "Basion–opisthion line",
      },
      {
        label: "Odontoid tip line",
        instruction: "Draw the odontoid tip reference line.",
        toolHint: "line",
        objectName: "Odontoid tip line",
      },
      {
        label: "ADI line",
        instruction: "Draw the atlantodental interval reference (dens–anterior arch).",
        toolHint: "line",
        objectName: "ADI line",
      },
    ],
  },
  {
    id: "lumbar_spine",
    name: "Lumbar lordosis (L1–S1)",
    specialty: "neurosurgery",
    description: "Endplate lines on L1 and S1 for lumbar lordosis.",
    steps: [
      {
        label: "L1 endplate",
        instruction: "Draw along the L1 superior or inferior endplate (per protocol).",
        toolHint: "line",
        objectName: "L1 endplate",
      },
      {
        label: "S1 endplate",
        instruction: "Draw along the S1 superior endplate.",
        toolHint: "line",
        objectName: "S1 endplate",
      },
    ],
  },
];

export function presetsForSpecialty(s: Specialty): XrayPreset[] {
  return XRAY_PRESETS.filter((p) => p.specialty === s);
}
