"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import {
  CONSENT_PURPOSES,
  getPatientConsentRegister,
  raiseDataPrincipalRequest,
  recordPatientConsent,
  withdrawPatientConsent,
  type ConsentPurpose,
  type ConsentRegister,
  type DataPrincipalRequest,
} from "@/lib/dpdpa";

const REQUEST_TYPES: { key: DataPrincipalRequest["request_type"]; label: string }[] = [
  { key: "correction", label: "Correct my details" },
  { key: "access", label: "Give me a copy of my data" },
  { key: "erasure", label: "Erase my data" },
  { key: "grievance", label: "Complaint" },
];

function purposeLabel(key: string): string {
  return CONSENT_PURPOSES.find((p) => p.key === key)?.label ?? key;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The patient's own privacy record: what they consented to, what they have
 * withdrawn, and the requests and complaints raised on their behalf. Staff work
 * this panel with the patient in front of them — every action here is written to
 * the audit log with their name on it.
 */
export default function PatientPrivacyPanel({ patientId }: { patientId: string }) {
  const [register, setRegister] = useState<ConsentRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addPurposes, setAddPurposes] = useState<ConsentPurpose[]>([]);
  const [requestType, setRequestType] = useState<DataPrincipalRequest["request_type"]>("correction");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { register: r, error: e } = await getPatientConsentRegister(patientId);
    setError(e);
    setRegister(r);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { register: r, error: e } = await getPatientConsentRegister(patientId);
      if (cancelled) return;
      setError(e);
      setRegister(r);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const given = new Set((register?.consents ?? []).filter((c) => c.status === "given").map((c) => c.purpose));
  const addable = CONSENT_PURPOSES.filter((p) => !given.has(p.key));

  async function onAddConsent() {
    if (addPurposes.length === 0) return;
    setBusy(true);
    const e = await recordPatientConsent(patientId, addPurposes, { method: "verbal" });
    setBusy(false);
    if (e) {
      setError(e);
      return;
    }
    setAddPurposes([]);
    setNotice("Consent recorded.");
    await load();
  }

  async function onWithdraw(consentId: string) {
    const reason = window.prompt("Reason for withdrawal (optional)") ?? null;
    setBusy(true);
    const e = await withdrawPatientConsent(consentId, reason);
    setBusy(false);
    if (e) {
      setError(e);
      return;
    }
    setNotice("Consent withdrawn. The record of what was originally agreed is kept.");
    await load();
  }

  async function onRaise() {
    if (!subject.trim()) {
      setError("Describe what the patient is asking for.");
      return;
    }
    setBusy(true);
    const { slaDueAt, error: e } = await raiseDataPrincipalRequest({
      patientId,
      requestType,
      subject,
      details,
    });
    setBusy(false);
    if (e) {
      setError(e);
      return;
    }
    setSubject("");
    setDetails("");
    setNotice(`Logged. It must be answered by ${shortDate(slaDueAt)}.`);
    await load();
  }

  const officer = register?.hospital?.grievance_officer;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden />
          <h2 className="text-base font-bold text-slate-900">Consent &amp; data rights</h2>
        </div>
        <a
          href={`/api/patients/${patientId}/consent-register?download=1`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export register
        </a>
      </div>

      {error ? <p className="mt-3 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm font-medium text-emerald-700">{notice}</p> : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <h3 className="mt-5 text-sm font-semibold text-slate-800">Consent on record</h3>
          {register?.consents.length ? (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
              {register.consents.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{purposeLabel(c.purpose)}</p>
                    <p className="text-xs text-slate-600">
                      {c.status === "given"
                        ? `Given ${shortDate(c.given_at)} (${c.method})`
                        : `Withdrawn ${shortDate(c.withdrawn_at)}`}
                      {c.recorded_by ? ` · recorded by ${c.recorded_by}` : ""}
                      {c.notice_version ? ` · notice ${c.notice_version}` : ""}
                    </p>
                  </div>
                  {c.status === "given" ? (
                    <button
                      type="button"
                      onClick={() => void onWithdraw(c.id)}
                      disabled={busy}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Withdraw
                    </button>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      withdrawn
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Nothing on record. Patients registered before the consent register existed have no entry —
              take consent at their next visit and record it below.
            </p>
          )}

          {addable.length > 0 ? (
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="text-xs font-semibold text-slate-700">Record further consent</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {addable.map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={addPurposes.includes(p.key)}
                      onChange={(e) =>
                        setAddPurposes((prev) =>
                          e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key),
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void onAddConsent()}
                disabled={busy || addPurposes.length === 0}
                className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Record consent
              </button>
            </div>
          ) : null}

          <h3 className="mt-6 text-sm font-semibold text-slate-800">Requests and complaints</h3>
          {register?.requests.length ? (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
              {register.requests.map((r) => (
                <li key={r.id} className="px-3 py-2.5">
                  <p className="text-sm font-medium text-slate-900">{r.subject}</p>
                  <p className="text-xs text-slate-600">
                    {r.request_type} · {r.status} · raised {shortDate(r.raised_at)} · due{" "}
                    {shortDate(r.sla_due_at)}
                  </p>
                  {r.applied_changes?.length ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Changed{" "}
                      {r.applied_changes
                        .map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`)
                        .join("; ")}
                    </p>
                  ) : null}
                  {r.resolution ? <p className="mt-1 text-xs text-slate-600">{r.resolution}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">None raised.</p>
          )}

          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold text-slate-700">Log a request or complaint</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <select
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as DataPrincipalRequest["request_type"])}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800"
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What is the patient asking for?"
                className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={2}
              placeholder="Anything else worth recording (optional)"
              className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => void onRaise()}
              disabled={busy}
              className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Log it
            </button>
          </div>

          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {officer?.name
              ? `Grievance officer: ${officer.name}${officer.phone ? `, ${officer.phone}` : ""}${
                  officer.email ? `, ${officer.email}` : ""
                }.`
              : "No grievance officer has been published for this hospital yet."}
            {register?.hospital?.data_retention_years
              ? ` Records are kept for ${register.hospital.data_retention_years} years.`
              : ""}
          </p>
        </>
      )}
    </section>
  );
}
