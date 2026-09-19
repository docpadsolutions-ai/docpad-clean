"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * The identity a clinical screen has to show before anyone acts on the record.
 *
 * Proposal v1.0 2.3 asks for a persistent patient banner on every clinical screen
 * carrying photo, name, age/sex, DocPad ID and CR number. Those five fields were
 * being assembled by hand on each page that bothered, which is why most did not, and
 * why the ones that did showed different subsets in different markup.
 */
export type PatientIdentity = {
  id: string;
  name: string;
  ageYears: number | null;
  sex: string | null;
  docpadId: string | null;
  crNumber: string | null;
  bloodGroup: string | null;
  phone: string | null;
};

const COLUMNS = "id, full_name, age_years, sex, docpad_id, cr_number, blood_group, phone";

function toIdentity(row: Record<string, unknown>): PatientIdentity {
  const age = Number(row.age_years);
  return {
    id: String(row.id),
    name: String(row.full_name ?? "").trim() || "Unnamed patient",
    ageYears: Number.isFinite(age) ? age : null,
    sex: row.sex ? String(row.sex) : null,
    docpadId: row.docpad_id ? String(row.docpad_id) : null,
    crNumber: row.cr_number ? String(row.cr_number) : null,
    bloodGroup: row.blood_group ? String(row.blood_group) : null,
    phone: row.phone ? String(row.phone) : null,
  };
}

export async function fetchPatientIdentity(patientId: string): Promise<PatientIdentity | null> {
  const id = patientId?.trim();
  if (!id) return null;
  const { data, error } = await supabase.from("patients").select(COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toIdentity(data as Record<string, unknown>);
}

export function usePatientIdentity(patientId: string | null | undefined) {
  const [identity, setIdentity] = useState<PatientIdentity | null>(null);
  const [loading, setLoading] = useState(Boolean(patientId?.trim()));

  const refresh = useCallback(async () => {
    const id = patientId?.trim();
    if (!id) {
      setIdentity(null);
      setLoading(false);
      return;
    }
    const next = await fetchPatientIdentity(id);
    setIdentity(next);
    setLoading(false);
  }, [patientId]);

  // State is only touched after the query resolves, so mounting a banner does not
  // cascade a render.
  useEffect(() => {
    let cancelled = false;
    const id = patientId?.trim();
    if (!id) return;
    void (async () => {
      const next = await fetchPatientIdentity(id);
      if (cancelled) return;
      setIdentity(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return { identity, loading, refresh };
}
