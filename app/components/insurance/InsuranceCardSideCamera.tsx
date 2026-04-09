"use client";

import { Camera, ImagePlus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  label: string;
  description?: string;
  imageBlob: Blob | null;
  imageUrl: string | null;
  onCapture: (blob: Blob) => void;
  onClear: () => void;
};

export function InsuranceCardSideCamera({ label, description, imageBlob, imageUrl, onCapture, onClear }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const startCamera = useCallback(async () => {
    setError(null);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOpen(true);
    } catch {
      setError("Camera unavailable. Use gallery upload.");
    }
  }, [stopStream]);

  const snap = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.videoWidth < 2) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(blob);
          setCameraOpen(false);
          stopStream();
        }
      },
      "image/jpeg",
      0.92,
    );
  }, [onCapture, stopStream]);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !f.type.startsWith("image/")) return;
      onCapture(f);
      setCameraOpen(false);
      stopStream();
    },
    [onCapture, stopStream],
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{label}</p>
          {description ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}
        </div>
        {imageBlob ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-slate-500" onClick={onClear} aria-label="Remove image">
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {imageUrl ? (
        <div className="relative mt-3 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-600">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="max-h-56 w-full object-contain bg-slate-50 dark:bg-slate-950" />
        </div>
      ) : null}

      {cameraOpen ? (
        <div className="mt-3 space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="max-h-64 w-full object-contain" playsInline muted />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute right-2 top-2 bg-white/90"
              onClick={() => {
                setCameraOpen(false);
                stopStream();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Button type="button" className="w-full" onClick={snap}>
            Capture
          </Button>
        </div>
      ) : !imageBlob ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="default" size="sm" onClick={startCamera}>
            <Camera className="mr-2 h-4 w-4" />
            Use camera
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              <ImagePlus className="mr-2 inline h-4 w-4 align-middle" />
              Gallery
              <input type="file" accept="image/*" className="hidden" onChange={onFile} />
            </label>
          </Button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{error}</p> : null}
    </div>
  );
}
