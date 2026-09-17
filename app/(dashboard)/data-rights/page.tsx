"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  CORRECTABLE_FIELDS,
  applyPatientCorrection,
  getGrievanceOfficer,
  listDataPrincipalRequests,
  reviewDataPrincipalRequest,
  updateGrievanceOfficer,
  type DataPrincipalRequest,
  type GrievanceOfficer,
} from "@/lib/dpdpa";

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "under_review", label: "Under review" },
  { key: "actioned", label: "Actioned" },
  { key: "rejected", label: "Rejected" },
  { key: "closed", label: "Closed" },
];

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The grievance register: every access, correction, erasure request and complaint
 * the hospital has received, with the 30-day clock the DPDP Act puts on answering
 * them, plus the grievance officer contact that has to be published.
 */
export default function DataRightsPage() {
  const [rows, setRows] = useState<DataPrincipalRequest[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [officer, setOfficer] = useState<GrievanceOfficer | null>(null);
  const [editingOfficer, setEditingOfficer] = useState(false);
  const [officerForm, setOfficerForm] = useState({ name: "", email: "", phone: "", years: "" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, o] = await Promise.all([listDataPrincipalRequests(filter || null), getGrievanceOfficer()]);
      if (cancelled) return;
      setRows(list);
      setOfficer(o);
      setOfficerForm({
        name: o?.name ?? "",
        email: o?.email ?? "",
        phone: o?.phone ?? "",
        years: o?.data_retention_years != null ? String(o.data_retention_years) : "",
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  async function reload() {
    setRows(await listDataPrincipalRequests(filter || null));
  }

  async function onReview(r: DataPrincipalRequest, status: "under_review" | "actioned" | "rejected" | "closed") {
    const resolution =
      status === "rejected" || status === "closed"
        ? window.prompt("Note for the record (what was decided and why)") ?? ""
        : "";
    setBusyId(r.id);
    const e = await reviewDataPrincipalRequest(r.id, status, resolution);
    setBusyId(null);
    if (e) {
      setError(e);
      return;
    }
    setNotice(`Request marked ${status.replace("_", " ")}.`);
    await reload();
  }

  async function onCorrect(r: DataPrincipalRequest) {
    const field = window.prompt(
      `Which field? One of:\n${CORRECTABLE_FIELDS.map((f) => f.key).join(", ")}`,
    );
    if (!field) return;
    const value = window.prompt(`New value for ${field}`);
    if (value == null) return;
    setBusyId(r.id);
    const e = await applyPatientCorrection(r.id, field.trim(), value);
    setBusyId(null);
    if (e) {
      setError(e);
      return;
    }
    setNotice("Correction applied. The before and after are in the audit log.");
    await reload();
  }

  async function onSaveOfficer() {
    const e = await updateGrievanceOfficer({
      name: officerForm.name,
      email: officerForm.email,
      phone: officerForm.phone,
      dataRetentionYears: officerForm.years.trim() ? Number(officerForm.years) : null,
    });
    if (e) {
      setError(e);
      return;
    }
    setOfficer(await getGrievanceOfficer());
    setEditingOfficer(false);
    setNotice("Grievance officer updated.");
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Privacy &amp; data rights</h1>
          <p className="text-sm text-slate-600">
            Requests and complaints from patients about their personal data, and the grievance officer
            published to them.
          </p>
        </header>

        {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        {notice ? <p className="text-sm font-medium text-emerald-700">{notice}</p> : null}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden />
              <h2 className="text-base font-bold text-slate-900">Grievance officer</h2>
            </div>
            <button
              type="button"
              onClick={() => setEditingOfficer((v) => !v)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {editingOfficer ? "Cancel" : "Edit"}
            </button>
          </div>

          {editingOfficer ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["name", "Officer name"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ["years", "Retention (years)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs font-medium text-slate-700">
                  {label}
                  <input
                    type="text"
                    value={officerForm[key]}
                    onChange={(e) => setOfficerForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900"
                  />
                </label>
              ))}
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => void onSaveOfficer()}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Save
                </button>
              </div>
            </div>
          ) : officer?.name ? (
            <p className="mt-2 text-sm text-slate-700">
              {officer.name}
              {officer.phone ? ` · ${officer.phone}` : ""}
              {officer.email ? ` · ${officer.email}` : ""}
              {officer.data_retention_years ? ` · records kept ${officer.data_retention_years} years` : ""}
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Not set. The DPDP Act requires a grievance officer to be published to patients.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  filter === f.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="px-5 py-8 text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-500">Nothing here.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{r.subject}</p>
                      <p className="text-xs text-slate-600">
                        {r.request_type} · {r.status} ·{" "}
                        {r.patient_id ? (
                          <Link
                            href={`/dashboard/patients/${r.patient_id}/privacy`}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            {r.patient_name ?? "patient"}
                          </Link>
                        ) : (
                          "no patient linked"
                        )}{" "}
                        · raised {shortDate(r.raised_at)} · due {shortDate(r.sla_due_at)}
                      </p>
                      {r.details ? <p className="mt-1 text-xs text-slate-600">{r.details}</p> : null}
                      {r.applied_changes?.length ? (
                        <p className="mt-1 text-xs text-slate-600">
                          Changed{" "}
                          {r.applied_changes
                            .map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`)
                            .join("; ")}
                        </p>
                      ) : null}
                      {r.resolution ? (
                        <p className="mt-1 text-xs italic text-slate-600">{r.resolution}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {r.overdue ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700 ring-1 ring-red-200">
                          overdue
                        </span>
                      ) : null}
                      {r.status === "open" ? (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void onReview(r, "under_review")}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Start review
                        </button>
                      ) : null}
                      {r.request_type === "correction" && r.patient_id && r.status !== "actioned" ? (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void onCorrect(r)}
                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          Apply correction
                        </button>
                      ) : null}
                      {r.status !== "closed" && r.status !== "rejected" ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void onReview(r, "closed")}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Close
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void onReview(r, "rejected")}
                            className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
