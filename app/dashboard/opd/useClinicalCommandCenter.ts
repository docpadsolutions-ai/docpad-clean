"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDraftEncounters,
  fetchWaitingPatients,
  type DraftEncounterRow,
  type WaitingPatientRow,
} from "../../lib/clinicalQueue";
import { fetchAuthOrgId } from "../../lib/authOrg";
import { startInProgressEncounterFromReceptionHandoff } from "../../lib/opdEncounterFromAppointment";
import { practitionersOrFilterForAuthUid } from "../../lib/practitionerAuthLookup";
import { supabase } from "../../supabase";

export type ClinicalQueueTab = "waiting" | "drafts";

export function useClinicalCommandCenter() {
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tab, setTab] = useState<ClinicalQueueTab>("waiting");
  const [waiting, setWaiting] = useState<WaitingPatientRow[]>([]);
  const [drafts, setDrafts] = useState<DraftEncounterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [startingRowKey, setStartingRowKey] = useState<string | null>(null);
  const startLock = useRef(false);

  const loadQueue = useCallback(async (oid: string | null) => {
    setLoading(true);
    setFetchError(null);
    const id = oid?.trim() || null;
    if (!id) {
      setWaiting([]);
      setDrafts([]);
      setFetchError("Your account is not linked to an organization.");
      setLoading(false);
      return;
    }
    try {
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setWaiting([]);
        setDrafts([]);
        setFetchError(authErr?.message ?? "You must be signed in to load the waiting room.");
        return;
      }
      const { data: pr } = await supabase
        .from("practitioners")
        .select("id")
        .or(practitionersOrFilterForAuthUid(user.id))
        .maybeSingle();
      const practitionerId = pr?.id != null ? String(pr.id) : null;
      const [w, d] = await Promise.all([
        fetchWaitingPatients(id, { authUserId: user.id, practitionerId }),
        fetchDraftEncounters(id),
      ]);
      setWaiting(w);
      setDrafts(d);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load queue");
      setWaiting([]);
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { orgId: oid, error } = await fetchAuthOrgId();
      if (cancelled) return;
      setOrgId(oid);
      if (error) {
        setFetchError(error.message);
        setWaiting([]);
        setDrafts([]);
        setLoading(false);
        return;
      }
      await loadQueue(oid);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadQueue]);

  const refresh = useCallback(() => {
    void loadQueue(orgId);
  }, [loadQueue, orgId]);

  const onWaitingRowClick = useCallback(
    async (row: WaitingPatientRow) => {
      if (startLock.current) return;
      startLock.current = true;
      setStartingRowKey(row.rowKey);
      setFetchError(null);
      try {
        if (row.source === "opd_direct" && row.scheduledEncounterId) {
          const { error } = await supabase
            .from("opd_encounters")
            .update({ status: "in_progress", updated_at: new Date().toISOString() })
            .eq("id", row.scheduledEncounterId);
          if (error) {
            setFetchError(error.message);
            return;
          }
          await loadQueue(orgId);
          router.push(`/dashboard/opd/encounter/${row.scheduledEncounterId}`);
          return;
        }
        if (row.source === "reception") {
          const newId = await startInProgressEncounterFromReceptionHandoff(row.patientId, orgId, {
            receptionQueueId: row.receptionQueueId,
          });
          if (newId) {
            await loadQueue(orgId);
            router.push(`/dashboard/opd/encounter/${newId}`);
          } else {
            setFetchError("Could not start encounter. Try again.");
          }
        }
      } finally {
        startLock.current = false;
        setStartingRowKey(null);
      }
    },
    [orgId, loadQueue, router],
  );

  const onDraftRowClick = useCallback(
    (row: DraftEncounterRow) => {
      router.push(`/dashboard/opd/encounter/${row.encounterId}`);
    },
    [router],
  );

  return {
    tab,
    setTab,
    waiting,
    drafts,
    loading,
    fetchError,
    refresh,
    startingRowKey,
    onWaitingRowClick,
    onDraftRowClick,
  };
}
