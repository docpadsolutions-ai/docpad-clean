"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureJpegForOcrUpload } from "../../lib/ocrImageConvert";
import {
  OCR_MANUAL_DEFAULT_EMPTY_ROWS,
  parameterNamesForOcrManualEntry,
} from "../../lib/labManualEntryTemplates";
import { supabase } from "../../supabase";

export type OCRUploadModalProps = {
  open: boolean;
  onClose: () => void;
  /** When null/empty, upload + OCR run in test mode (no lab_result_entries / investigation update). */
  investigationId: string | null;
  /** When null/empty with test mode, storage path uses `ocr-test-uploads/`. */
  patientId: string | null;
  hospitalId: string;
  uploadedBy: string | null;
  /** investigation.test_name — used to pre-fill manual entry rows (CBC, LFT, etc.). */
  investigationTestName?: string | null;
  onSuccess?: () => void;
};

type StagedFile = {
  id: string;
  file: File;
  previewUrl: string;
  isPdf: boolean;
};

type OcrLine = { text: string; confidence: number };

type TableRow = {
  id: string;
  parameter_name: string;
  result_value: string;
  unit: string;
  reference_range: string;
  confidence: number;
  is_abnormal: boolean;
};

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeFilePart(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 180) || "upload";
}

function normalizeThreshold(v: number | null | undefined, defaultFraction: number): number {
  if (v == null || Number.isNaN(Number(v))) return defaultFraction;
  const n = Number(v);
  if (n > 1) return Math.min(1, Math.max(0, n / 100));
  return Math.min(1, Math.max(0, n));
}

function confidenceBadgeClass(conf: number, manual: number, auto: number): string {
  if (conf < manual) return "bg-red-100 text-red-900 ring-red-200";
  if (conf < auto) return "bg-amber-100 text-amber-950 ring-amber-200";
  return "bg-emerald-100 text-emerald-900 ring-emerald-200";
}

function lineHighlightClass(conf: number, manual: number, auto: number): string {
  if (conf < manual) return "bg-red-50 border-l-4 border-red-400";
  if (conf < auto) return "bg-amber-50 border-l-4 border-amber-400";
  return "bg-emerald-50/60 border-l-4 border-emerald-400";
}

function parseValueForDb(raw: string): { value_numeric: number | null; value_text: string | null } {
  const t = raw.trim();
  if (!t) return { value_numeric: null, value_text: null };
  const n = Number.parseFloat(t.replace(/,/g, ""));
  if (!Number.isNaN(n) && Number.isFinite(n)) {
    return { value_numeric: n, value_text: t };
  }
  return { value_numeric: null, value_text: t };
}

function pct(conf: number): string {
  return `${Math.round(conf * 1000) / 10}%`;
}

const inputCls =
  "w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100";

function emptyTableRow(): TableRow {
  return {
    id: newId(),
    parameter_name: "",
    result_value: "",
    unit: "",
    reference_range: "",
    confidence: 1,
    is_abnormal: false,
  };
}

function manualEntryRowsForTest(testName: string | null | undefined): TableRow[] {
  const names = parameterNamesForOcrManualEntry(testName);
  const list =
    names.length > 0 ? names : Array.from({ length: OCR_MANUAL_DEFAULT_EMPTY_ROWS }, () => "");
  return list.map((parameter_name) => ({
    id: newId(),
    parameter_name,
    result_value: "",
    unit: "",
    reference_range: "",
    confidence: 1,
    is_abnormal: false,
  }));
}

export default function OCRUploadModal({
  open,
  onClose,
  investigationId,
  patientId,
  hospitalId,
  uploadedBy,
  investigationTestName = null,
  onSuccess,
}: OCRUploadModalProps) {
  const linkedEncounter =
    Boolean(investigationId?.trim()) && Boolean(patientId?.trim());

  const [leftTab, setLeftTab] = useState<"capture" | "speech">("capture");
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [manualReview, setManualReview] = useState(0.8);
  const [autoAccept, setAutoAccept] = useState(0.95);

  const [ocrUploadId, setOcrUploadId] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const [rawText, setRawText] = useState("");
  const [lines, setLines] = useState<OcrLine[]>([]);
  const [tableRows, setTableRows] = useState<TableRow[]>([]);
  const originalRef = useRef<TableRow[] | null>(null);

  const revokeAllStaged = useCallback((prev: StagedFile[]) => {
    for (const s of prev) {
      if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
    }
  }, []);

  const clearModalState = useCallback(() => {
    setStaged((prev) => {
      revokeAllStaged(prev);
      return [];
    });
    setSelectedIdx(0);
    setLeftTab("capture");
    setOcrUploadId(null);
    setStoragePath(null);
    setProcessing(false);
    setSaving(false);
    setOcrError(null);
    setRawText("");
    setLines([]);
    setTableRows([]);
    originalRef.current = null;
  }, [revokeAllStaged]);

  useEffect(() => {
    if (!open || !hospitalId.trim()) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("ocr_confidence_config")
        .select("manual_review_threshold, auto_accept_threshold")
        .eq("hospital_id", hospitalId.trim())
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setManualReview(0.8);
        setAutoAccept(0.95);
        return;
      }
      const row = data as { manual_review_threshold?: unknown; auto_accept_threshold?: unknown };
      setManualReview(normalizeThreshold(row.manual_review_threshold as number | null, 0.8));
      setAutoAccept(normalizeThreshold(row.auto_accept_threshold as number | null, 0.95));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hospitalId]);

  useEffect(() => {
    if (open) return;
    clearModalState();
  }, [open, clearModalState]);

  const addFiles = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list);
    setStaged((prev) => {
      const next: StagedFile[] = [];
      for (const file of arr) {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const previewUrl = isPdf ? "" : URL.createObjectURL(file);
        next.push({ id: newId(), file, previewUrl, isPdf });
      }
      return [...prev, ...next];
    });
  }, []);

  const removeStaged = useCallback((id: string) => {
    setStaged((prev) => {
      const s = prev.find((x) => x.id === id);
      if (s?.previewUrl) URL.revokeObjectURL(s.previewUrl);
      const next = prev.filter((x) => x.id !== id);
      setSelectedIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
      return next;
    });
  }, []);

  const handleClose = () => {
    clearModalState();
    onClose();
  };

  const startManualEntry = useCallback(() => {
    setOcrError(null);
    setProcessing(false);
    setOcrUploadId(null);
    setStoragePath(null);
    setRawText("");
    setLines([]);
    const rows = manualEntryRowsForTest(investigationTestName);
    setTableRows(rows);
    originalRef.current = rows.map((r) => ({ ...r }));
  }, [investigationTestName]);

  const runOcrPipeline = async () => {
    if (!staged.length) {
      setOcrError("Add a document first.");
      return;
    }
    const idx = Math.min(selectedIdx, staged.length - 1);
    const sf = staged[idx]!;
    let file = sf.file;
    const hid = hospitalId.trim();
    const pid = (patientId ?? "").trim();
    const iid = (investigationId ?? "").trim();
    if (!hid) {
      setOcrError("Missing hospital context.");
      return;
    }

    setProcessing(true);
    setOcrError(null);

    if (!sf.isPdf) {
      try {
        file = await ensureJpegForOcrUpload(file);
      } catch (e) {
        setProcessing(false);
        setOcrError(e instanceof Error ? e.message : "Could not prepare image for OCR.");
        return;
      }
    }

    const rasterContentType =
      file.type === "image/jpeg" || file.type === "image/jpg" ? file.type : file.type || "image/jpeg";
    const uploadContentType = sf.isPdf ? "application/pdf" : rasterContentType;

    const objectPath =
      linkedEncounter && pid && iid
        ? `${hid}/${pid}/${Date.now()}_${safeFilePart(file.name)}`
        : `${hid}/ocr-test-uploads/${Date.now()}_${safeFilePart(file.name)}`;
    const { error: upErr } = await supabase.storage.from("investigation-reports").upload(objectPath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: uploadContentType,
    });
    if (upErr) {
      setProcessing(false);
      setOcrError(upErr.message);
      return;
    }

    const { data: insertRow, error: insErr } = await supabase
      .from("investigation_ocr_uploads")
      .insert({
        storage_path: objectPath,
        file_name: file.name,
        file_type: file.type || null,
        file_size_bytes: file.size,
        investigation_id: linkedEncounter ? iid : null,
        patient_id: linkedEncounter ? pid : null,
        hospital_id: hid,
        uploaded_by: uploadedBy,
        ocr_status: "processing",
        ocr_engine: "gemini-vision",
      })
      .select("id")
      .single();

    if (insErr || !insertRow?.id) {
      setProcessing(false);
      setOcrError(insErr?.message ?? "Failed to create OCR upload row.");
      return;
    }

    const uploadId = String(insertRow.id);
    setOcrUploadId(uploadId);
    setStoragePath(objectPath);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    let res: Response;
    try {
      res = await fetch("/api/ocr/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          storage_path: objectPath,
          investigation_ocr_upload_id: uploadId,
          mime_type: uploadContentType,
        }),
      });
    } catch {
      setProcessing(false);
      setOcrError("Network error calling OCR service.");
      return;
    }

    const json = (await res.json()) as {
      error?: string;
      raw_text?: string;
      lines?: OcrLine[];
      fields?: Array<{
        name: string;
        value: string;
        confidence: number;
        unit?: string;
        reference_range?: string;
        is_abnormal?: boolean;
      }>;
    };

    setProcessing(false);
    if (!res.ok) {
      setOcrError(json.error ?? "OCR failed.");
      return;
    }

    setRawText(json.raw_text ?? "");
    setLines(Array.isArray(json.lines) ? json.lines : []);

    const fields = Array.isArray(json.fields) ? json.fields : [];
    const rows: TableRow[] = fields.map((f) => ({
      id: newId(),
      parameter_name: f.name ?? "",
      result_value: f.value ?? "",
      unit: f.unit ?? "",
      reference_range: f.reference_range ?? "",
      confidence: typeof f.confidence === "number" ? Math.min(1, Math.max(0, f.confidence)) : 0.85,
      is_abnormal: Boolean(f.is_abnormal),
    }));
    setTableRows(rows);
    originalRef.current = rows.map((r) => ({ ...r }));
  };

  const updateRow = (id: string, patch: Partial<TableRow>) => {
    setTableRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addTableRow = () => {
    setTableRows((prev) => [...prev, emptyTableRow()]);
  };

  const hasValidTableRows = tableRows.some((r) => r.parameter_name.trim() && r.result_value.trim());
  const canConfirmSave = linkedEncounter
    ? hasValidTableRows
    : Boolean(ocrUploadId && (hasValidTableRows || rawText.trim())) || (!ocrUploadId && hasValidTableRows);

  const buildCorrections = (): Record<string, unknown> => {
    const orig = originalRef.current;
    if (!orig) return { edited: true, rows: tableRows };
    const changes: Record<string, unknown>[] = [];
    for (let i = 0; i < tableRows.length; i++) {
      const cur = tableRows[i]!;
      const o = orig[i];
      if (!o) {
        changes.push({ index: i, type: "added", row: cur });
        continue;
      }
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (o.parameter_name !== cur.parameter_name) {
        diff.parameter_name = { from: o.parameter_name, to: cur.parameter_name };
      }
      if (o.result_value !== cur.result_value) {
        diff.result_value = { from: o.result_value, to: cur.result_value };
      }
      if (o.unit !== cur.unit) diff.unit = { from: o.unit, to: cur.unit };
      if (o.reference_range !== cur.reference_range) {
        diff.reference_range = { from: o.reference_range, to: cur.reference_range };
      }
      if (Boolean(o.is_abnormal) !== Boolean(cur.is_abnormal)) {
        diff.is_abnormal = { from: o.is_abnormal ?? false, to: cur.is_abnormal };
      }
      if (o.confidence !== cur.confidence) {
        diff.confidence = { from: o.confidence, to: cur.confidence };
      }
      if (Object.keys(diff).length) changes.push({ index: i, id: cur.id, diff });
    }
    return { changes };
  };

  const confirmSave = async () => {
    const valid = tableRows.filter((r) => r.parameter_name.trim() && r.result_value.trim());
    if (linkedEncounter && valid.length === 0) {
      setOcrError("Add at least one row with parameter and value.");
      return;
    }
    if (!linkedEncounter && valid.length === 0 && !rawText.trim() && !ocrUploadId) {
      setOcrError("Run OCR, use Enter manually, or add at least one structured row.");
      return;
    }
    if (!linkedEncounter && valid.length === 0 && ocrUploadId && !rawText.trim()) {
      setOcrError("Add at least one row or keep OCR text before saving.");
      return;
    }

    setSaving(true);
    setOcrError(null);
    const now = new Date().toISOString();

    if (linkedEncounter && investigationId?.trim() && patientId?.trim()) {
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser();
      if (authErr || !user?.id) {
        setSaving(false);
        setOcrError(authErr?.message ?? "You must be signed in to save lab results.");
        return;
      }

      const payloads = valid.map((r) => {
        const { value_numeric, value_text } = parseValueForDb(r.result_value);
        return {
          investigation_id: investigationId.trim(),
          parameter_name: r.parameter_name.trim(),
          value_numeric,
          value_text,
          unit: r.unit.trim() || null,
          ref_range_text: r.reference_range.trim() || null,
          ref_range_low: null as number | null,
          ref_range_high: null as number | null,
          loinc_code: null as string | null,
          is_abnormal: r.is_abnormal,
          // Stored for clinical use; not shown in this modal UI.
          interpretation: null as string | null,
          entry_method: "ocr",
          entered_by: user.id,
          ocr_upload_id: ocrUploadId,
        };
      });

      const { error: labErr } = await supabase.from("lab_result_entries").insert(payloads);
      if (labErr) {
        setSaving(false);
        setOcrError(labErr.message);
        return;
      }

      const { error: invErr } = await supabase
        .from("investigations")
        .update({
          status: "resulted",
          result_status: "resulted",
          resulted_at: now,
        })
        .eq("id", investigationId.trim())
        .eq("hospital_id", hospitalId.trim());

      if (invErr) {
        setSaving(false);
        setOcrError(invErr.message);
        return;
      }
    }

    if (ocrUploadId) {
      const avgConf =
        valid.length > 0
          ? valid.reduce((s, r) => s + r.confidence, 0) / valid.length
          : lines.length > 0
            ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length
            : 0;

      const fieldConfidence: Record<string, number> = {};
      for (const r of valid) {
        fieldConfidence[r.parameter_name.trim()] = r.confidence;
      }

      const structured = valid.map((r) => ({
        parameter_name: r.parameter_name.trim(),
        result_value: r.result_value.trim(),
        unit: r.unit.trim(),
        reference_range: r.reference_range.trim(),
        confidence: r.confidence,
        is_abnormal: r.is_abnormal,
      }));

      const { error: ocrUpErr } = await supabase
        .from("investigation_ocr_uploads")
        .update({
          ocr_status: "completed",
          ocr_raw_text: rawText,
          ocr_structured_json: structured,
          ocr_confidence: avgConf,
          field_confidence: fieldConfidence,
          doctor_verified: true,
          doctor_verified_by: uploadedBy,
          doctor_verified_at: now,
          doctor_corrections: buildCorrections(),
        })
        .eq("id", ocrUploadId);

      if (ocrUpErr) {
        setSaving(false);
        setOcrError(ocrUpErr.message);
        return;
      }
    }

    setSaving(false);
    onSuccess?.();
    handleClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Close modal"
        onClick={handleClose}
      />
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">Upload lab report (OCR)</h2>
            <p className="text-xs text-gray-500">
              Gemini vision · manual entry ·{" "}
              {linkedEncounter && investigationId?.trim()
                ? `investigation ${investigationId.trim().slice(0, 8)}…`
                : "test upload (not linked to an investigation)"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2 lg:divide-x lg:divide-gray-100">
          {/* Left */}
          <div className="flex min-h-[320px] flex-col p-4">
            <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setLeftTab("capture")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  leftTab === "capture" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Capture document
              </button>
              <button
                type="button"
                onClick={() => setLeftTab("speech")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  leftTab === "speech" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Speech to text
              </button>
            </div>

            {leftTab === "speech" ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-slate-50/50 p-8 text-center">
                <p className="text-sm font-semibold text-gray-700">Coming soon</p>
                <p className="mt-1 max-w-xs text-xs text-gray-500">
                  Voice capture for lab values will be available in a future release.
                </p>
              </div>
            ) : (
              <>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
                    dragOver ? "border-blue-400 bg-blue-50/50" : "border-gray-200 bg-slate-50/40 hover:border-gray-300"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <p className="text-sm font-semibold text-gray-800">Drag & drop image or PDF</p>
                  <p className="mt-1 text-xs text-gray-500">or click to browse</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    Use camera to capture
                  </button>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {staged.length > 0 ? (
                  <div className="mt-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Thumbnails</p>
                    <div className="flex flex-wrap gap-2">
                      {staged.map((s, i) => (
                        <div
                          key={s.id}
                          className={`relative w-20 shrink-0 overflow-hidden rounded-lg border-2 ${
                            i === selectedIdx ? "border-blue-600 ring-2 ring-blue-100" : "border-gray-200"
                          }`}
                        >
                          <button
                            type="button"
                            className="block h-20 w-full bg-gray-100"
                            onClick={() => setSelectedIdx(i)}
                          >
                            {s.isPdf ? (
                              <span className="flex h-full items-center justify-center text-[10px] font-bold text-gray-600">
                                PDF
                              </span>
                            ) : (
                              <img src={s.previewUrl} alt="" className="h-full w-full object-cover" />
                            )}
                          </button>
                          <button
                            type="button"
                            className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-[10px] text-white"
                            onClick={() => removeStaged(s.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => void runOcrPipeline()}
                      className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
                    >
                      {processing ? "Processing OCR…" : "Run OCR"}
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={processing}
                  onClick={startManualEntry}
                  className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-40"
                >
                  Enter manually
                </button>
              </>
            )}
          </div>

          {/* Right */}
          <div className="flex min-h-[320px] flex-col overflow-y-auto p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Extracted text</p>
            {ocrError ? (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{ocrError}</p>
            ) : null}

            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-100 bg-slate-50/80 p-2 text-xs">
              {lines.length === 0 && !rawText ? (
                <p className="text-gray-400">
                  OCR output appears after Run OCR, or use Enter manually for structured rows only.
                </p>
              ) : lines.length > 0 ? (
                <ul className="space-y-1">
                  {lines.map((ln, i) => (
                    <li
                      key={`${i}-${ln.text.slice(0, 12)}`}
                      className={`flex items-start justify-between gap-2 rounded-md border border-transparent px-2 py-1 ${lineHighlightClass(ln.confidence, manualReview, autoAccept)}`}
                    >
                      <span className="text-gray-800">{ln.text}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${confidenceBadgeClass(ln.confidence, manualReview, autoAccept)}`}
                      >
                        {pct(ln.confidence)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-gray-800">{rawText}</pre>
              )}
            </div>

            <p className="mt-4 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              Structured fields (editable)
            </p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Thresholds: review below {pct(manualReview)}, caution to {pct(autoAccept)}, then auto (green).
            </p>

            <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    <th className="px-2 py-2">Parameter</th>
                    <th className="px-2 py-2">Value</th>
                    <th className="px-2 py-2">Unit</th>
                    <th className="px-2 py-2">Ref range</th>
                    <th className="px-2 py-2 text-center">Abnl.</th>
                    <th className="px-2 py-2">Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-center text-gray-400">
                        No rows yet — run OCR, Enter manually, or + Add row.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100">
                        <td className="p-1">
                          <input
                            className={inputCls}
                            value={r.parameter_name}
                            placeholder="Field name"
                            onChange={(e) => updateRow(r.id, { parameter_name: e.target.value })}
                          />
                        </td>
                        <td className="p-1">
                          <input className={inputCls} value={r.result_value} onChange={(e) => updateRow(r.id, { result_value: e.target.value })} />
                        </td>
                        <td className="p-1">
                          <input className={inputCls} value={r.unit} onChange={(e) => updateRow(r.id, { unit: e.target.value })} />
                        </td>
                        <td className="p-1">
                          <input
                            className={inputCls}
                            value={r.reference_range}
                            onChange={(e) => updateRow(r.id, { reference_range: e.target.value })}
                          />
                        </td>
                        <td className="p-1 text-center align-middle">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            checked={r.is_abnormal}
                            onChange={(e) => updateRow(r.id, { is_abnormal: e.target.checked })}
                            aria-label="Abnormal flag"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            className={inputCls}
                            type="number"
                            step="0.001"
                            min={0}
                            max={1}
                            value={r.confidence}
                            onChange={(e) =>
                              updateRow(r.id, { confidence: Math.min(1, Math.max(0, Number.parseFloat(e.target.value) || 0)) })
                            }
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addTableRow}
              className="mt-2 self-start text-xs font-semibold text-blue-600 hover:underline"
            >
              + Add row
            </button>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                disabled={saving || !canConfirmSave}
                onClick={() => void confirmSave()}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
              >
                {saving ? "Saving…" : linkedEncounter ? "Confirm & Save" : "Save OCR (test)"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
