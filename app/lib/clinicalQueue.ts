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
} from "./patientQueueData";

export type { WaitingPatientRow, WaitingRoomFetchContext };

export type DraftEncounterRow = ActiveEncounterRow;

/** Reception `with_doctor` today + scheduled `opd_encounters` for this doctor, merged and deduped by patient. */
export async function fetchWaitingPatients(
  orgId: string | null,
  ctx: WaitingRoomFetchContext,
): Promise<WaitingPatientRow[]> {
  return fetchMergedWaitingRoom(orgId, ctx);
}

/** `opd_encounters` with `status` in `draft` or `in_progress`, with patient + vitals context. */
export async function fetchDraftEncounters(
  orgId: string | null,
): Promise<DraftEncounterRow[]> {
  return fetchActiveDraftEncounters(orgId);
}
