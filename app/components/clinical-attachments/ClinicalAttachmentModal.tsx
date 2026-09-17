"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import {
  CLINICAL_ATTACHMENTS_BUCKET,
  CLINICAL_ATTACHMENT_INPUT_ACCEPT,
  CLINICAL_ATTACHMENT_MAX_BYTES,
  extensionForUpload,
  isAcceptedClinicalAttachmentMime,
} from "../../lib/clinicalAttachmentsConstants";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type ClinicalAttachmentModalProps = {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  patientId: string;
  uploadedByPractitionerId: string | null;
  opdEncounterId: string | null;
  ipdAdmissionId: string | null;
  onSuccess: () => void;
};

export default function ClinicalAttachmentModal({
  open,
  onClose,
  hospitalId,
  patientId,
  uploadedByPractitionerId,
  opdEncounterId,
  ipdAdmissionId,
  onSuccess,
}: ClinicalAttachmentModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [bodyRegion, setBodyRegion] = useState("");
  const [note, setNote] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStagedFile(null);
    setPreviewUrl(null);
    setBodyRegion("");
    setNote("");
    setUploadProgress(0);
    setBusy(false);
    setError(null);
    setCameraMode(false);
    setCameraError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    reset();
  }, [open, hospitalId, patientId, reset]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [previewUrl]);

  function validateFile(file: File): string | null {
    if (file.size > CLINICAL_ATTACHMENT_MAX_BYTES) {
      return `File must be at most ${Math.round(CLINICAL_ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB.`;
    }
    const mime = (file.type || "").toLowerCase();
    if (mime && isAcceptedClinicalAttachmentMime(mime)) return null;
    const low = file.name.toLowerCase();
    if (low.endsWith(".heic") || low.endsWith(".pdf")) return null;
    return "Use JPEG, PNG, HEIC, WebP, or PDF.";
  }

  function stageFile(file: File) {
    setError(null);
    const err = validateFile(file);
    if (err) {
      setError(err);
      return;
    }
    setStagedFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
    setCameraMode(false);
    stopCamera();
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startCamera() {
    setCameraError(null);
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraMode(true);
      requestAnimationFrame(() => {
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          void el.play().catch(() => {});
        }
      });
    } catch {
      setCameraError("Camera not available or permission denied.");
    }
  }

  function capturePhoto() {
    const v = videoRef.current;
    if (!v || v.videoWidth <= 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const f = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        stopCamera();
        setCameraMode(false);
        stageFile(f);
      },
      "image/jpeg",
      0.92,
    );
  }

  async function upload() {
    const hid = hospitalId.trim();
    const pid = patientId.trim();
    if (!hid || !pid) {
      setError("Missing hospital or patient.");
      return;
    }
    if (!stagedFile) {
      setError("Choose a file first.");
      return;
    }
    if (!uploadedByPractitionerId?.trim()) {
      setError("Your practitioner profile is missing; cannot record uploader.");
      return;
    }
    const err = validateFile(stagedFile);
    if (err) {
      setError(err);
      return;
    }

    setBusy(true);
    setError(null);
    setUploadProgress(8);

    const ext = extensionForUpload(stagedFile.name, stagedFile.type || "image/jpeg");
    const objectPath = `${hid}/${pid}/${newId()}.${ext}`;
    const mime = stagedFile.type || (ext === "pdf" ? "application/pdf" : "image/jpeg");

    try {
      setUploadProgress(25);
      const { error: upErr } = await supabase.storage.from(CLINICAL_ATTACHMENTS_BUCKET).upload(objectPath, stagedFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: mime,
      });
      if (upErr) throw upErr;
      setUploadProgress(65);

      const attachmentType = mime === "application/pdf" ? "document" : "image";
      const { error: insErr } = await supabase.from("clinical_attachments").insert({
        hospital_id: hid,
        patient_id: pid,
        opd_encounter_id: opdEncounterId?.trim() || null,
        ipd_admission_id: ipdAdmissionId?.trim() || null,
        uploaded_by: uploadedByPractitionerId.trim(),
        storage_path: objectPath,
        file_name: stagedFile.name,
        file_size_bytes: stagedFile.size,
        mime_type: mime,
        attachment_type: attachmentType,
        body_region: bodyRegion.trim() || null,
        clinical_context: note.trim().slice(0, 200) || null,
        fhir_json: null,
      });
      if (insErr) throw insErr;
      setUploadProgress(100);
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const isPdfStaged =
    stagedFile && (stagedFile.type === "application/pdf" || stagedFile.name.toLowerCase().endsWith(".pdf"));

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clinical-attachment-modal-title"
      onClick={() => !busy && onClose()}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 id="clinical-attachment-modal-title" className="text-base font-bold text-gray-900">
            Add clinical attachment
          </h2>
        </div>

        <div className="space-y-4 px-4 py-4">
          {!stagedFile && !cameraMode ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="flex min-h-[100px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 px-4 py-6 text-center transition hover:border-blue-400 hover:bg-blue-50"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="text-3xl" aria-hidden>
                  📁
                </span>
                <span className="text-sm font-semibold text-gray-900">Upload from Device</span>
                <span className="text-[11px] text-gray-500">Images or PDF · max 10MB</span>
              </button>
              <button
                type="button"
                className="flex min-h-[100px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/50 px-4 py-6 text-center transition hover:border-emerald-400 hover:bg-emerald-50"
                onClick={() => void startCamera()}
              >
                <span className="text-3xl" aria-hidden>
                  📷
                </span>
                <span className="text-sm font-semibold text-gray-900">Use Camera</span>
                <span className="text-[11px] text-gray-500">Mobile-friendly</span>
              </button>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={CLINICAL_ATTACHMENT_INPUT_ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) stageFile(f);
            }}
          />

          {cameraError ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-950">{cameraError}</p> : null}

          {cameraMode ? (
            <div className="space-y-2">
              <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black object-cover" playsInline muted />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={capturePhoto} disabled={busy}>
                  Capture
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    stopCamera();
                    setCameraMode(false);
                  }}
                >
                  Cancel camera
                </Button>
              </div>
            </div>
          ) : null}

          {stagedFile ? (
            <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/80 p-3">
              <p className="text-xs font-medium text-gray-700">{stagedFile.name}</p>
              <div className="flex max-h-48 items-center justify-center overflow-hidden rounded-lg bg-white">
                {isPdfStaged ? (
                  <span className="py-8 text-5xl" aria-hidden>
                    📄
                  </span>
                ) : previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="" className="max-h-48 w-full object-contain" />
                ) : null}
              </div>
              <div>
                <Label className="text-[10px] uppercase text-gray-500">Body region (optional)</Label>
                <Input className="mt-1 h-9 text-sm" value={bodyRegion} onChange={(e) => setBodyRegion(e.target.value)} placeholder="e.g. Right knee" />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-gray-500">Note (optional, max 200)</Label>
                <Textarea
                  className="mt-1 min-h-[64px] text-sm"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                  placeholder="Clinical context"
                />
                <p className="mt-0.5 text-[10px] text-gray-400">{note.length}/200</p>
              </div>
            </div>
          ) : null}

          {busy ? (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={cn("h-full rounded-full bg-blue-600 transition-all duration-300")}
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-500">Uploading…</p>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            {stagedFile ? (
              <Button type="button" disabled={busy} onClick={() => void upload()}>
                Upload
              </Button>
            ) : null}
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            {stagedFile && !busy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  reset();
                }}
              >
                Choose different file
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
