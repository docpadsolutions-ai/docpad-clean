"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CLINICAL_ATTACHMENTS_BUCKET } from "@/lib/clinicalAttachmentsConstants";
import { cn } from "@/lib/utils";
import ClinicalAttachmentPreviewOverlay from "@/components/clinical-attachments/ClinicalAttachmentPreviewOverlay";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export type ClinicalAttachmentRow = Record<string, unknown>;

function isPdfRow(row: ClinicalAttachmentRow): boolean {
  const m = s(row.mime_type).toLowerCase();
  return m === "application/pdf" || s(row.file_name).toLowerCase().endsWith(".pdf");
}

export default function ClinicalAttachmentThumbnailStrip({
  rows,
  className,
  emptyHint,
}: {
  rows: ClinicalAttachmentRow[];
  className?: string;
  emptyHint?: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ row: ClinicalAttachmentRow; url: string } | null>(null);

  const loadUrls = useCallback(async () => {
    const next: Record<string, string> = {};
    for (const row of rows) {
      const id = s(row.id);
      const path = s(row.storage_path);
      if (!id || !path) continue;
      const { data, error } = await supabase.storage.from(CLINICAL_ATTACHMENTS_BUCKET).createSignedUrl(path, 3600);
      if (!error && data?.signedUrl) next[id] = data.signedUrl;
    }
    setUrls(next);
  }, [rows]);

  useEffect(() => {
    void loadUrls();
  }, [loadUrls]);

  if (rows.length === 0) {
    return emptyHint ? <p className="text-xs text-gray-500">{emptyHint}</p> : null;
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Attachments</p>
      <div className="flex gap-2 overflow-x-auto pb-1 pt-0.5">
        {rows.map((row) => {
          const id = s(row.id);
          const url = urls[id];
          const pdf = isPdfRow(row);
          const name = s(row.file_name) || "File";
          const ctx = s(row.clinical_context);
          return (
            <button
              key={id || name}
              type="button"
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm transition hover:ring-2 hover:ring-blue-400/80"
              title={ctx || name}
              onClick={() => {
                if (url) setPreview({ row, url });
              }}
            >
              {pdf ? (
                <span className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>
                  📄
                </span>
              ) : url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">…</span>
              )}
            </button>
          );
        })}
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
    </div>
  );
}
