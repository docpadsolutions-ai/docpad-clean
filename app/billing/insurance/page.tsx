"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type TabKey = "preauths" | "claims" | "panels";

type KpiRow = {
  pending_preauths_count: number;
  claims_in_review_count: number;
  settlement_due_total: number;
};

type PreauthRow = {
  id: string;
  patient_id: string;
  patient_full_name: string;
  insurance_name: string;
  requested_amount: number;
  status: string;
  days_pending: number;
};

type ClaimRow = {
  id: string;
  claim_number: string;
  patient_full_name: string;
  billed_amount: number;
  approved_amount: number;
  settled_amount: number;
  status: string;
  settlement_due_date: string | null;
};

type PanelRow = {
  id: string;
  corporate_name: string;
  agreement_reference: string | null;
  credit_limit: number;
  utilized_amount: number;
  is_active: boolean;
};

type CompanyOpt = { id: string; name: string };

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function daysPendingUtc(submittedAt: string | null, createdAt: string | null): number {
  const raw = submittedAt ?? createdAt;
  if (!raw) return 0;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((todayDay - startDay) / 86400000));
}

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

function InsuranceStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls =
    "bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600";
  if (s === "pending" || s === "submitted" || s === "draft" || s === "in_review") {
    cls =
      "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900";
  }
  if (s === "approved" || s === "settled") {
    cls =
      "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900";
  }
  if (s === "rejected" || s === "expired") {
    cls = "bg-red-100 text-red-900 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900";
  }
  if (s === "partial_settled") {
    cls =
      "bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-900";
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function InsuranceBillingDashboardPage() {
  const [tab, setTab] = useState<TabKey>("preauths");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<KpiRow | null>(null);
  const [preauths, setPreauths] = useState<PreauthRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [panels, setPanels] = useState<PanelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showClaimModal, setShowClaimModal] = useState(false);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [claimPatientId, setClaimPatientId] = useState("");
  const [claimBilled, setClaimBilled] = useState("");
  const [claimCompanyId, setClaimCompanyId] = useState<string>("");
  const [claimDue, setClaimDue] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCompanies = useCallback(async (hid: string) => {
    const { data } = await supabase.from("insurance_companies").select("id, name").eq("hospital_id", hid).eq("is_active", true).order("name");
    setCompanies(((data ?? []) as { id: string; name: string }[]).map((c) => ({ id: String(c.id), name: String(c.name) })));
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();

      const { data: kData, error: kErr } = await supabase.rpc("get_insurance_billing_kpis");
      if (kErr) throw new Error(kErr.message);
      const kr = Array.isArray(kData) ? kData[0] : kData;
      if (kr && typeof kr === "object") {
        const o = kr as Record<string, unknown>;
        setKpis({
          pending_preauths_count: Math.round(n(o.pending_preauths_count)),
          claims_in_review_count: Math.round(n(o.claims_in_review_count)),
          settlement_due_total: n(o.settlement_due_total),
        });
      } else {
        setKpis({ pending_preauths_count: 0, claims_in_review_count: 0, settlement_due_total: 0 });
      }

      if (!hid) {
        setPreauths([]);
      } else {
        const { data: pData, error: pErr } = await supabase
          .from("preauth_requests")
          .select(
            `
            *,
            patients!patient_id(full_name),
            coverage:patient_insurance_coverage!patient_insurance_coverage_id(
              insurance_company:insurance_companies!insurance_company_id(company_name:name)
            )
          `,
          )
          .eq("hospital_id", hid)
          .in("status", ["pending", "submitted", "in_review"])
          .order("submitted_at", { ascending: false });
        if (pErr) throw new Error(pErr.message);
        setPreauths(
          ((pData ?? []) as Record<string, unknown>[]).map((row) => {
            const patients = row.patients;
            const patientRow = (Array.isArray(patients) ? patients[0] : patients) as { full_name?: string | null } | undefined;
            const coverageRaw = row.coverage;
            const coverageRow = (Array.isArray(coverageRaw) ? coverageRaw[0] : coverageRaw) as
              | { insurance_company?: { company_name?: string | null } | { company_name?: string | null }[] | null }
              | undefined;
            const icRaw = coverageRow?.insurance_company;
            const insuranceRow = (Array.isArray(icRaw) ? icRaw[0] : icRaw) as { company_name?: string | null } | undefined;
            const submittedAt = row.submitted_at != null ? String(row.submitted_at) : null;
            const createdAt = row.created_at != null ? String(row.created_at) : null;
            return {
              id: String(row.id),
              patient_id: String(row.patient_id),
              patient_full_name: String(patientRow?.full_name || "—"),
              insurance_name: String(insuranceRow?.company_name || "—"),
              requested_amount: n(row.requested_amount),
              status: String(row.status ?? ""),
              days_pending: daysPendingUtc(submittedAt, createdAt),
            };
          }),
        );
      }

      const { data: cData, error: cErr } = await supabase.rpc("get_claims_summary");
      if (cErr) throw new Error(cErr.message);
      setClaims(
        ((cData ?? []) as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          claim_number: String(r.claim_number ?? ""),
          patient_full_name: String(r.patient_full_name ?? "—"),
          billed_amount: n(r.billed_amount),
          approved_amount: n(r.approved_amount),
          settled_amount: n(r.settled_amount),
          status: String(r.status ?? ""),
          settlement_due_date: r.settlement_due_date != null ? String(r.settlement_due_date).slice(0, 10) : null,
        })),
      );

      setHospitalId(hid);
      if (hid) {
        const { data: panData, error: panErr } = await supabase
          .from("insurance_corporate_panels")
          .select("id, corporate_name, agreement_reference, credit_limit, utilized_amount, is_active")
          .eq("hospital_id", hid)
          .order("corporate_name");
        if (panErr) throw new Error(panErr.message);
        setPanels(
          ((panData ?? []) as Record<string, unknown>[]).map((r) => ({
            id: String(r.id),
            corporate_name: String(r.corporate_name ?? ""),
            agreement_reference: r.agreement_reference != null ? String(r.agreement_reference) : null,
            credit_limit: n(r.credit_limit),
            utilized_amount: n(r.utilized_amount),
            is_active: Boolean(r.is_active),
          })),
        );
        await loadCompanies(hid);
      } else {
        setPanels([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insurance data");
      setKpis(null);
    } finally {
      setLoading(false);
    }
  }, [loadCompanies]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitClaim = useCallback(async () => {
    if (!hospitalId) {
      toast.error("No hospital context.");
      return;
    }
    const pid = claimPatientId.trim();
    const billed = Number.parseFloat(claimBilled.replace(/,/g, ""));
    if (!pid) {
      toast.error("Enter patient ID (UUID) or use preauth flow patient search in a follow-up.");
      return;
    }
    if (!Number.isFinite(billed) || billed < 0) {
      toast.error("Enter billed amount.");
      return;
    }
    const year = new Date().getFullYear();
    const claim_number = `CLM-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
    setSaving(true);
    try {
      const row: Record<string, unknown> = {
        hospital_id: hospitalId,
        patient_id: pid,
        claim_number,
        billed_amount: billed,
        approved_amount: 0,
        settled_amount: 0,
        status: "draft",
        submitted_at: null,
      };
      if (claimCompanyId && claimCompanyId !== "__none__") {
        row.insurance_company_id = claimCompanyId;
      }
      if (claimDue.trim()) {
        row.settlement_due_date = claimDue.trim();
      }
      const { error: insErr } = await supabase.from("insurance_claims").insert(row);
      if (insErr) throw new Error(insErr.message);
      toast.success(`Claim ${claim_number} saved as draft. Open Claims to edit or submit.`);
      setShowClaimModal(false);
      setClaimPatientId("");
      setClaimBilled("");
      setClaimCompanyId("");
      setClaimDue("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [hospitalId, claimPatientId, claimBilled, claimCompanyId, claimDue, refresh]);

  const tabBtn = (id: TabKey, label: string) => (
    <button
      type="button"
      key={id}
      onClick={() => setTab(id)}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        tab === id
          ? "bg-blue-600 text-white shadow-sm"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/billing" className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
              ← Billing
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Insurance management</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Preauthorizations, claims, and corporate panels for your hospital.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" asChild>
              <Link href="/billing/insurance/preauth/new">Submit preauth</Link>
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowClaimModal(true)}>
              New claim
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pending preauths</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {loading ? "—" : kpis?.pending_preauths_count ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 dark:text-slate-400">Awaiting payer (pending / submitted / in review)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Claims in review</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {loading ? "—" : kpis?.claims_in_review_count ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 dark:text-slate-400">With payer adjudication in progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Settlement due</CardDescription>
              <CardTitle className="text-3xl tabular-nums text-amber-800 dark:text-amber-200">
                {loading ? "—" : formatInr(kpis?.settlement_due_total ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500 dark:text-slate-400">Approved but not fully settled</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 dark:border-slate-700">
          {tabBtn("preauths", "Preauths")}
          {tabBtn("claims", "Claims")}
          {tabBtn("panels", "Panels")}
        </div>

        {tab === "preauths" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preauthorizations</CardTitle>
              <CardDescription>Open requests (including drafts), newest first.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 md:p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Insurance</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Days pending</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preauths.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500">
                          {loading ? "Loading…" : "No pending preauths."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      preauths.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.patient_full_name}</TableCell>
                          <TableCell>{r.insurance_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInr(r.requested_amount)}</TableCell>
                          <TableCell>
                            <InsuranceStatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.days_pending}</TableCell>
                          <TableCell className="text-right">
                            <Button type="button" variant="outline" size="sm" asChild>
                              <Link
                                href={
                                  r.status.toLowerCase() === "draft"
                                    ? `/billing/insurance/preauth/edit/${r.id}`
                                    : `/billing/insurance/preauth/${r.id}`
                                }
                              >
                                {r.status.toLowerCase() === "draft" ? "Edit" : "View"}
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "claims" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Claims</CardTitle>
              <CardDescription>All claims including drafts, newest first.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 md:p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim #</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Settled</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-slate-500">
                          {loading ? "Loading…" : "No claims yet."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      claims.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-sm">{r.claim_number}</TableCell>
                          <TableCell>{r.patient_full_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInr(r.billed_amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInr(r.approved_amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatInr(r.settled_amount)}</TableCell>
                          <TableCell>
                            <InsuranceStatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button type="button" variant="outline" size="sm" asChild>
                              <Link
                                href={
                                  r.status.toLowerCase() === "draft"
                                    ? `/billing/insurance/claims/edit/${r.id}`
                                    : `/billing/insurance/claims/${r.id}`
                                }
                              >
                                {r.status.toLowerCase() === "draft" ? "Edit" : "View"}
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tab === "panels" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Corporate panels</CardTitle>
              <CardDescription>Agreements and credit utilization.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 md:p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Corporate</TableHead>
                      <TableHead>Agreement</TableHead>
                      <TableHead className="text-right">Credit limit</TableHead>
                      <TableHead className="text-right">Utilized</TableHead>
                      <TableHead className="text-right">Utilization</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {panels.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500">
                          {loading ? "Loading…" : "No panel agreements. Add rows in insurance_corporate_panels."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      panels.map((p) => {
                        const pct = p.credit_limit > 0 ? Math.min(100, Math.round((p.utilized_amount / p.credit_limit) * 100)) : 0;
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.corporate_name}</TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">{p.agreement_reference ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatInr(p.credit_limit)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatInr(p.utilized_amount)}</TableCell>
                            <TableCell className="text-right tabular-nums">{pct}%</TableCell>
                            <TableCell>
                              {p.is_active ? (
                                <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900">
                                  Active
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600">
                                  Inactive
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {showClaimModal ? (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowClaimModal(false);
            }}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-600 dark:bg-slate-900"
              role="dialog"
              aria-modal="true"
            >
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">New claim (draft)</h2>
              <p className="mt-1 text-xs text-slate-500">Claim number is generated automatically. Finish and submit from the Claims tab.</p>
              <div className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="cl-pid">Patient ID (UUID)</Label>
                  <Input
                    id="cl-pid"
                    className="mt-1.5 font-mono text-sm"
                    placeholder="Paste patient UUID"
                    value={claimPatientId}
                    onChange={(e) => setClaimPatientId(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Insurer (optional)</Label>
                  <Select value={claimCompanyId || "__none__"} onValueChange={(v) => setClaimCompanyId(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Select payer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="cl-billed">Billed amount (₹)</Label>
                  <Input id="cl-billed" className="mt-1.5" inputMode="decimal" value={claimBilled} onChange={(e) => setClaimBilled(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="cl-due">Settlement due (optional)</Label>
                  <Input id="cl-due" type="date" className="mt-1.5" value={claimDue} onChange={(e) => setClaimDue(e.target.value)} />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowClaimModal(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitClaim()} disabled={saving}>
                  {saving ? "Saving…" : "Create draft"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
