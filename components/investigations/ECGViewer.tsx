"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Upload } from "lucide-react";

const DIGITIZER_URL =
  process.env.NEXT_PUBLIC_ECG_DIGITIZER_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

type DigitizeCalibration = {
  px_per_mm?: number | null;
  ms_per_px?: number | null;
  mv_per_px?: number | null;
  paper_speed_mm_s?: number | null;
  gain_mm_per_mv?: number | null;
};

type DigitizeSuccess = {
  samples: number[];
  calibration: DigitizeCalibration | null;
};

type EcgVisionResult = {
  heart_rate_bpm: number | null;
  pr_interval_ms: number | null;
  qrs_duration_ms: number | null;
  qt_interval_ms: number | null;
  qtc_interval_ms: number | null;
  axis: string | null;
  rhythm_interpretation: string | null;
  footer: {
    speed_mm_per_sec: string | null;
    limb_gain_mm_per_mv: string | null;
    chest_gain_mm_per_mv: string | null;
    raw_footer_text: string | null;
  };
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf("base64,");
      resolve(i >= 0 ? s.slice(i + 7) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function rhythmSeverity(
  text: string | null,
): "normal" | "abnormal" | "critical" | "unknown" {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return "unknown";
  if (
    /\b(critical|vf|vt\b|ventricular fibrillation|asystole|pea|tamponade|hyperkalem|stemi)\b/i.test(
      t,
    )
  ) {
    return "critical";
  }
  if (
    /\b(normal|sinus|nsr|sr\b)\b/i.test(t) &&
    !/\b(abnormal|borderline)\b/i.test(t)
  ) {
    return "normal";
  }
  if (
    /\b(abnormal|afib|a\.fib|flutter|bundle|block|brady|tachy|isch|elev|depress|pvc|pac)\b/i.test(
      t,
    )
  ) {
    return "abnormal";
  }
  return "abnormal";
}

function rhythmBadgeClass(sev: ReturnType<typeof rhythmSeverity>): string {
  switch (sev) {
    case "normal":
      return "bg-emerald-100 text-emerald-900 border-emerald-300";
    case "critical":
      return "bg-red-100 text-red-900 border-red-300";
    case "unknown":
      return "bg-neutral-100 text-neutral-600 border-neutral-200";
    default:
      return "bg-amber-100 text-amber-900 border-amber-300";
  }
}

function EcgStripSkeleton() {
  return (
    <div className="w-full space-y-3">
      <div className="h-[220px] w-full animate-pulse rounded-lg border border-neutral-200 bg-neutral-100" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100" />
        <div className="h-48 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100" />
      </div>
    </div>
  );
}

type EcgWaveformStripProps = {
  samples: number[];
  msPerPx?: number | null;
  mvPerPx?: number | null;
};

function EcgWaveformStrip({ samples, msPerPx, mvPerPx }: EcgWaveformStripProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(Math.max(320, Math.floor(el.getBoundingClientRect().width)));
    });
    ro.observe(el);
    setWidth(Math.max(320, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length < 2) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const h = 220;
    const w = width;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    const bg = "#ffffff";
    const minor = "rgba(220, 100, 120, 0.35)";
    const major = "rgba(200, 60, 80, 0.55)";
    const wave = "#15803d";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const minorStep = 8;
    const majorEvery = 5;
    for (let x = 0; x <= w; x += minorStep) {
      const isMajor = Math.round(x / minorStep) % majorEvery === 0;
      ctx.strokeStyle = isMajor ? major : minor;
      ctx.lineWidth = isMajor ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += minorStep) {
      const isMajor = Math.round(y / minorStep) % majorEvery === 0;
      ctx.strokeStyle = isMajor ? major : minor;
      ctx.lineWidth = isMajor ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    let arr = samples;
    const finite = arr.filter((v) => Number.isFinite(v));
    if (finite.length < 2) return;
    let min = Math.min(...finite);
    let max = Math.max(...finite);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    const mid = (min + max) / 2;
    const span = Math.max(1e-6, max - min);
    const yScale = (0.82 * h) / span;

    ctx.strokeStyle = wave;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (!Number.isFinite(v)) continue;
      const x = (i / Math.max(1, arr.length - 1)) * w;
      const y = h / 2 - (v - mid) * yScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(15, 23, 42, 0.45)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("ms →", w - 44, h - 6);

    ctx.save();
    ctx.translate(14, h / 2 + 24);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("mV", 0, 0);
    ctx.restore();

    if (msPerPx != null && Number.isFinite(msPerPx) && msPerPx > 0) {
      const totalMs = msPerPx * w;
      ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`0`, 6, h - 22);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(totalMs)} ms`, w - 6, h - 22);
    }
    if (mvPerPx != null && Number.isFinite(mvPerPx) && mvPerPx > 0) {
      const spanMv = mvPerPx * (0.82 * h);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`±${spanMv.toFixed(2)} mV`, 6, 8);
    }
  }, [samples, width, msPerPx, mvPerPx]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="pointer-events-none absolute left-3 top-2 z-10 font-mono text-[10px] tracking-wide text-neutral-500">
        LEAD II — CONTINUOUS RHYTHM STRIP
      </div>
      <canvas ref={canvasRef} className="block w-full rounded-lg border border-neutral-200 bg-white" />
    </div>
  );
}

export function ECGViewer({
  investigationId,
  imageUrl,
}: {
  investigationId: string;
  imageUrl: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [digitize, setDigitize] = useState<DigitizeSuccess | null>(null);
  const [vision, setVision] = useState<EcgVisionResult | null>(null);
  const [digitizeError, setDigitizeError] = useState<string | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const effectiveImageUrl = imageUrl?.trim() || "";

  const run = useCallback(async () => {
    setLoading(true);
    setDigitizeError(null);
    setVisionError(null);
    setDigitize(null);
    setVision(null);

    const hasLocal = localFile != null;
    const hasRemote = effectiveImageUrl.length > 0;

    if (!hasLocal && !hasRemote) {
      setLoading(false);
      setDigitizeError("No ECG image.");
      setVisionError("No ECG image.");
      return;
    }

    const digitizePromise = (async (): Promise<
      { ok: true; data: DigitizeSuccess } | { ok: false; error: string }
    > => {
      const fd = new FormData();
      if (hasLocal && localFile) {
        fd.append("file", localFile);
      } else {
        const imgRes = await fetch(effectiveImageUrl, { cache: "no-store" });
        if (!imgRes.ok) {
          return { ok: false, error: `Image download failed (${imgRes.status}).` };
        }
        const blob = await imgRes.blob();
        const ct = imgRes.headers.get("content-type") || "image/jpeg";
        fd.append("file", new File([blob], "ecg.jpg", { type: ct }));
      }

      const res = await fetch(`${DIGITIZER_URL}/digitize`, { method: "POST", body: fd });
      const json = (await res.json()) as {
        lead_II?: Array<{ x: number; y: number }>;
        calibration?: DigitizeCalibration | null;
        detail?: string | string[];
      };
      if (!res.ok) {
        const detail = json.detail;
        const msg = Array.isArray(detail)
          ? detail.join(", ")
          : typeof detail === "string"
            ? detail
            : `Digitizer error (${res.status})`;
        return { ok: false, error: msg };
      }
      const pts = json.lead_II ?? [];
      if (pts.length < 2) {
        return { ok: false, error: "No waveform extracted." };
      }
      const samples = pts.map((p) => p.y);
      return {
        ok: true,
        data: {
          samples,
          calibration: json.calibration ?? null,
        },
      };
    })();

    const visionPromise = (async (): Promise<{ analysis: EcgVisionResult } | { error: string }> => {
      let body: Record<string, unknown>;
      if (hasLocal && localFile) {
        const b64 = await fileToBase64(localFile);
        body = {
          imageBase64: b64,
          mimeType: localFile.type || "image/jpeg",
          investigationId,
        };
      } else {
        body = { imageUrl: effectiveImageUrl, investigationId };
      }
      const res = await fetch("/api/ecg/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { analysis?: EcgVisionResult; error?: string };
      if (!res.ok || !json.analysis) {
        return { error: json.error || `Vision error (${res.status})` };
      }
      return { analysis: json.analysis };
    })();

    const [dRes, vRes] = await Promise.all([digitizePromise, visionPromise]);

    if (dRes.ok) {
      setDigitizeError(null);
      setDigitize(dRes.data);
    } else {
      setDigitizeError(dRes.error);
      setDigitize(null);
    }

    if ("error" in vRes) setVisionError(vRes.error);
    else setVision(vRes.analysis);

    setLoading(false);
  }, [effectiveImageUrl, investigationId, localFile]);

  useEffect(() => {
    void run();
  }, [run]);

  const samples = digitize?.samples ?? [];
  const cal = digitize?.calibration ?? null;

  const msPerPx = useMemo(() => {
    if (cal?.ms_per_px != null && Number.isFinite(cal.ms_per_px)) return cal.ms_per_px;
    if (cal?.px_per_mm != null && cal?.paper_speed_mm_s != null) {
      const px = cal.px_per_mm;
      const v = cal.paper_speed_mm_s;
      if (px > 0 && v > 0) return 1000 / (px * v);
    }
    return null;
  }, [cal]);

  const mvPerPx = useMemo(() => {
    if (cal?.mv_per_px != null && Number.isFinite(cal.mv_per_px)) return cal.mv_per_px;
    if (cal?.px_per_mm != null && cal?.gain_mm_per_mv != null) {
      const px = cal.px_per_mm;
      const g = cal.gain_mm_per_mv;
      if (px > 0 && g > 0) return 1 / (px * g);
    }
    return null;
  }, [cal]);

  const hr = vision?.heart_rate_bpm;
  const hrAlert =
    typeof hr === "number" && (hr > 100 || hr < 60);

  const rhythmSev = rhythmSeverity(vision?.rhythm_interpretation ?? null);
  const rhythmBadgeStyle = rhythmBadgeClass(rhythmSev);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setLocalFile(f);
    e.target.value = "";
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">ECG digitization</h3>
          <p className="text-xs text-neutral-600">
            Waveform from the digitizer service; intervals and footer text from the vision model.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickFile}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
        </div>
      </div>

      {loading ? (
        <EcgStripSkeleton />
      ) : (
        <>
          {samples.length >= 2 ? (
            <EcgWaveformStrip samples={samples} msPerPx={msPerPx} mvPerPx={mvPerPx} />
          ) : (
            <div className="flex h-[220px] w-full items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-600">
              {digitizeError || "No waveform extracted."}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-3 font-mono text-[10px] font-semibold tracking-wider text-neutral-500">
                ECG METRICS
              </div>
              {visionError ? (
                <p className="text-sm text-red-600">{visionError}</p>
              ) : vision ? (
                <>
                  <div
                    className={`mb-4 text-4xl font-bold tabular-nums ${
                      hrAlert ? "text-red-600" : "text-neutral-900"
                    }`}
                  >
                    {typeof hr === "number" && Number.isFinite(hr) ? `${Math.round(hr)}` : "—"}{" "}
                    <span className="text-lg font-semibold text-neutral-500">bpm</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-neutral-500">PR interval</div>
                      <div className="font-mono tabular-nums text-neutral-900">
                        {vision.pr_interval_ms != null ? `${Math.round(vision.pr_interval_ms)} ms` : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-neutral-500">QRS duration</div>
                      <div className="font-mono tabular-nums text-neutral-900">
                        {vision.qrs_duration_ms != null
                          ? `${Math.round(vision.qrs_duration_ms)} ms`
                          : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-neutral-500">QT</div>
                      <div className="font-mono tabular-nums text-neutral-900">
                        {vision.qt_interval_ms != null
                          ? `${Math.round(vision.qt_interval_ms)} ms`
                          : "—"}
                      </div>
                    </div>
                    <div className="rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-neutral-500">QTc</div>
                      <div className="font-mono tabular-nums text-neutral-900">
                        {vision.qtc_interval_ms != null
                          ? `${Math.round(vision.qtc_interval_ms)} ms`
                          : "—"}
                      </div>
                    </div>
                    <div className="col-span-2 rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-neutral-500">Axis</div>
                      <div className="text-sm text-neutral-900">
                        {vision.axis?.trim() ? vision.axis : "—"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] uppercase text-neutral-500">Rhythm</div>
                    <span
                      className={`mt-1 inline-flex max-w-full rounded-full border px-2.5 py-1 text-[11px] font-medium leading-snug ${rhythmBadgeStyle}`}
                    >
                      {vision.rhythm_interpretation?.trim() || "—"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-neutral-600">No analysis.</p>
              )}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-[10px] font-semibold tracking-wider text-neutral-500">
                  TECHNICAL PARAMETERS
                </div>
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                  Unconfirmed — AI assisted
                </span>
              </div>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-2 border-b border-neutral-100 py-1">
                  <dt className="text-neutral-500">Speed</dt>
                  <dd className="font-mono text-neutral-900">
                    {vision?.footer.speed_mm_per_sec?.trim()
                      ? vision.footer.speed_mm_per_sec
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-neutral-100 py-1">
                  <dt className="text-neutral-500">Limb gain</dt>
                  <dd className="font-mono text-neutral-900">
                    {vision?.footer.limb_gain_mm_per_mv?.trim()
                      ? vision.footer.limb_gain_mm_per_mv
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-neutral-100 py-1">
                  <dt className="text-neutral-500">Chest gain</dt>
                  <dd className="font-mono text-neutral-900">
                    {vision?.footer.chest_gain_mm_per_mv?.trim()
                      ? vision.footer.chest_gain_mm_per_mv
                      : "—"}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Calibration
              </div>
              <dl className="mt-1 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-500">px/mm</dt>
                  <dd className="font-mono tabular-nums text-neutral-900">
                    {cal?.px_per_mm != null && Number.isFinite(cal.px_per_mm)
                      ? cal.px_per_mm.toFixed(4)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-500">ms/px</dt>
                  <dd className="font-mono tabular-nums text-neutral-900">
                    {msPerPx != null ? msPerPx.toFixed(4) : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-500">mV/px</dt>
                  <dd className="font-mono tabular-nums text-neutral-900">
                    {mvPerPx != null ? mvPerPx.toFixed(6) : "—"}
                  </dd>
                </div>
              </dl>
              {vision?.footer.raw_footer_text?.trim() ? (
                <p className="mt-3 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-neutral-500">
                  {vision.footer.raw_footer_text}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
