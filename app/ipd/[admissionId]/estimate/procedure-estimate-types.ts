export type ProcedureEstimateStatus = "draft" | "presented" | "accepted" | "declined" | "superseded";

export type ProcedureEstimateLineItem = {
  seq: number;
  description: string;
  category: string;
  definition_id: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  is_unpriced: boolean;
  unpriced_note: string;
  is_auto_estimated: boolean;
  estimation_basis: string;
  est_days: number | null;
};

export const CHARGE_CATEGORIES = [
  "consultation",
  "procedure",
  "lab_test",
  "imaging",
  "medication",
  "supply",
  "room_charge",
  "nursing",
  "registration",
  "other",
] as const;

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

export const ACCEPT_RELATIONS = ["self", "spouse", "parent", "child", "guardian"] as const;
