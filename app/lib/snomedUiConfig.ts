/**
 * Optional hospital specialty filter for SNOMED search (India NRC refset keys).
 * Set `NEXT_PUBLIC_SNOMED_INDIA_REFSET=orthopedics` (or `cardiology`, etc.) in `.env.local`.
 * Keys must match `INDIA_SNOMED_REFSET_IDS` in `./indiaSnomedRefsets`.
 */
export function readIndiaRefsetKeyFromEnv(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const v = process.env.NEXT_PUBLIC_SNOMED_INDIA_REFSET?.trim();
  return v && v.length > 0 ? v : undefined;
}
