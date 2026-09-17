"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import ClinicalAttachmentPreviewOverlay from "@/components/clinical-attachments/ClinicalAttachmentPreviewOverlay";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

type Row = Record<string, unknown>;

function isPdfRow(row: Row): boolean {
  const m = s(row.mime_type).toLowerCase();
  return m === "application/pdf" || s(row.file_name).toLowerCase().endsWith(".pdf");
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export default function PatientClinicalImagesSection({
  patientId,
  reloadToken = 0,
}: {
  patientId: string;
  /** Bumped to refetch after uploads elsewhere. */
  reloadToken?: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [opdDates, setOpdDates] = useState<Record<string, string>>({});
  const [ipdDates, setIpdDates] = useState<Record<string, string>>({});
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ row: Row; url: string } | null>(null);

  const load = useCallback(async () => {
    const pid = patientId.trim();
    if (!pid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("clinical_attachments")
      .select("*")
      .eq("patient_id", pid)
      .order("uploaded_at", { ascending: false });
    setLoading(false);
    if (error) {
      setErr(error.message);
      setRows([]);
      return;
    }
    const list = (data ?? []) as Row[];
    setRows(list);

    const opdIds = [...new Set(list.map((r) => s(r.opd_encounter_id)).filter(Boolean))];
    const ipdIds = [...new Set(list.map((r) => s(r.ipd_admission_id)).filter(Boolean))];

    const nextOpd: Record<string, string> = {};
    if (opdIds.length > 0) {
      const { data: enc } = await supabase.from("opd_encounters").select("id, created_at").in("id", opdIds);
      if (enc) {
        for (const e of enc as { id?: unknown; created_at?: unknown }[]) {
          const id = s(e.id);
          const iso = s(e.created_at);
          if (id && iso) {
            const d = new Date(iso);
            if (!Number.isNaN(d.getTime())) nextOpd[id] = ymd(d);
          }
        }
      }
    }
    setOpdDates(nextOpd);

    const nextIpd: Record<string, string> = {};
    if (ipdIds.length > 0) {
      const { data: adm } = await supabase.from("ipd_admissions").select("id, admitted_at").in("id", ipdIds);
      if (adm) {
        for (const a of adm as { id?: unknown; admitted_at?: unknown }[]) {
          const id = s(a.id);
          const iso = s(a.admitted_at);
          if (id && iso) {
            const d = new Date(iso);
            if (!Number.isNaN(d.getTime())) nextIpd[id] = ymd(d);
          }
        }
      }
    }
    setIpdDates(nextIpd);
  }, [patientId, reloadToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        const id = s(row.id);
        const path = s(row.storage_path);
        if (!id || !path) continue;
        const { data, error } = await supabase.storage.from("clinical-attachments").createSignedUrl(path, 3600);
        if (!error && data?.signedUrl) next[id] = data.signedUrl;
      }
      setThumbUrls(next);
    })();
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const oid = s(r.opd_encounter_id);
      const aid = s(r.ipd_admission_id);
      let day: string;
      if (oid && opdDates[oid]) day = opdDates[oid]!;
      else if (aid && ipdDates[aid]) day = ipdDates[aid]!;
      else {
        const u = s(r.uploaded_at);
        const d = u ? new Date(u) : new Date();
        day = Number.isNaN(d.getTime()) ? ymd(new Date()) : ymd(d);
      }
      const list = map.get(day) ?? [];
      list.push(r);
      map.set(day, list);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [rows, opdDates, ipdDates]);

  if (!patientId.trim()) {
    return null;
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </section>
    );
  }

  if (err) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-800">
        {err}
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-4 text-sm text-gray-600">
        No clinical images or documents on file yet.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-sm font-bold text-gray-900">Clinical images & documents</h3>
      <p className="mt-0.5 text-[11px] text-gray-500">All attachments for this patient (newest first).</p>

      <div className="mt-4 space-y-6">
        {grouped.map(([day, dayRows]) => (
          <div key={day}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{day}</p>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dayRows.map((row) => {
                const id = s(row.id);
                const url = thumbUrls[id];
                const pdf = isPdfRow(row);
                const oid = s(row.opd_encounter_id);
                const aid = s(row.ipd_admission_id);
                const badge = oid ? "OPD" : aid ? "IPD" : "—";
                const badgeClass =
                  badge === "OPD"
                    ? "bg-sky-100 text-sky-900 ring-sky-200"
                    : badge === "IPD"
                      ? "bg-violet-100 text-violet-900 ring-violet-200"
                      : "bg-gray-100 text-gray-700 ring-gray-200";
                return (
                  <li
                    key={id}
                    className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50/80 shadow-sm"
                  >
                    <button
                      type="button"
                      className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100"
                      onClick={() => url && setPreview({ row, url })}
                    >
                      {pdf ? (
                        <span className="flex h-full w-full items-center justify-center text-4xl">📄</span>
                      ) : url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs text-gray-400">…</span>
                      )}
                    </button>
                    <div className="p-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${badgeClass}`}>{badge}</span>
                        <span className="text-[11px] text-gray-500">{day}</span>
                      </div>
                      {s(row.body_region) ? (
                        <p className="mt-1 text-xs font-medium text-gray-800">{s(row.body_region)}</p>
                      ) : null}
                      {s(row.clinical_context) ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-gray-600">{s(row.clinical_context)}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {preview ? (
        <ClinicalAttachmentPreviewOverlay
          open
          title={s(preview.row.file_name) || "Attachment"}
          imageUrl={preview.url}
          isPdf={isPdfRow(preview.row)}
          note={s(preview.row.clinical_context) || null}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </section>
  );
}
