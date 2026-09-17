"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getUploaderPractitionerId } from "@/components/clinical-attachments/getUploaderPractitionerId";
import ClinicalAttachmentModal from "@/components/clinical-attachments/ClinicalAttachmentModal";
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

function ymdFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export default function IpdClinicalAttachmentsSection({
  hospitalId,
  patientId,
  admissionId,
}: {
  hospitalId: string;
  patientId: string;
  admissionId: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [uploaderId, setUploaderId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ row: Row; url: string } | null>(null);

  const load = useCallback(async () => {
    const hid = hospitalId.trim();
    const pid = patientId.trim();
    const aid = admissionId.trim();
    if (!hid || !pid || !aid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("clinical_attachments")
      .select("*")
      .eq("ipd_admission_id", aid)
      .order("uploaded_at", { ascending: false });
    setLoading(false);
    if (error) {
      setErr(error.message);
      setRows([]);
      return;
    }
    const list = (data ?? []) as Row[];
    setRows(list);
    const ids = [...new Set(list.map((r) => s(r.uploaded_by)).filter(Boolean))];
    if (ids.length > 0) {
      const { data: prs } = await supabase.from("practitioners").select("id, full_name").in("id", ids);
      const m: Record<string, string> = {};
      if (prs) {
        for (const p of prs as { id?: unknown; full_name?: unknown }[]) {
          m[s(p.id)] = s(p.full_name) || "—";
        }
      }
      setNames(m);
    } else {
      setNames({});
    }
  }, [hospitalId, patientId, admissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const id = await getUploaderPractitionerId(supabase);
      setUploaderId(id);
    })();
  }, []);

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

  const byDate = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const day = ymdFromIso(s(r.uploaded_at));
      const list = map.get(day) ?? [];
      list.push(r);
      map.set(day, list);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-bold text-foreground">Attachments</h2>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          title="Add clinical image"
          onClick={() => setModalOpen(true)}
        >
          <span aria-hidden>📎</span>
          Attach
        </button>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : err ? (
        <p className="mt-4 text-sm text-destructive">{err}</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No attachments for this admission yet.</p>
      ) : (
        <ul className="mt-4 space-y-6">
          {byDate.map(([day, dayRows]) => (
            <li key={day}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{day}</p>
              <ul className="mt-2 space-y-3">
                {dayRows.map((row) => {
                  const id = s(row.id);
                  const url = thumbUrls[id];
                  const pdf = isPdfRow(row);
                  const by = names[s(row.uploaded_by)] ?? "—";
                  const t = s(row.uploaded_at);
                  const timeLabel = t ? new Date(t).toLocaleString() : "—";
                  return (
                    <li
                      key={id}
                      className="flex gap-3 rounded-xl border border-border bg-background p-3 text-sm shadow-sm"
                    >
                      <button
                        type="button"
                        className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
                        onClick={() => url && setPreview({ row, url })}
                      >
                        {pdf ? (
                          <span className="flex h-full w-full items-center justify-center text-2xl">📄</span>
                        ) : url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">…</span>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{s(row.file_name) || "Attachment"}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {timeLabel} · {by}
                        </p>
                        {s(row.body_region) ? (
                          <p className="mt-1 text-xs text-foreground">
                            <span className="text-muted-foreground">Region: </span>
                            {s(row.body_region)}
                          </p>
                        ) : null}
                        {s(row.clinical_context) ? (
                          <p className="mt-1 line-clamp-3 text-xs text-foreground">{s(row.clinical_context)}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ClinicalAttachmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        hospitalId={hospitalId}
        patientId={patientId}
        uploadedByPractitionerId={uploaderId}
        opdEncounterId={null}
        ipdAdmissionId={admissionId}
        onSuccess={() => void load()}
      />

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
    </div>
  );
}
