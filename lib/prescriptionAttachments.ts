import { supabase } from "@/lib/supabase";

export type CompletedLabOcrRow = {
  ocr_upload_id: string;
  investigation_id: string | null;
  display_name: string;
  report_date_label: string;
};

export type PrescriptionAttachmentRow = {
  id: string;
  encounter_id: string;
  ocr_upload_id: string;
  investigation_id: string | null;
  display_name: string | null;
  include_in_whatsapp: boolean;
  include_in_print: boolean;
};

export type LabResultEntryLite = {
  parameter_name: string | null;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  ref_range_text: string | null;
  /** When present, row may print bold/red as abnormal/critical. */
  is_abnormal?: boolean | null;
};

export type InvestigationPrintMeta = {
  id: string;
  test_name: string | null;
  ordered_at: string | null;
  resulted_at: string | null;
  result_status: string | null;
  ordered_by_label: string | null;
};

function formatReportDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.trim().slice(0, 10);
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Completed OCR uploads for investigations tied to this encounter (excludes orphan test uploads). */
export async function fetchCompletedLabOcrForEncounter(
  encounterId: string,
): Promise<{ rows: CompletedLabOcrRow[]; error: string | null }> {
  const eid = encounterId.trim();
  if (!eid) return { rows: [], error: null };

  const { data: invs, error: invErr } = await supabase
    .from("investigations")
    .select("id, test_name, resulted_at")
    .eq("encounter_id", eid);

  if (invErr) return { rows: [], error: invErr.message };
  const invList = (invs ?? []) as { id: string; test_name: string | null; resulted_at: string | null }[];
  const invIds = invList.map((i) => i.id).filter(Boolean);
  if (invIds.length === 0) return { rows: [], error: null };

  const invMeta = new Map(invList.map((i) => [i.id, i]));

  const { data: uploads, error: upErr } = await supabase
    .from("investigation_ocr_uploads")
    .select("id, investigation_id, file_name, doctor_verified_at")
    .in("investigation_id", invIds)
    .eq("ocr_status", "completed");

  if (upErr) return { rows: [], error: upErr.message };

  const rows: CompletedLabOcrRow[] = (uploads ?? []).map((u: Record<string, unknown>) => {
    const id = String(u.id ?? "");
    const iid = u.investigation_id != null ? String(u.investigation_id) : null;
    const inv = iid ? invMeta.get(iid) : undefined;
    const name =
      (inv?.test_name?.trim() || String(u.file_name ?? "").trim() || "Lab report").trim();
    const when = formatReportDate(
      (u.doctor_verified_at as string | null) ?? inv?.resulted_at ?? null,
    );
    return {
      ocr_upload_id: id,
      investigation_id: iid,
      display_name: name,
      report_date_label: when,
    };
  });

  rows.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return { rows, error: null };
}

export async function fetchPrescriptionAttachmentsForEncounter(
  encounterId: string,
): Promise<{ rows: PrescriptionAttachmentRow[]; error: string | null }> {
  const eid = encounterId.trim();
  if (!eid) return { rows: [], error: null };

  const { data, error } = await supabase
    .from("prescription_attachments")
    .select(
      "id, encounter_id, ocr_upload_id, investigation_id, display_name, include_in_whatsapp, include_in_print",
    )
    .eq("encounter_id", eid);

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as PrescriptionAttachmentRow[], error: null };
}

export async function fetchLabResultEntriesForOcrUploads(
  ocrUploadIds: string[],
): Promise<{ byUploadId: Record<string, LabResultEntryLite[]>; error: string | null }> {
  const ids = [...new Set(ocrUploadIds.map((x) => x.trim()).filter(Boolean))];
  if (ids.length === 0) return { byUploadId: {}, error: null };

  const { data, error } = await supabase
    .from("lab_result_entries")
    .select("ocr_upload_id, parameter_name, value_numeric, value_text, unit, ref_range_text, is_abnormal")
    .in("ocr_upload_id", ids);

  if (error) return { byUploadId: {}, error: error.message };

  const byUploadId: Record<string, LabResultEntryLite[]> = {};
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const ouid = row.ocr_upload_id != null ? String(row.ocr_upload_id) : "";
    if (!ouid) continue;
    if (!byUploadId[ouid]) byUploadId[ouid] = [];
    byUploadId[ouid].push({
      parameter_name: row.parameter_name != null ? String(row.parameter_name) : null,
      value_numeric: typeof row.value_numeric === "number" ? row.value_numeric : null,
      value_text: row.value_text != null ? String(row.value_text) : null,
      unit: row.unit != null ? String(row.unit) : null,
      ref_range_text: row.ref_range_text != null ? String(row.ref_range_text) : null,
      is_abnormal: row.is_abnormal === true ? true : row.is_abnormal === false ? false : null,
    });
  }

  return { byUploadId, error: null };
}

/** Latest line per parameter_name per investigation (for prescription print attachment). */
export async function fetchLabResultEntriesForInvestigationIds(
  investigationIds: string[],
): Promise<{ byInvestigationId: Record<string, LabResultEntryLite[]>; error: string | null }> {
  const ids = [...new Set(investigationIds.map((x) => x.trim()).filter(Boolean))];
  if (ids.length === 0) return { byInvestigationId: {}, error: null };

  const { data, error } = await supabase
    .from("lab_result_entries")
    .select(
      "investigation_id, parameter_name, value_numeric, value_text, unit, ref_range_text, is_abnormal, created_at",
    )
    .in("investigation_id", ids)
    .order("created_at", { ascending: false });

  if (error) return { byInvestigationId: {}, error: error.message };

  const acc: Record<string, Map<string, LabResultEntryLite>> = {};
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const iid = row.investigation_id != null ? String(row.investigation_id) : "";
    if (!iid) continue;
    if (!acc[iid]) acc[iid] = new Map();
    const nameKey = (row.parameter_name != null ? String(row.parameter_name) : "").trim() || "__unnamed";
    const entry: LabResultEntryLite = {
      parameter_name: row.parameter_name != null ? String(row.parameter_name) : null,
      value_numeric: typeof row.value_numeric === "number" ? row.value_numeric : null,
      value_text: row.value_text != null ? String(row.value_text) : null,
      unit: row.unit != null ? String(row.unit) : null,
      ref_range_text: row.ref_range_text != null ? String(row.ref_range_text) : null,
      is_abnormal: row.is_abnormal === true ? true : row.is_abnormal === false ? false : null,
    };
    if (!acc[iid].has(nameKey)) acc[iid].set(nameKey, entry);
  }

  const byInvestigationId: Record<string, LabResultEntryLite[]> = {};
  for (const iid of Object.keys(acc)) {
    byInvestigationId[iid] = Array.from(acc[iid].values());
  }
  return { byInvestigationId, error: null };
}

export async function fetchInvestigationPrintMetaForIds(
  investigationIds: string[],
): Promise<{ byId: Record<string, InvestigationPrintMeta>; error: string | null }> {
  const ids = [...new Set(investigationIds.map((x) => x.trim()).filter(Boolean))];
  if (ids.length === 0) return { byId: {}, error: null };

  const { data: invs, error } = await supabase
    .from("investigations")
    .select("id, test_name, ordered_at, resulted_at, result_status, doctor_id")
    .in("id", ids);

  if (error) return { byId: {}, error: error.message };

  const doctorIds = [
    ...new Set(
      (invs ?? [])
        .map((r) => (r as { doctor_id?: string | null }).doctor_id)
        .filter((x): x is string => Boolean(x && String(x).trim())),
    ),
  ];

  const prMap = new Map<string, { first_name: string | null; last_name: string | null; full_name: string | null }>();
  if (doctorIds.length > 0) {
    const { data: prs } = await supabase
      .from("practitioners")
      .select("id, first_name, last_name, full_name")
      .in("id", doctorIds);
    for (const p of prs ?? []) {
      const row = p as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        full_name: string | null;
      };
      prMap.set(String(row.id), row);
    }
  }

  const byId: Record<string, InvestigationPrintMeta> = {};
  for (const raw of invs ?? []) {
    const r = raw as {
      id: string;
      test_name: string | null;
      ordered_at: string | null;
      resulted_at: string | null;
      result_status: string | null;
      doctor_id: string | null;
    };
    let ordered_by_label: string | null = null;
    if (r.doctor_id) {
      const pr = prMap.get(String(r.doctor_id));
      if (pr) {
        const fn = (pr.full_name ?? "").trim();
        if (fn) ordered_by_label = fn;
        else {
          const parts = [pr.first_name, pr.last_name].filter((x) => (x ?? "").trim());
          ordered_by_label = parts.length ? parts.join(" ") : null;
        }
      }
    }
    byId[r.id] = {
      id: r.id,
      test_name: r.test_name,
      ordered_at: r.ordered_at,
      resulted_at: r.resulted_at,
      result_status: r.result_status,
      ordered_by_label,
    };
  }
  return { byId, error: null };
}

function formatEntryLine(e: LabResultEntryLite): string {
  const name = (e.parameter_name ?? "").trim() || "—";
  const val =
    e.value_text?.trim() ||
    (e.value_numeric != null && Number.isFinite(e.value_numeric) ? String(e.value_numeric) : "");
  const u = (e.unit ?? "").trim();
  const ref = (e.ref_range_text ?? "").trim();
  const valuePart = [val, u].filter(Boolean).join(" ");
  const tail = ref ? ` (Ref: ${ref})` : "";
  return valuePart ? `${name}: ${valuePart}${tail}` : `${name}${tail}`;
}

/** Plain-text block for WhatsApp; sections per report. */
export function buildLabSummaryText(
  items: { displayName: string; entries: LabResultEntryLite[] }[],
): string {
  const parts: string[] = [];
  for (const it of items) {
    if (it.entries.length === 0) continue;
    parts.push(`*${it.displayName}*`);
    for (const e of it.entries) {
      const line = formatEntryLine(e);
      if (line.trim()) parts.push(`• ${line}`);
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

export async function replacePrescriptionAttachmentsForEncounter(opts: {
  encounterId: string;
  patientId: string;
  hospitalId: string | null;
  userId: string;
  /** Checked rows to persist */
  attachments: Array<{
    investigation_id: string | null;
    ocr_upload_id: string;
    display_name: string;
    include_in_whatsapp: boolean;
    include_in_print: boolean;
  }>;
}): Promise<{ error: string | null }> {
  const eid = opts.encounterId.trim();
  const pid = opts.patientId.trim();
  if (!eid || !pid) return { error: "Missing encounter or patient." };

  const { error: delErr } = await supabase.from("prescription_attachments").delete().eq("encounter_id", eid);
  if (delErr) return { error: delErr.message };

  const rows = opts.attachments.filter((a) => a.ocr_upload_id.trim());
  if (rows.length === 0) return { error: null };

  const insertPayload = rows.map((a) => ({
    encounter_id: eid,
    patient_id: pid,
    hospital_id: opts.hospitalId?.trim() || null,
    investigation_id: a.investigation_id?.trim() || null,
    ocr_upload_id: a.ocr_upload_id.trim(),
    display_name: a.display_name.trim() || null,
    include_in_whatsapp: a.include_in_whatsapp,
    include_in_print: a.include_in_print,
    created_by: opts.userId,
  }));

  const { error: insErr } = await supabase.from("prescription_attachments").insert(insertPayload);
  if (insErr) return { error: insErr.message };
  return { error: null };
}
