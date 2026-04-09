"use client";

import { useCallback, useEffect, useMemo } from "react";

/** Single Rx line: use `data.medication` object (not an array). Display dosage, quantity, etc. */
export type ReceiptMedicationLine = {
  name: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  instructions: string | null;
  /** For preview patch after user edits dispensed qty */
  dispensed_quantity: number | null;
  total_quantity: number | null;
};

export type PrescriptionReceiptPayload = {
  receipt_number: string | null;
  patient: {
    name: string | null;
    docpad_id: string | null;
    age_years: number | null;
    sex: string | null;
  };
  medication: ReceiptMedicationLine;
  pharmacist: { name: string | null; registration: string | null };
  hospital: { name: string | null };
  dispensed_at: string | null;
};

function readStr(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function readNum(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function coerceIsoTimestamp(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object" && v !== null && "value" in v) {
    const inner = (v as { value?: unknown }).value;
    if (typeof inner === "string") return inner.trim() || null;
    return inner != null ? String(inner) : null;
  }
  return String(v);
}

function formatReceiptNumberFromPrescriptionId(id: string | null | undefined): string | null {
  if (!id?.trim()) return null;
  const hex = id.replace(/-/g, "").toUpperCase();
  if (hex.length < 8) return `RX-${hex}`;
  return `RX-${hex.slice(0, 12)}`;
}

function formatPatientSex(sex: string | null | undefined): string {
  if (!sex?.trim()) return "—";
  const s = sex.trim().toLowerCase();
  if (s === "m" || s === "male") return "Male";
  if (s === "f" || s === "female") return "Female";
  if (s === "unknown") return "—";
  return sex.trim().charAt(0).toUpperCase() + sex.trim().slice(1);
}

function formatPatientAge(age: number | null | undefined): string {
  if (age == null || Number.isNaN(age)) return "—";
  return `${age} yrs`;
}

function quantityFromParts(dispensed: number | null, total: number | null): string | null {
  if (dispensed != null && total != null) return `${dispensed} / ${total}`;
  if (dispensed != null) return String(dispensed);
  if (total != null) return String(total);
  return null;
}

function parseMedicationObject(x: Record<string, unknown>): ReceiptMedicationLine {
  const name =
    x.name != null
      ? readStr(x.name)
      : x.medicine_name != null
        ? readStr(x.medicine_name)
        : null;
  const dispensed_quantity = readNum(x.dispensed_quantity);
  const total_quantity = readNum(x.total_quantity);
  const dosage =
    (readStr(x.dosage) ?? readStr(x.dosage_text))?.trim() || null;
  let quantity: string | null = readStr(x.quantity)?.trim() || null;
  if (!quantity && typeof x.quantity === "number" && !Number.isNaN(x.quantity)) {
    quantity = String(x.quantity);
  }
  if (!quantity) {
    quantity = quantityFromParts(dispensed_quantity, total_quantity);
  }
  return {
    name,
    dosage,
    frequency: readStr(x.frequency)?.trim() || null,
    duration: readStr(x.duration)?.trim() || null,
    quantity,
    instructions: readStr(x.instructions)?.trim() || null,
    dispensed_quantity,
    total_quantity,
  };
}

function emptyMedication(): ReceiptMedicationLine {
  return {
    name: null,
    dosage: null,
    frequency: null,
    duration: null,
    quantity: null,
    instructions: null,
    dispensed_quantity: null,
    total_quantity: null,
  };
}

/** Update medication after user sets preview dispensed qty (rebuilds `quantity` label). */
export function withMedicationDispensedQuantity(
  medication: ReceiptMedicationLine,
  dispensedQuantity: number,
): ReceiptMedicationLine {
  const qty = quantityFromParts(dispensedQuantity, medication.total_quantity);
  return {
    ...medication,
    dispensed_quantity: dispensedQuantity,
    quantity: qty ?? String(dispensedQuantity),
  };
}

/** If API wrongly nests the full receipt under `patient`, unwrap to the inner root. */
function unwrapReceiptRoot(data: unknown): unknown {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return data;
  const o = data as Record<string, unknown>;
  const inner = o.patient;
  if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
    const po = inner as Record<string, unknown>;
    if (
      po.patient != null &&
      typeof po.patient === "object" &&
      (po.medication != null || po.medications != null || po.dispensed_at != null)
    ) {
      return inner;
    }
  }
  return data;
}

function parsePatientBlock(pt: Record<string, unknown>): PrescriptionReceiptPayload["patient"] {
  return {
    name: readStr(pt.name),
    docpad_id: readStr(pt.docpad_id),
    age_years: readNum(pt.age_years),
    sex: readStr(pt.sex),
  };
}

function parseReceiptPayload(data: unknown): PrescriptionReceiptPayload | null {
  const root = unwrapReceiptRoot(data);
  if (root == null || typeof root !== "object") return null;
  const o = root as Record<string, unknown>;

  const dispensedAt =
    coerceIsoTimestamp(o.dispensed_at) ?? coerceIsoTimestamp(o.timestamp);

  const pRaw = o.patient;
  let patient: PrescriptionReceiptPayload["patient"];
  if (pRaw != null && typeof pRaw === "object" && !Array.isArray(pRaw)) {
    patient = parsePatientBlock(pRaw as Record<string, unknown>);
  } else {
    patient = {
      name: o.patient_name != null ? readStr(o.patient_name) : null,
      docpad_id: o.docpad_id != null ? readStr(o.docpad_id) : null,
      age_years: readNum(o.age_years),
      sex: readStr(o.sex),
    };
  }

  const mRaw = o.medication;
  let medication: ReceiptMedicationLine;
  if (mRaw != null && typeof mRaw === "object" && !Array.isArray(mRaw)) {
    medication = parseMedicationObject(mRaw as Record<string, unknown>);
  } else if (Array.isArray(mRaw) && mRaw.length > 0 && typeof mRaw[0] === "object" && mRaw[0] !== null) {
    medication = parseMedicationObject(mRaw[0] as Record<string, unknown>);
  } else if (Array.isArray(o.medications) && o.medications.length > 0 && typeof o.medications[0] === "object") {
    medication = parseMedicationObject(o.medications[0] as Record<string, unknown>);
  } else {
    medication = emptyMedication();
    if (o.medicine_name != null) {
      medication = { ...medication, name: readStr(o.medicine_name) };
    }
  }

  const phRaw = o.pharmacist;
  let pharmacist: PrescriptionReceiptPayload["pharmacist"];
  if (phRaw != null && typeof phRaw === "object" && !Array.isArray(phRaw)) {
    const ph = phRaw as Record<string, unknown>;
    pharmacist = {
      name: ph.name != null ? readStr(ph.name) : null,
      registration: ph.registration != null ? readStr(ph.registration) : null,
    };
  } else {
    pharmacist = {
      name: o.pharmacist_name != null ? readStr(o.pharmacist_name) : null,
      registration: o.pharmacist_registration != null ? readStr(o.pharmacist_registration) : null,
    };
  }

  const hoRaw = o.hospital;
  let hospital: PrescriptionReceiptPayload["hospital"];
  if (hoRaw != null && typeof hoRaw === "object" && !Array.isArray(hoRaw)) {
    hospital = { name: readStr((hoRaw as Record<string, unknown>).name) };
  } else {
    hospital = { name: o.hospital_name != null ? readStr(o.hospital_name) : null };
  }

  return {
    receipt_number: o.receipt_number != null ? readStr(o.receipt_number) : null,
    patient,
    medication,
    pharmacist,
    hospital,
    dispensed_at: dispensedAt,
  };
}

export function parseRpcReceiptData(data: unknown): PrescriptionReceiptPayload | null {
  if (typeof data === "string") {
    try {
      return parseReceiptPayload(JSON.parse(data) as unknown);
    } catch {
      return null;
    }
  }
  return parseReceiptPayload(data);
}

function formatReceiptTime(iso: string | null): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type Props = {
  open: boolean;
  payload: PrescriptionReceiptPayload | null;
  /** Fallback for receipt # when payload omits it (e.g. legacy RPC). */
  prescriptionId?: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** Queue flow: after preview, user confirms to dispense and close. */
  showConfirmDispense?: boolean;
  onConfirmDispense?: () => void | Promise<void>;
  confirmDispenseBusy?: boolean;
  confirmDispenseError?: string | null;
  /** Screen-reader / header label */
  variant?: "preview" | "view";
};

export function PrescriptionReceiptModal({
  open,
  payload,
  prescriptionId = null,
  loading,
  error,
  onClose,
  showConfirmDispense = false,
  onConfirmDispense,
  confirmDispenseBusy = false,
  confirmDispenseError = null,
  variant = "view",
}: Props) {
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("receipt-print-active");
    return () => document.documentElement.classList.remove("receipt-print-active");
  }, [open]);

  const receiptNumber = useMemo(() => {
    if (!payload) return null;
    const n = payload.receipt_number?.trim();
    if (n) return n;
    return formatReceiptNumberFromPrescriptionId(prescriptionId);
  }, [payload, prescriptionId]);

  if (!open) return null;

  const m = payload?.medication;

  return (
    <div className="receipt-modal-root fixed inset-0 z-50 flex items-center justify-center p-4 print:static print:inset-auto print:z-auto print:block print:p-0">
      <button
        type="button"
        aria-label="Close receipt"
        className="receipt-no-print absolute inset-0 bg-slate-900/50"
        onClick={onClose}
      />
      <div
        id="prescription-receipt-sheet"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white font-sans text-slate-900 shadow-xl print:max-h-none print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      >
        <div className="receipt-no-print flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {variant === "preview" ? "Receipt preview" : "Dispense receipt"}
            </h2>
            {variant === "preview" ? (
              <p className="mt-0.5 text-[11px] text-slate-500">Review and print; confirm to record the dispense.</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !payload}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={confirmDispenseBusy}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {showConfirmDispense ? "Cancel" : "Close"}
            </button>
          </div>
        </div>

        <div className="receipt-print-scroll overflow-y-auto px-5 py-4 print:overflow-visible print:px-0 print:py-0">
          {loading ? <p className="text-sm text-slate-500">Loading receipt…</p> : null}
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error && payload ? (
            <div className="receipt-print-body text-slate-900">
              <div
                className="receipt-logo-placeholder mb-4 flex h-16 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs font-medium text-slate-400 print:mb-3 print:h-20 print:rounded-none print:border-slate-600 print:bg-white print:text-slate-600"
                aria-hidden
              >
                Hospital logo
              </div>

              <header className="receipt-print-header border-b border-slate-200 pb-3 print:border-black">
                <p className="text-lg font-bold tracking-tight print:text-[14pt]">{payload.hospital.name?.trim() || "—"}</p>
                <div className="mt-2 flex flex-col gap-1 text-xs text-slate-600 print:text-[10pt] print:text-black">
                  <p>
                    <span className="font-semibold text-slate-700 print:text-black">Receipt #:</span>{" "}
                    <span className="tabular-nums">{receiptNumber ?? "—"}</span>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700 print:text-black">Date &amp; time:</span>{" "}
                    {formatReceiptTime(payload.dispensed_at)}
                  </p>
                </div>
              </header>

              <section className="mt-4 print:mt-4">
                <h3 className="receipt-section-title text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-[9pt] print:text-black">
                  Patient
                </h3>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 print:grid-cols-2 print:text-[10pt]">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-slate-500 print:text-black">Name</dt>
                    <dd className="font-semibold print:font-semibold">{payload.patient.name?.trim() || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-slate-500 print:text-black">DocPad ID</dt>
                    <dd className="tabular-nums">{payload.patient.docpad_id?.trim() || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-slate-500 print:text-black">Age</dt>
                    <dd>{formatPatientAge(payload.patient.age_years)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-slate-500 print:text-black">Sex</dt>
                    <dd>{formatPatientSex(payload.patient.sex)}</dd>
                  </div>
                </dl>
              </section>

              <section className="mt-5 print:mt-4">
                <h3 className="receipt-section-title text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-[9pt] print:text-black">
                  Medications
                </h3>
                <div className="mt-2 overflow-x-auto print:overflow-visible">
                  <table className="receipt-med-table w-full border-collapse text-left text-sm print:text-[10pt]">
                    <thead>
                      <tr>
                        <th className="receipt-med-th border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-600">
                          Name
                        </th>
                        <th className="receipt-med-th border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-600">
                          Dosage
                        </th>
                        <th className="receipt-med-th border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-600">
                          Frequency
                        </th>
                        <th className="receipt-med-th border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-600">
                          Duration
                        </th>
                        <th className="receipt-med-th receipt-med-th-qty border border-slate-200 bg-slate-50 px-2 py-2 text-right text-[11px] font-semibold text-slate-600">
                          Qty
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {m ? (
                        <tr>
                          <td className="receipt-med-td border border-slate-100 px-2 py-2 font-medium">
                            {(m.name ?? "—").trim()}
                          </td>
                          <td className="receipt-med-td border border-slate-100 px-2 py-2">{m.dosage?.trim() || "—"}</td>
                          <td className="receipt-med-td border border-slate-100 px-2 py-2">{m.frequency?.trim() || "—"}</td>
                          <td className="receipt-med-td border border-slate-100 px-2 py-2">{m.duration?.trim() || "—"}</td>
                          <td className="receipt-med-td receipt-med-td-qty border border-slate-100 px-2 py-2 text-right tabular-nums">
                            {m.quantity?.trim() || "—"}
                          </td>
                        </tr>
                      ) : (
                        <tr>
                          <td className="receipt-med-td border border-slate-100 px-2 py-2" colSpan={5}>
                            —
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {m?.instructions?.trim() ? (
                  <p className="mt-2 text-xs text-slate-600 print:text-[9pt] print:text-black">
                    <span className="font-medium text-slate-700 print:text-black">Instructions:</span>{" "}
                    {m.instructions.trim()}
                  </p>
                ) : null}
              </section>

              <footer className="receipt-print-footer mt-8 border-t border-slate-200 pt-4 print:mt-8 print:border-black print:pt-4">
                <p className="text-sm font-medium print:text-[10pt]">
                  <span className="text-slate-500 print:text-black">Dispensed by:</span>{" "}
                  {payload.pharmacist.name?.trim() || "—"}
                </p>
                <p className="mt-1 text-sm print:text-[10pt]">
                  <span className="text-slate-500 print:text-black">Registration:</span>{" "}
                  {payload.pharmacist.registration?.trim() || "—"}
                </p>
                <div className="receipt-signature-block mt-8 print:mt-10">
                  <div className="receipt-signature-line border-b border-slate-400 print:border-black" />
                  <p className="mt-1 text-center text-xs text-slate-500 print:text-[9pt] print:text-black">
                    Pharmacist signature
                  </p>
                </div>
                <p className="mt-4 hidden text-center text-[10px] text-slate-400 print:block print:text-[8pt] print:text-slate-500">
                  Generated in DocPad
                </p>
              </footer>
            </div>
          ) : null}
        </div>

        {showConfirmDispense && !loading && payload ? (
          <div className="receipt-no-print space-y-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
            {confirmDispenseError ? (
              <p className="text-xs text-red-600" role="alert">
                {confirmDispenseError}
              </p>
            ) : null}
            <button
              type="button"
              disabled={confirmDispenseBusy}
              onClick={() => void onConfirmDispense?.()}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {confirmDispenseBusy ? "Recording…" : "Confirm & Close"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
