"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export type PendingAdmissionRow = Record<string, unknown>;

function admissionIdFromRow(row: PendingAdmissionRow): string {
  return s(row.admission_id ?? row.id ?? row.p_admission_id);
}

type RoomChargeRow = { id: string; display_name: string | null; base_price: number | null; code: string | null };

/** Match `charge_item_definitions` (room_charge) to bed type per Admin pricing. */
export function matchRoomChargeBasePrice(
  bedTypeRaw: string,
  roomCharges: RoomChargeRow[],
): { price: number; matched: boolean } {
  const t = bedTypeRaw.trim().toLowerCase();
  const name = (s: string) => (s ?? "").toLowerCase();
  const find = (pred: (n: string) => boolean) => {
    const row = roomCharges.find((r) => pred(name(r.display_name ?? "")));
    if (!row) return { price: 0, matched: false as const };
    const p = typeof row.base_price === "number" ? row.base_price : parseFloat(String(row.base_price ?? ""));
    return { price: Number.isFinite(p) ? p : 0, matched: true as const };
  };
  if (t === "private" || t.includes("private")) return find((n) => n.includes("private"));
  if (t === "icu" || t.includes("icu")) return find((n) => n.includes("icu"));
  if (t === "hdu" || t.includes("hdu")) return find((n) => n.includes("hdu"));
  if (t === "standard" || t === "general" || t.includes("general") || t.includes("standard")) {
    return find((n) => n.includes("general ward"));
  }
  return find((n) => n.includes("general ward"));
}

const PAYMENT_MODES = ["Cash", "UPI", "Card", "Insurance/TPA"] as const;

type ExtraLine = { id: string; label: string; amount: string };

export function AdmissionBillingSheet({
  open,
  row,
  hospitalId,
  onClose,
  onConfirmed,
  showToast,
}: {
  open: boolean;
  row: PendingAdmissionRow | null;
  hospitalId: string | null;
  onClose: () => void;
  onConfirmed: () => void;
  showToast: (msg: string) => void;
}) {
  const baseId = useId();
  const [roomRate, setRoomRate] = useState("");
  const [admissionFee, setAdmissionFee] = useState("");
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [paymentMode, setPaymentMode] = useState<(typeof PAYMENT_MODES)[number]>("Cash");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomPricingMissing, setRoomPricingMissing] = useState(false);
  const [admissionPricingMissing, setAdmissionPricingMissing] = useState(false);

  const bedType = useMemo(() => s(row?.bed_type), [row]);

  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;

    async function loadPricing() {
      setError(null);
      setRoomPricingMissing(false);
      setAdmissionPricingMissing(false);
      setExtras([]);
      setPaymentMode("Cash");
      setRoomRate("");
      setAdmissionFee("");

      if (!hospitalId) {
        setRoomRate("0");
        setAdmissionFee("0");
        setRoomPricingMissing(true);
        setAdmissionPricingMissing(true);
        return;
      }

      const [roomRes, regRes] = await Promise.all([
        supabase
          .from("charge_item_definitions")
          .select("id, display_name, base_price, code")
          .eq("hospital_id", hospitalId)
          .eq("category", "room_charge")
          .eq("status", "active"),
        supabase
          .from("charge_item_definitions")
          .select("id, display_name, base_price")
          .eq("hospital_id", hospitalId)
          .eq("category", "registration")
          .eq("status", "active")
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const roomRows = (!roomRes.error ? roomRes.data : []) as RoomChargeRow[];
      const roomMatch = matchRoomChargeBasePrice(bedType || "general", roomRows);
      setRoomRate(String(roomMatch.matched ? roomMatch.price : 0));
      setRoomPricingMissing(!roomMatch.matched);

      let admMissing = true;
      if (!regRes.error && regRes.data) {
        const bp = regRes.data.base_price;
        const n = typeof bp === "number" ? bp : parseFloat(String(bp ?? ""));
        if (Number.isFinite(n)) {
          setAdmissionFee(String(n));
          admMissing = false;
        } else {
          setAdmissionFee("0");
        }
      } else {
        setAdmissionFee("0");
      }
      setAdmissionPricingMissing(admMissing);
    }

    void loadPricing();
    return () => {
      cancelled = true;
    };
  }, [open, row, bedType, hospitalId]);

  const roomNum = useMemo(() => parseFloat(roomRate.replace(/,/g, "")), [roomRate]);
  const admNum = useMemo(() => parseFloat(admissionFee.replace(/,/g, "")), [admissionFee]);
  const extrasTotal = useMemo(() => {
    let t = 0;
    for (const e of extras) {
      const n = parseFloat(e.amount.replace(/,/g, ""));
      if (Number.isFinite(n)) t += n;
    }
    return t;
  }, [extras]);
  const total = useMemo(() => {
    const r = Number.isFinite(roomNum) ? roomNum : 0;
    const a = Number.isFinite(admNum) ? admNum : 0;
    return r + a + extrasTotal;
  }, [roomNum, admNum, extrasTotal]);

  const addExtra = useCallback(() => {
    setExtras((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, label: "", amount: "" }]);
  }, []);

  const removeExtra = useCallback((id: string) => {
    setExtras((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const confirm = useCallback(async () => {
    if (!row) return;
    const aid = admissionIdFromRow(row);
    if (!aid) {
      setError("Missing admission id.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setSubmitting(false);
      setError("You must be signed in.");
      return;
    }
    const { error: rpcErr } = await supabase.rpc("confirm_admission", {
      p_admission_id: aid,
      p_confirmed_by: uid,
    });
    setSubmitting(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    showToast("Bed allocated — patient admitted");
    onConfirmed();
    onClose();
  }, [row, onConfirmed, onClose, showToast]);

  if (!open || !row) return null;

  const patientName = s(row.patient_name ?? row.full_name);
  const wardBed = [s(row.ward_name), s(row.bed_number) ? `Bed ${s(row.bed_number)}` : ""]
    .filter(Boolean)
    .join(" · ");
  const doctor = s(row.doctor_name ?? row.admitting_doctor_name);
  const diagnosis = s(row.primary_diagnosis_display ?? row.diagnosis_display ?? row.diagnosis);

  return (
    <div className="fixed inset-0 z-[115] flex justify-end" role="dialog" aria-modal="true" aria-labelledby={`${baseId}-title`}>
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 id={`${baseId}-title`} className="text-lg font-bold text-gray-900">
            Collect &amp; confirm
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-1 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm">
            <p className="font-semibold text-gray-900">{patientName || "—"}</p>
            <p className="text-gray-700">{wardBed || "—"}</p>
            <p className="text-gray-600">
              <span className="font-medium text-gray-800">Doctor:</span> {doctor || "—"}
            </p>
            <p className="text-gray-600">
              <span className="font-medium text-gray-800">Diagnosis:</span> {diagnosis || "—"}
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <Label className="text-xs text-gray-600">Room charges (per day, ₹)</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={roomRate}
                onChange={(e) => setRoomRate(e.target.value)}
                aria-label="Room charges per day"
              />
              {roomPricingMissing ? (
                <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
                  Price not configured — please set in Admin &gt; Pricing
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-gray-500">
                  Prefilled from Admin &gt; Pricing (bed type: {bedType || "general"})
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs text-gray-600">Admission fee (₹)</Label>
              <Input
                className="mt-1"
                inputMode="decimal"
                value={admissionFee}
                onChange={(e) => setAdmissionFee(e.target.value)}
                aria-label="Admission fee"
              />
              {admissionPricingMissing ? (
                <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
                  Price not configured — please set in Admin &gt; Pricing
                </p>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">Additional charges</span>
                <button type="button" className="text-xs font-semibold text-blue-600 hover:underline" onClick={addExtra}>
                  + Add line
                </button>
              </div>
              <div className="space-y-2">
                {extras.map((e) => (
                  <div key={e.id} className="flex gap-2">
                    <Input
                      placeholder="Description"
                      value={e.label}
                      onChange={(ev) =>
                        setExtras((prev) => prev.map((x) => (x.id === e.id ? { ...x, label: ev.target.value } : x)))
                      }
                      className="flex-1"
                    />
                    <Input
                      placeholder="₹"
                      inputMode="decimal"
                      value={e.amount}
                      onChange={(ev) =>
                        setExtras((prev) => prev.map((x) => (x.id === e.id ? { ...x, amount: ev.target.value } : x)))
                      }
                      className="w-24"
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-lg px-2 text-xs text-gray-500 hover:bg-gray-100"
                      onClick={() => removeExtra(e.id)}
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-sm font-semibold text-gray-900">
                Total: ₹{total.toFixed(0)}
              </p>
            </div>

            <div>
              <Label className="text-xs text-gray-600">Payment mode</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMode(m)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      paymentMode === m
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-200 px-5 py-4">
          <Button type="button" className="w-full" disabled={submitting} onClick={() => void confirm()}>
            {submitting ? "Confirming…" : "Confirm Admission & Collect Payment"}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={submitting} onClick={onClose}>
            Hold for later
          </Button>
        </div>
      </div>
    </div>
  );
}
