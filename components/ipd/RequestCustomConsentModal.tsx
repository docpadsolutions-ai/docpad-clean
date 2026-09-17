"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

const CARD_BG = "bg-white";
const PAGE_OVERLAY = "bg-black/55";

export type CustomConsentFormPayload = {
  customTitle: string;
  customDescription: string;
  clinicalReason: string;
  urgency: "routine" | "urgent";
};

export type RequestCustomConsentModalProps = {
  open: boolean;
  onClose: () => void;
  /** Persist to DB — caller supplies ids; `requested_by` resolved from current session practitioner when omitted. */
  mode: "persist";
  hospitalId: string;
  admissionId: string;
  patientId: string;
  requestedByPractitionerId?: string | null;
  onInserted?: () => void;
};

export type RequestCustomConsentStageModalProps = {
  open: boolean;
  onClose: () => void;
  mode: "stage";
  onStage: (payload: CustomConsentFormPayload) => void;
};

type Props = RequestCustomConsentModalProps | RequestCustomConsentStageModalProps;

function isPersist(p: Props): p is RequestCustomConsentModalProps {
  return p.mode === "persist";
}

export default function RequestCustomConsentModal(props: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clinicalReason, setClinicalReason] = useState("");
  const [urgency, setUrgency] = useState<"routine" | "urgent">("routine");
  const [busy, setBusy] = useState(false);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      setTitle("");
      setDescription("");
      setClinicalReason("");
      setUrgency("routine");
      setErr(null);
      setBusy(false);
      return;
    }
    if (props.mode !== "persist") return;
    const pre = props.requestedByPractitionerId?.trim();
    if (pre) {
      setPractitionerId(pre);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid || cancelled) return;
      const { data: prof } = await supabase.from("practitioners").select("id").eq("user_id", uid).maybeSingle();
      if (!cancelled) setPractitionerId(prof && typeof prof === "object" && "id" in prof ? String(prof.id) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.open, props.mode, props.mode === "persist" ? props.requestedByPractitionerId : undefined]);

  if (!props.open) return null;

  const handleSubmit = async () => {
    setErr(null);
    const t = title.trim();
    const d = description.trim();
    if (!t || !d) {
      setErr("Title and description are required.");
      return;
    }
    const payload: CustomConsentFormPayload = {
      customTitle: t,
      customDescription: d,
      clinicalReason: clinicalReason.trim(),
      urgency,
    };
    if (!isPersist(props)) {
      props.onStage(payload);
      props.onClose();
      return;
    }
    if (!props.hospitalId || !props.admissionId || !props.patientId) {
      setErr("Missing admission context.");
      return;
    }
    const reqBy = practitionerId ?? props.requestedByPractitionerId?.trim() ?? null;
    if (!reqBy) {
      setErr("Your practitioner profile could not be resolved; cannot record requester.");
      return;
    }
    setBusy(true);
    const notesParts: string[] = [];
    if (payload.clinicalReason) notesParts.push(`Clinical reason: ${payload.clinicalReason}`);
    const { error } = await supabase.from("ipd_consents").insert({
      hospital_id: props.hospitalId,
      admission_id: props.admissionId,
      patient_id: props.patientId,
      consent_type: "custom",
      is_custom: true,
      custom_title: payload.customTitle,
      custom_description: payload.customDescription,
      status: "pending",
      requested_by: reqBy,
      requested_at: new Date().toISOString(),
      notes: notesParts.length ? notesParts.join("\n") : null,
      fhir_json: { urgency: payload.urgency },
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    props.onInserted?.();
    props.onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-[110] flex items-center justify-center p-4 ${PAGE_OVERLAY}`}
      role="presentation"
      onClick={() => !busy && props.onClose()}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="request-custom-consent-title"
        className={`relative w-full max-w-[520px] rounded-xl border border-gray-200 ${CARD_BG} p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          aria-label="Close"
          disabled={busy}
          onClick={() => props.onClose()}
        >
          <X className="h-4 w-4" />
        </button>
        <h4 id="request-custom-consent-title" className="pr-8 text-base font-bold text-gray-900">
          Request Custom Consent
        </h4>
        {err ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
            {err}
          </p>
        ) : null}

        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Consent title <span className="text-red-600">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-sky-500"
          placeholder="e.g. High-risk procedure discussion"
          disabled={busy}
        />

        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Description / what patient is consenting to <span className="text-red-600">*</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-sky-500"
          placeholder="Document what was explained and what the patient agrees to."
          disabled={busy}
        />

        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Clinical reason <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={clinicalReason}
          onChange={(e) => setClinicalReason(e.target.value)}
          rows={2}
          className="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-sky-500"
          placeholder="Why this consent is needed now."
          disabled={busy}
        />

        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Urgency</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setUrgency("routine")}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              urgency === "routine"
                ? "border-sky-500 bg-sky-50 text-sky-900"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Routine
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setUrgency("urgent")}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              urgency === "urgent"
                ? "border-amber-500 bg-amber-50 text-amber-950"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Urgent
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" className="text-gray-600" disabled={busy} onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-sky-600 text-white hover:bg-sky-500"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? "…" : isPersist(props) ? "Submit request" : "Add to list"}
          </Button>
        </div>
      </div>
    </div>
  );
}
