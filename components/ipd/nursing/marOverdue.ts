/**
 * MAR slot is overdue: still pending and scheduled time + 2h is in the past.
 * `scheduledTime` should match DB (e.g. `08:00` or `08:00:00`).
 */
export function isMarSlotOverdue(
  scheduledDate: string,
  scheduledTime: string | null | undefined,
): boolean {
  const d = String(scheduledDate ?? "").trim();
  const t = String(scheduledTime ?? "").trim();
  if (!d || !t) return false;
  const slotTs = new Date(`${d}T${t}`);
  if (Number.isNaN(slotTs.getTime())) return false;
  return slotTs.getTime() + 2 * 60 * 60 * 1000 < Date.now();
}
