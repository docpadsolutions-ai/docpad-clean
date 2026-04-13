export type NursingShiftUi = "Morning" | "Afternoon" | "Night";

/** Matches ward assignment / RPC shift labels. */
export function defaultNursingShiftFromClock(): NursingShiftUi {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return "Morning";
  if (h >= 14 && h < 22) return "Afternoon";
  return "Night";
}

export function shiftPillClass(shift: string): string {
  const s = shift.trim().toLowerCase();
  if (s === "morning") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  if (s === "afternoon") return "bg-orange-100 text-orange-900 ring-1 ring-orange-200";
  if (s === "night") return "bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200";
  return "bg-gray-100 text-gray-700 ring-1 ring-gray-200";
}
