"use client";

import Link from "next/link";
import { Loader2, Plus, Trash2, UserRoundSearch } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import {
  ChargeItemSelector,
  type ChargeDefinitionOption,
} from "@/components/billing/ChargeItemSelector";
import { computeLineNet, useInvoiceCreate } from "@/hooks/useInvoiceCreate";

type PatientOpt = { id: string; full_name: string | null; docpad_id: string | null; phone: string | null };
type EncounterOpt = { id: string; encounter_date: string | null; status: string | null };
type BillingAcctOpt = { id: string; label: string; account_type: string | null };

function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

export function InvoiceForm() {
  const {
    patientId,
    setPatientId,
    opdEncounterId,
    setOpdEncounterId,
    billingAccountId,
    setBillingAccountId,
    notes,
    setNotes,
    dueDate,
    setDueDate,
    lines,
    addLine,
    removeLine,
    updateLine,
    totals,
    validationMessage,
    fieldErrors,
    isSubmitting,
    submitDraft,
    submitIssue,
  } = useInvoiceCreate();

  /** Practitioner workspace (patients, encounters). */
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  /** Patient row hospital — prefer for charge catalog so seeds match the org patients belong to. */
  const [patientHospitalId, setPatientHospitalId] = useState<string | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientOpen, setPatientOpen] = useState(false);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientOptions, setPatientOptions] = useState<PatientOpt[]>([]);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState("");

  const [encounters, setEncounters] = useState<EncounterOpt[]>([]);
  const [encLoading, setEncLoading] = useState(false);
  const [billingAccts, setBillingAccts] = useState<BillingAcctOpt[]>([]);
  const [acctLoading, setAcctLoading] = useState(false);
  const patientPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  useEffect(() => {
    if (!patientId) {
      setPatientHospitalId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("patients").select("hospital_id").eq("id", patientId).maybeSingle();
      if (cancelled) return;
      const ph = data?.hospital_id;
      setPatientHospitalId(ph != null && ph !== "" ? String(ph).trim() : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const chargeCatalogHospitalId = patientHospitalId ?? hospitalId;

  useEffect(() => {
    if (!patientOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!patientPickerRef.current?.contains(e.target as Node)) setPatientOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [patientOpen]);

  const searchPatients = useCallback(
    async (q: string) => {
      if (!hospitalId) return;
      setPatientLoading(true);
      try {
        const raw = q.trim().replace(/%/g, "");
        let qb = supabase
          .from("patients")
          .select("id, full_name, docpad_id, phone")
          .eq("hospital_id", hospitalId)
          .order("full_name", { ascending: true })
          .limit(25);
        if (raw.length > 0) {
          const term = `%${raw}%`;
          qb = qb.or(`full_name.ilike.${term},docpad_id.ilike.${term},phone.ilike.${term}`);
        }
        const { data, error } = await qb;
        if (error) {
          setPatientOptions([]);
          return;
        }
        setPatientOptions((data ?? []) as PatientOpt[]);
      } finally {
        setPatientLoading(false);
      }
    },
    [hospitalId],
  );

  useEffect(() => {
    if (!patientOpen || !hospitalId) return;
    const t = window.setTimeout(() => void searchPatients(patientQuery), 220);
    return () => window.clearTimeout(t);
  }, [patientOpen, patientQuery, hospitalId, searchPatients]);

  useEffect(() => {
    if (!patientId || !hospitalId) {
      setEncounters([]);
      setBillingAccts([]);
      return;
    }
    setEncLoading(true);
    void (async () => {
      const { data: enc } = await supabase
        .from("opd_encounters")
        .select("id, encounter_date, status")
        .eq("patient_id", patientId)
        .eq("hospital_id", hospitalId)
        .order("encounter_date", { ascending: false, nullsFirst: false })
        .limit(50);
      setEncounters((enc ?? []) as EncounterOpt[]);
      setEncLoading(false);
    })();

    setAcctLoading(true);
    void (async () => {
      const { data: ac, error: acctErr } = await supabase
        .from("patient_billing_accounts")
        .select("id, label, account_type")
        .eq("patient_id", patientId)
        .eq("hospital_id", hospitalId)
        .order("is_default", { ascending: false })
        .order("label", { ascending: true });
      if (acctErr) {
        // Remote DB may not have this table yet (404 / schema cache) — self-pay still works.
        setBillingAccts([]);
      } else {
        setBillingAccts((ac ?? []) as BillingAcctOpt[]);
      }
      setAcctLoading(false);
    })();
  }, [patientId, hospitalId]);

  const onPickPatient = useCallback(
    (p: PatientOpt) => {
      setPatientId(p.id);
      const label = [p.full_name, p.docpad_id].filter(Boolean).join(" · ") || p.id.slice(0, 8);
      setSelectedPatientLabel(label);
      setPatientOpen(false);
      setOpdEncounterId(null);
      setBillingAccountId(null);
    },
    [setPatientId, setOpdEncounterId, setBillingAccountId],
  );

  const onSelectCharge = useCallback(
    (clientId: string, row: ChargeDefinitionOption | null) => {
      if (!row) {
        updateLine(clientId, {
          definitionId: null,
          displayName: "",
          code: "",
          unitPrice: 0,
          category: "",
          codeSystem: "http://snomed.info/sct",
        });
        return;
      }
      updateLine(clientId, {
        definitionId: row.id,
        displayName: row.display_name,
        code: row.code,
        codeSystem: row.code_system,
        category: row.category,
        unitPrice: row.base_price,
      });
    },
    [updateLine],
  );

  const lineRows = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        net: computeLineNet(line),
      })),
    [lines],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">New invoice</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Create a draft or issue an invoice with line items.</p>
        </div>
        <Link
          href="/billing"
          className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to billing
        </Link>
      </div>

      {(validationMessage || fieldErrors.patientId || fieldErrors.lines) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {validationMessage}
          {fieldErrors.patientId ? <p className="mt-1 font-medium">{fieldErrors.patientId}</p> : null}
          {fieldErrors.lines ? <p className="mt-1 font-medium">{fieldErrors.lines}</p> : null}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Patient & visit</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Patient</label>
            <div className="relative" ref={patientPickerRef}>
              <button
                type="button"
                onClick={() => setPatientOpen((o) => !o)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              >
                <UserRoundSearch className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{selectedPatientLabel || "Search patient…"}</span>
              </button>
              {patientOpen ? (
                <div className="absolute z-40 mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-900">
                  <input
                    type="search"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    placeholder="Name, DocPad ID, phone…"
                    className="mb-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    autoFocus
                  />
                  <div className="max-h-52 overflow-auto">
                    {patientLoading ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Searching…
                      </div>
                    ) : patientOptions.length === 0 ? (
                      <p className="py-3 text-center text-sm text-slate-500">No patients found.</p>
                    ) : (
                      <ul>
                        {patientOptions.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                              onClick={() => onPickPatient(p)}
                            >
                              <span className="font-medium text-slate-900 dark:text-slate-100">{p.full_name ?? "—"}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {p.docpad_id ?? "—"}
                                {p.phone ? ` · ${p.phone}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Encounter (optional)</label>
            <select
              value={opdEncounterId ?? ""}
              onChange={(e) => setOpdEncounterId(e.target.value || null)}
              disabled={!patientId || encLoading}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">— None —</option>
              {encounters.map((e) => (
                <option key={e.id} value={e.id}>
                  {(e.encounter_date ?? "Visit").slice(0, 10)} · {e.status ?? "status unknown"}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Billing account</label>
            <select
              value={billingAccountId ?? ""}
              onChange={(e) => setBillingAccountId(e.target.value || null)}
              disabled={!patientId || acctLoading}
              className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">Self-pay (default)</option>
              {billingAccts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.account_type ? ` (${a.account_type})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Due date (optional)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Line items</h2>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add line
          </button>
        </div>

        <div className="mt-4 space-y-6">
          {lineRows.map((line) => (
            <div
              key={line.clientId}
              className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50 md:p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <ChargeItemSelector
                  hospitalId={chargeCatalogHospitalId}
                  valueId={line.definitionId}
                  onSelect={(row) => onSelectCharge(line.clientId, row)}
                  disabled={!chargeCatalogHospitalId}
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.clientId)}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-red-900 dark:hover:bg-red-950/40"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Qty
                  <input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={line.quantity || ""}
                    onChange={(e) => updateLine(line.clientId, { quantity: parseFloat(e.target.value) || 0 })}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Unit price
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitPrice || ""}
                    onChange={(e) => updateLine(line.clientId, { unitPrice: parseFloat(e.target.value) || 0 })}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Discount %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={line.discountPercent || ""}
                    onChange={(e) => updateLine(line.clientId, { discountPercent: parseFloat(e.target.value) || 0 })}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <label className="col-span-1 flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Tax %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={line.taxPercent || ""}
                    onChange={(e) => updateLine(line.clientId, { taxPercent: parseFloat(e.target.value) || 0 })}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
                <div className="col-span-2 flex flex-col justify-end sm:col-span-3 lg:col-span-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Net amount</span>
                  <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatInr(line.net)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 text-sm dark:border-slate-700">
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <span>Total net</span>
            <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatInr(totals.totalNet)}</span>
          </div>
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <span>Total discount</span>
            <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatInr(totals.totalDiscount)}</span>
          </div>
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <span>Total tax</span>
            <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatInr(totals.totalTax)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-700">
            <span className="text-slate-800 dark:text-slate-200">Total gross</span>
            <span className="tabular-nums text-blue-700 dark:text-blue-300">{formatInr(totals.totalGross)}</span>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Internal notes…"
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
        />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void submitDraft()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save draft
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void submitIssue()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Issue invoice
        </button>
      </div>
    </div>
  );
}
