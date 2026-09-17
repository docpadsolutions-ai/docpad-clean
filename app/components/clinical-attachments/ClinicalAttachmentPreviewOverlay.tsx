"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function ClinicalAttachmentPreviewOverlay({
  open,
  title,
  imageUrl,
  isPdf,
  note,
  onClose,
}: {
  open: boolean;
  title: string;
  imageUrl: string | null;
  isPdf: boolean;
  note: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 text-white">
        <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/90 hover:bg-white/10"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {isPdf ? (
          <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-4 text-center text-white">
            <p className="text-5xl" aria-hidden>
              📄
            </p>
            <a
              href={imageUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
            >
              Open PDF
            </a>
          </div>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL preview
          <img src={imageUrl} alt={title} className="mx-auto max-h-[calc(100vh-8rem)] max-w-full object-contain" />
        ) : (
          <p className="text-center text-sm text-white/80">Preview unavailable.</p>
        )}
        {note?.trim() ? (
          <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm text-white/90">{note.trim()}</p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
