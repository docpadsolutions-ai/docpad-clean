"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { fetchActiveConsentTypesForHospital } from "../../../lib/ipdConsentTypes";
import { supabase } from "../../../../lib/supabase";
import { patientFromAdmission } from "../../../lib/ipdAdmissionDisplay";
import { Button } from "../../../../components/ui/button";
import RequestCustomConsentModal from "../../../components/ipd/RequestCustomConsentModal";

const CARD_BG = "bg-white";
const PAGE_OVERLAY = "bg-black/55";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

type ConsentStatus = "pending" | "signed" | "waived";

function normalizeConsentStatus(row: Record<string, unknown>): ConsentStatus {
  const st = s(row.status).toLowerCase();
  if (st === "waived") return "waived";
  if (st === "signed" || st === "obtained" || st === "completed") return "signed";
  return "pending";
}

function formatSignedAt(iso: unknown): string {
  const t = s(iso);
  if (!t) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function patientDisplayName(patient: Record<string, unknown> | null): string {
  if (!patient) return "Patient";
  return s(patient.full_name) || s(patient.name) || "Patient";
}

function patientAgeLine(patient: Record<string, unknown> | null): string {
  if (!patient) return "—";
  const ageRaw = patient.age;
  if (typeof ageRaw === "number" && Number.isFinite(ageRaw)) return `${ageRaw} y`;
  if (ageRaw != null && s(ageRaw)) return `${s(ageRaw)} y`;
  const dob = patient.date_of_birth ?? patient.dob;
  if (!dob) return "—";
  const d = new Date(s(dob));
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  let yrs = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) yrs -= 1;
  return `${Math.max(0, yrs)} y`;
}

export default function IpdAdmissionConsentsTab({
  admissionId,
  hospitalId,
  admissionData,
  onRefetchAdmission,
}: {
  admissionId: string;
  hospitalId: string;
  admissionData: Record<string, unknown> | null;
  onRefetchAdmission: () => Promise<void>;
}) {
  const rows = useMemo(() => {
    const c = admissionData?.consents;
    return Array.isArray(c) ? (c as Record<string, unknown>[]) : [];
  }, [admissionData]);

  const [ipdCustomConsents, setIpdCustomConsents] = useState<Record<string, unknown>[]>([]);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [requesterNames, setRequesterNames] = useState<Record<string, string>>({});

  const patient = patientFromAdmission(admissionData as Record<string, unknown> | null);
  const admission = asRec(admissionData?.admission);
  const patientId = s(admission?.patient_id) || s(patient?.id);

  const [modalRow, setModalRow] = useState<Record<string, unknown> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [consentCatalog, setConsentCatalog] = useState<Record<string, unknown>[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [addTypeId, setAddTypeId] = useState<string>("");
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    void (async () => {
      setCatalogLoading(true);
      const { data, error } = await fetchActiveConsentTypesForHospital(supabase, hospitalId);
      if (cancelled) return;
      setCatalogLoading(false);
      if (error) {
        console.error(error);
        setConsentCatalog([]);
        return;
      }
      setConsentCatalog(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [hospitalId]);

  useEffect(() => {
    if (consentCatalog.length === 0) {
      setAddTypeId("");
      return;
    }
    setAddTypeId((prev) => {
      if (prev && consentCatalog.some((r) => s(r.id) === prev)) return prev;
      return s(consentCatalog[0].id);
    });
  }, [consentCatalog]);

  const loadCustomConsents = useCallback(async () => {
    if (!admissionId) return;
    const { data, error } = await supabase
      .from("ipd_consents")
      .select("*")
      .eq("admission_id", admissionId)
      .eq("is_custom", true)
      .order("requested_at", { ascending: false });
    if (error) {
      console.error(error);
      setIpdCustomConsents([]);
      return;
    }
    setIpdCustomConsents((data ?? []) as Record<string, unknown>[]);
  }, [admissionId]);

  useEffect(() => {
    void loadCustomConsents();
  }, [loadCustomConsents]);

  useEffect(() => {
    const ids = [...new Set(ipdCustomConsents.map((r) => s(r.requested_by)).filter(Boolean))];
    if (ids.length === 0) {
      setRequesterNames({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from("practitioners").select("id, full_name").in("id", ids);
      if (cancelled || error) return;
      const next: Record<string, string> = {};
      for (const pr of data ?? []) {
        const rec = pr as Record<string, unknown>;
        const id = s(rec.id);
        if (id) next[id] = s(rec.full_name) || "Staff";
      }
      setRequesterNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ipdCustomConsents]);

  const mergedRows = useMemo((): Record<string, unknown>[] => [...rows, ...ipdCustomConsents], [
    rows,
    ipdCustomConsents,
  ]);

  const total = mergedRows.length;
  const completedCount = useMemo(() => {
    return mergedRows.filter((r) => {
      const st = normalizeConsentStatus(r);
      return st === "signed" || st === "waived";
    }).length;
  }, [mergedRows]);

  const progressTone =
    total === 0
      ? "text-gray-500"
      : completedCount === total
        ? "text-emerald-700"
        : completedCount === 0
          ? "text-red-700"
          : "text-amber-700";

  /**
   * `get_ipd_admission` consents often expose the type label as `type_name` and/or `display_name`
   * (may be nested under `consent_type` or camelCase from JSON).
   */
  const consentDisplayTitle = (row: Record<string, unknown>) => {
    if (Boolean(row.is_custom) || s(row.consent_type).toLowerCase() === "custom") {
      return s(row.custom_title) || "Custom consent";
    }
    const nested = asRec(row.consent_type) ?? asRec(row.type) ?? asRec(row.ipd_consent_type);
    return (
      s(row.type_name) ||
      s(row.display_name) ||
      s(row.typeName) ||
      s(row.displayName) ||
      s(nested?.display_name) ||
      s(nested?.type_name) ||
      s(nested?.name) ||
      s(row.consent_type_name) ||
      s(row.consent_name) ||
      s(row.name) ||
      "Consent"
    );
  };

  const description = (row: Record<string, unknown>) => {
    if (Boolean(row.is_custom) || s(row.consent_type).toLowerCase() === "custom") {
      return s(row.custom_description);
    }
    return s(row.description);
  };

  const isMandatory = (row: Record<string, unknown>) => Boolean(row.is_mandatory ?? row.mandatory);

  const dotClass = (row: Record<string, unknown>) => {
    const mandatory = isMandatory(row);
    const st = normalizeConsentStatus(row);
    if (Boolean(row.is_custom)) {
      if (st === "signed") return "bg-emerald-500";
      if (st === "waived") return "bg-slate-400";
      return "bg-amber-500";
    }
    if (!mandatory) return "bg-slate-500";
    if (st === "signed") return "bg-emerald-500";
    return "bg-red-500";
  };

  const badge = (st: ConsentStatus) => {
    if (st === "signed") {
      return (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
          Signed ✓
        </span>
      );
    }
    if (st === "waived") {
      return (
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-800">
          Waived
        </span>
      );
    }
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">Pending</span>
    );
  };

  const refresh = async () => {
    await onRefetchAdmission();
    await loadCustomConsents();
  };

  const isCustomRow = (row: Record<string, unknown> | null) =>
    row != null && (Boolean(row.is_custom) || s(row.consent_type).toLowerCase() === "custom");

  const consentSignedAt = (row: Record<string, unknown>): unknown => {
    if (isCustomRow(row)) return row.obtained_at;
    return row.signed_at;
  };

  const handleSign = async () => {
    if (!modalRow?.id) return;
    setBusyId(s(modalRow.id));
    const iso = new Date().toISOString();
    const { error } = isCustomRow(modalRow)
      ? await supabase
          .from("ipd_consents")
          .update({ status: "signed", obtained_at: iso })
          .eq("id", s(modalRow.id))
      : await supabase
          .from("ipd_admission_consents")
          .update({ status: "signed", signed_at: iso })
          .eq("id", s(modalRow.id));
    setBusyId(null);
    if (error) {
      console.error(error);
      return;
    }
    setModalRow(null);
    await refresh();
  };

  const handleWaive = async () => {
    if (!modalRow?.id) return;
    if (!isCustomRow(modalRow) && isMandatory(modalRow)) return;
    setBusyId(s(modalRow.id));
    const { error } = isCustomRow(modalRow)
      ? await supabase
          .from("ipd_consents")
          .update({ status: "waived", obtained_at: null })
          .eq("id", s(modalRow.id))
      : await supabase
          .from("ipd_admission_consents")
          .update({ status: "waived", signed_at: null })
          .eq("id", s(modalRow.id));
    setBusyId(null);
    if (error) {
      console.error(error);
      return;
    }
    setModalRow(null);
    await refresh();
  };

  const handleAddConsent = async () => {
    if (!admissionId || !patientId) return;
    const selected = consentCatalog.find((r) => s(r.id) === addTypeId);
    const label = selected ? s(selected.display_name) : "";
    if (!label) return;
    setAddBusy(true);
    const row: Record<string, unknown> = {
      admission_id: admissionId,
      consent_type_id: selected ? selected.id : null,
      status: "pending",
      hospital_id: hospitalId,
      patient_id: patientId,
      consent_name: label,
      is_mandatory: Boolean(selected?.is_mandatory),
    };
    const { error } = await supabase.from("ipd_admission_consents").insert(row);
    setAddBusy(false);
    if (error) {
      console.error(error);
      return;
    }
    setAddOpen(false);
    await refresh();
  };

  const modalName = modalRow ? consentDisplayTitle(modalRow) : "";
  const modalDesc = modalRow ? description(modalRow) : "";
  const modalPatient = patientDisplayName(patient);
  const modalAge = patientAgeLine(patient);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Admission Consents</h3>
          <p className={`mt-1 text-sm font-medium ${progressTone}`}>
            {completedCount} of {total} completed
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {mergedRows.length === 0 ? (
          <li className={`rounded-xl border border-gray-200 ${CARD_BG} px-4 py-8 text-center text-sm text-gray-600`}>
            No consents recorded yet. Add one below.
          </li>
        ) : (
          mergedRows.map((row) => {
            const id = s(row.id);
            const st = normalizeConsentStatus(row);
            const signedAt = consentSignedAt(row);
            const showObtain = st === "pending";
            const custom = Boolean(row.is_custom);
            const reqId = s(row.requested_by);
            const reqName = reqId ? requesterNames[reqId] || "…" : "—";
            return (
              <li
                key={id || consentDisplayTitle(row)}
                className={`rounded-xl border border-gray-200 ${CARD_BG} px-4 py-3 shadow-sm`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(row)}`} aria-hidden />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900">{consentDisplayTitle(row)}</p>
                        {custom ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                            Custom
                          </span>
                        ) : null}
                        {badge(st)}
                      </div>
                      {description(row) ? (
                        <p className="mt-1 text-[13px] leading-snug text-gray-600">{description(row)}</p>
                      ) : null}
                      {custom ? (
                        <p className="mt-1.5 text-[11px] text-gray-500">
                          Requested by <span className="font-medium text-gray-700">{reqName}</span>
                          {row.requested_at ? (
                            <>
                              {" "}
                              · {formatSignedAt(row.requested_at)}
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {st === "signed" && signedAt ? (
                        <p className="mt-1.5 text-[11px] text-gray-500">{formatSignedAt(signedAt)}</p>
                      ) : null}
                    </div>
                  </div>
                  {showObtain ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
                      onClick={() => setModalRow(row)}
                    >
                      Obtain consent
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <Button
          type="button"
          variant="ghost"
          className="min-h-[44px] flex-1 border border-dashed border-gray-300 text-gray-700 hover:bg-gray-50"
          onClick={() => setAddOpen(true)}
        >
          + Add consent
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 self-center border-amber-200/80 bg-white text-amber-950 hover:bg-amber-50 sm:self-auto"
          disabled={!patientId}
          onClick={() => setCustomModalOpen(true)}
        >
          + Custom Consent
        </Button>
      </div>

      <RequestCustomConsentModal
        open={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
        mode="persist"
        hospitalId={hospitalId}
        admissionId={admissionId}
        patientId={patientId}
        onInserted={() => void loadCustomConsents()}
      />

      {/* Obtain consent modal */}
      {modalRow ? (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${PAGE_OVERLAY}`}
          role="presentation"
          onClick={() => setModalRow(null)}
        >
          <div
            role="dialog"
            aria-modal
            aria-labelledby="ipd-consent-modal-title"
            className={`relative w-full max-w-[480px] rounded-xl border border-gray-200 ${CARD_BG} p-5 shadow-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              aria-label="Close"
              onClick={() => setModalRow(null)}
            >
              <X className="h-4 w-4" />
            </button>
            <h4 id="ipd-consent-modal-title" className="pr-8 text-base font-bold text-gray-900">
              {modalName !== "Consent" ? modalName : "Obtain consent"}
            </h4>
            <p className="mt-3 text-sm text-gray-700">
              <span className="font-semibold text-gray-900">{modalPatient}</span>
              <span className="text-gray-400"> · </span>
              <span>{modalAge}</span>
            </p>
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-900">{modalName}</p>
              {modalDesc ? <p className="mt-1 text-[13px] text-gray-600">{modalDesc}</p> : null}
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-gray-700">
              I, <span className="font-medium text-gray-900">{modalPatient}</span>, have been explained the nature of{" "}
              <span className="font-medium text-gray-900">{modalName}</span> and I give my consent voluntarily.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {!isMandatory(modalRow) ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-300 text-gray-700 hover:bg-gray-50"
                  disabled={busyId !== null}
                  onClick={() => void handleWaive()}
                >
                  Waive (optional)
                </Button>
              ) : null}
              <Button
                type="button"
                className="bg-emerald-600 text-white hover:bg-emerald-500"
                disabled={busyId !== null}
                onClick={() => void handleSign()}
              >
                {busyId ? "…" : "Mark as Signed"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add consent modal */}
      {addOpen ? (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${PAGE_OVERLAY}`}
          role="presentation"
          onClick={() => setAddOpen(false)}
        >
          <div
            className={`relative w-full max-w-[480px] rounded-xl border border-gray-200 ${CARD_BG} p-5 shadow-xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              aria-label="Close"
              onClick={() => setAddOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <h4 className="pr-8 text-base font-bold text-gray-900">Add consent</h4>
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Consent type
            </label>
            {catalogLoading ? (
              <p className="mt-2 text-sm text-gray-600">Loading consent types…</p>
            ) : consentCatalog.length === 0 ? (
              <p className="mt-2 text-sm text-amber-800">
                No active consent types found. Ask an administrator to configure the consent library under Admin → Consent Library.
              </p>
            ) : (
              <select
                value={addTypeId}
                onChange={(e) => setAddTypeId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-sky-500"
              >
                {consentCatalog.map((opt) => {
                  const isCustom = opt.hospital_id != null && s(opt.hospital_id) !== "";
                  const prefix = isCustom ? "Custom · " : "";
                  return (
                    <option key={s(opt.id)} value={s(opt.id)}>
                      {prefix}
                      {s(opt.display_name) || s(opt.code) || "Consent"}
                    </option>
                  );
                })}
              </select>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="ghost" className="text-gray-600" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-sky-600 text-white hover:bg-sky-500"
                disabled={addBusy || catalogLoading || consentCatalog.length === 0}
                onClick={() => void handleAddConsent()}
              >
                {addBusy ? "…" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
