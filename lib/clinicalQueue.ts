/**
 * Clinical Command Center — data layer only (no React).
 * Two distinct sources: waiting appointments vs draft/active encounters.
 */

import {
  fetchActiveDraftEncounters,
  fetchMergedWaitingRoom,
  type ActiveEncounterRow,
  type WaitingPatientRow,
  type WaitingRoomFetchContext,
} from "@/lib/patientQueueData";

export type { WaitingPatientRow, WaitingRoomFetchContext };

export type DraftEncounterRow = ActiveEncounterRow;

/** Reception `with_doctor` today + scheduled `opd_encounters` for this doctor, merged and deduped by patient. */
export async function fetchWaitingPatients(
  orgId: string | null,
  ctx: WaitingRoomFetchContext,
  signal?: AbortSignal,
): Promise<WaitingPatientRow[]> {
  return fetchMergedWaitingRoom(orgId, ctx, signal);
}

/** `opd_encounters` with `status` in `draft` or `in_progress`, with patient + vitals context. */
export async function fetchDraftEncounters(
  orgId: string | null,
  signal?: AbortSignal,
): Promise<DraftEncounterRow[]> {
  return fetchActiveDraftEncounters(orgId, signal);
}
