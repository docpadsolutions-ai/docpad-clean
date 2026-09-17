"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchHospitalIdFromPractitionerAuthId } from "@/lib/authOrg";
import { supabase } from "@/lib/supabase";
import { PatientAvatar } from "@/components/patient/patient-avatar";
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
  policy_number: string;
  requested_amount: number;
  status: string;
  days_pending: number;
};

type ClaimRow = {
  id: string;
  claim_number: string;
  patient_id: string;
  patient_full_name: string;
  insurance_name: string;
  billed_amount: number;
  approved_amount: number;
  settled_amount: number;
  status: string;
};

type PanelRow = {
  id: string;
  scheme_type: string;
  insurer_name: string;
  tpa_name: string;
  empanelment_number: string | null;
  portal_link: string | null;
  is_active: boolean;
};

type CoverageOption = {
  coverage_id: string;
  insurance_company_id: string | null;
  tpa_id: string | null;
  policy_number: string;
  insurer_name: string;
  tpa_name: string;
};

type PatientSearchHit = { id: string; full_name: string; uhid: string | null };

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function daysPendingUtc(raw: string | null): number {
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

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  submitted: "bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:ring-blue-800",
  pending: "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900",
  in_review: "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900",
  approved: "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900",
  settled: "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900",
  rejected: "bg-red-100 text-red-900 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900",
  expired: "bg-red-100 text-red-900 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900",
  queried: "bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-900",
  partial_settled: "bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-900",
};

function InsuranceStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls = STATUS_COLORS[s] ?? STATUS_COLORS.draft;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const SCHEME_BADGE: Record<string, string> = {
  tpa: "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  direct: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  government: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  corporate: "bg-purple-50 text-purple-800 dark:bg-purple-950/40 dark:text-purple-200",
};

function SchemeBadge({ type }: { type: string }) {
  const cls = SCHEME_BADGE[type.toLowerCase()] ?? SCHEME_BADGE.direct;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{type}</span>;
}

/** Modal / form inputs — dark theme (insurance module) */
const insModalInput =
  "border border-gray-700 bg-gray-800 text-white shadow-sm placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";
const insCard =
  "shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:shadow-none";
const insTableShell =
  "overflow-x-auto rounded-b-xl border-x border-b border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900";
const insTh =
  "h-10 border-gray-800 bg-gray-800 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-gray-400";
const insTr =
  "border-b border-slate-200 bg-white text-slate-900 hover:bg-slate-50/80 dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800";
const insTd = "p-3 align-middle text-slate-900 dark:text-white";
const insSecondaryBtn =
  "border border-gray-700 bg-gray-800 text-white hover:bg-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700";
const insSelectContent = "border border-gray-700 bg-gray-900 text-white";

export default function InsuranceBillingDashboardPage() {
  const [tab, setTab] = useState<TabKey>("preauths");
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<KpiRow | null>(null);
  const [preauths, setPreauths] = useState<PreauthRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [panels, setPanels] = useState<PanelRow[]>([]);
  const [loading, setLoading] = useState(true);

  // --- New Claim modal ---
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimPatientSearch, setClaimPatientSearch] = useState("");
  const [claimPatientOpts, setClaimPatientOpts] = useState<PatientSearchHit[]>([]);
  const [claimPatientId, setClaimPatientId] = useState("");
  const [claimPatientLabel, setClaimPatientLabel] = useState("");
  const [claimCoverages, setClaimCoverages] = useState<CoverageOption[]>([]);
  const [claimCoverageId, setClaimCoverageId] = useState("");
  const [claimBilled, setClaimBilled] = useState("");
  const [saving, setSaving] = useState(false);
  const claimSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Add Panel modal ---
  const [showPanelModal, setShowPanelModal] = useState(false);
  const [panelSchemeType, setPanelSchemeType] = useState("tpa");
  const [panelInsurerId, setPanelInsurerId] = useState("");
  const [panelTpaId, setPanelTpaId] = useState("");
  const [panelEmpanelment, setPanelEmpanelment] = useState("");
  const [panelPortalLink, setPanelPortalLink] = useState("");
  const [insurerOpts, setInsurerOpts] = useState<{ id: string; name: string }[]>([]);
  const [tpaOpts, setTpaOpts] = useState<{ id: string; name: string }[]>([]);
  const [panelSaving, setPanelSaving] = useState(false);

  // ──────────────────── KPIs (Task 5) ────────────────────
  const loadKpis = useCallback(async (hid: string) => {
    const [preauthRes, claimsReviewRes, settlementRes] = await Promise.all([
      supabase
        .from("insurance_preauths")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hid)
        .in("status", ["draft", "submitted", "in_review"]),
      supabase
        .from("insurance_claims")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hid)
        .in("status", ["submitted", "in_review", "queried"]),
      supabase
        .from("insurance_claims")
        .select("claimed_amount, settled_amount")
        .eq("hospital_id", hid)
        .eq("status", "approved"),
    ]);
    const pendingCount = preauthRes.count ?? 0;
    const reviewCount = claimsReviewRes.count ?? 0;
    const settlementRows = (settlementRes.data ?? []) as { claimed_amount: unknown; settled_amount: unknown }[];
    const due = settlementRows.reduce((acc, r) => acc + n(r.claimed_amount) - n(r.settled_amount), 0);
    setKpis({ pending_preauths_count: pendingCount, claims_in_review_count: reviewCount, settlement_due_total: Math.max(0, due) });
  }, []);

  // ──────────────────── Preauths list (flat `insurance_preauths_view` — no nested selects) ────────────────────
  const loadPreauths = useCallback(async (hid: string) => {
    const { data, error } = await supabase
      .from("insurance_preauths_view")
      .select(
        "id, patient_id, patient_name, insurer_name, tpa_name, policy_number, encounter_date, diagnosis_icd10, requested_amount, status, request_date, created_at",
      )
      .eq("hospital_id", hid)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    setPreauths(
      ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        patient_id: String(row.patient_id ?? ""),
        patient_full_name: String(row.patient_name ?? "—"),
        insurance_name: String(row.insurer_name ?? "—"),
        policy_number: String(row.policy_number ?? ""),
        requested_amount: n(row.requested_amount),
        status: String(row.status ?? "draft"),
        days_pending: daysPendingUtc(
          row.request_date != null ? String(row.request_date) : row.created_at != null ? String(row.created_at) : null,
        ),
      })),
    );
  }, []);

  // ──────────────────── Claims list (flat `insurance_claims_view` — no nested selects) ────────────────────
  const loadClaims = useCallback(async (hid: string) => {
    const { data, error } = await supabase
      .from("insurance_claims_view")
      .select(
        "id, claim_number, patient_id, patient_name, insurer_name, billed_amount, approved_amount, settled_amount, status, created_at",
      )
      .eq("hospital_id", hid)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    setClaims(
      ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        claim_number: String(row.claim_number ?? ""),
        patient_id: String(row.patient_id ?? ""),
        patient_full_name: String(row.patient_name ?? "—"),
        insurance_name: String(row.insurer_name ?? "—"),
        billed_amount: n(row.billed_amount),
        approved_amount: n(row.approved_amount),
        settled_amount: n(row.settled_amount),
        status: String(row.status ?? "draft"),
      })),
    );
  }, []);

  // ──────────────────── Panels (Task 4) ────────────────────
  const loadPanels = useCallback(async (hid: string) => {
    const { data, error } = await supabase
      .from("hospital_insurance_config")
      .select(`
        id, scheme_type, empanelment_number, portal_link, is_active,
        insurance_companies!insurance_company_id(name),
        tpas!tpa_id(name)
      `)
      .eq("hospital_id", hid)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    setPanels(
      ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const ic = row.insurance_companies;
        const ins = (Array.isArray(ic) ? ic[0] : ic) as { name?: string } | undefined;
        const tp = row.tpas;
        const tpa = (Array.isArray(tp) ? tp[0] : tp) as { name?: string } | undefined;
        return {
          id: String(row.id),
          scheme_type: String(row.scheme_type ?? "direct"),
          insurer_name: String(ins?.name ?? "—"),
          tpa_name: String(tpa?.name ?? "—"),
          empanelment_number: row.empanelment_number != null ? String(row.empanelment_number) : null,
          portal_link: row.portal_link != null ? String(row.portal_link) : null,
          is_active: Boolean(row.is_active),
        };
      }),
    );
  }, []);

  const loadMasters = useCallback(async (hid: string) => {
    const [{ data: insData }, { data: tpaData }] = await Promise.all([
      supabase.from("insurance_companies").select("id, name").eq("hospital_id", hid).eq("is_active", true).order("name"),
      supabase.from("tpas").select("id, name").eq("hospital_id", hid).eq("is_active", true).order("name"),
    ]);
    setInsurerOpts(((insData ?? []) as { id: string; name: string }[]).map((c) => ({ id: String(c.id), name: String(c.name) })));
    setTpaOpts(((tpaData ?? []) as { id: string; name: string }[]).map((c) => ({ id: String(c.id), name: String(c.name) })));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
      if (!hid) {
        setKpis({ pending_preauths_count: 0, claims_in_review_count: 0, settlement_due_total: 0 });
        setPreauths([]);
        setClaims([]);
        setPanels([]);
        return;
      }
      await Promise.all([loadKpis(hid), loadPreauths(hid), loadClaims(hid), loadPanels(hid), loadMasters(hid)]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load insurance data");
    } finally {
      setLoading(false);
    }
  }, [loadKpis, loadPreauths, loadClaims, loadPanels, loadMasters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ──────────────────── Claim modal: patient search (Task 2) ────────────────────
  useEffect(() => {
    if (!showClaimModal || !hospitalId || claimPatientSearch.trim().length < 2) {
      setClaimPatientOpts([]);
      return;
    }
    if (claimSearchTimer.current) clearTimeout(claimSearchTimer.current);
    claimSearchTimer.current = setTimeout(() => {
      void (async () => {
        const q = claimPatientSearch.trim();
        const { data } = await supabase
          .from("patients")
          .select("id, full_name, uhid")
          .eq("hospital_id", hospitalId)
          .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%`)
          .limit(10);
        setClaimPatientOpts(
          ((data ?? []) as { id: string; full_name: string | null; uhid: string | null }[]).map((p) => ({
            id: p.id,
            full_name: p.full_name?.trim() || "—",
            uhid: p.uhid ?? null,
          })),
        );
      })();
    }, 250);
    return () => { if (claimSearchTimer.current) clearTimeout(claimSearchTimer.current); };
  }, [claimPatientSearch, hospitalId, showClaimModal]);

  const selectClaimPatient = useCallback(
    async (p: PatientSearchHit) => {
      setClaimPatientId(p.id);
      setClaimPatientLabel(p.full_name);
      setClaimPatientSearch(p.full_name);
      setClaimPatientOpts([]);
      if (!hospitalId) return;
      const { data } = await supabase
        .from("patient_insurance_coverage")
        .select(`
          id, insurance_company_id, tpa_id, policy_number,
          insurance_companies!insurance_company_id(name),
          tpas!tpa_id(name)
        `)
        .eq("patient_id", p.id)
        .eq("status", "active");
      const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
        const ic = r.insurance_companies;
        const ins = (Array.isArray(ic) ? ic[0] : ic) as { name?: string } | undefined;
        const tp = r.tpas;
        const tpa = (Array.isArray(tp) ? tp[0] : tp) as { name?: string } | undefined;
        return {
          coverage_id: String(r.id),
          insurance_company_id: r.insurance_company_id != null ? String(r.insurance_company_id) : null,
          tpa_id: r.tpa_id != null ? String(r.tpa_id) : null,
          policy_number: String(r.policy_number ?? ""),
          insurer_name: String(ins?.name ?? "—"),
          tpa_name: String(tpa?.name ?? "—"),
        };
      });
      setClaimCoverages(rows);
      if (rows.length === 1) setClaimCoverageId(rows[0].coverage_id);
      else setClaimCoverageId("");
    },
    [hospitalId],
  );

  const selectedClaimCoverage = useMemo(() => claimCoverages.find((c) => c.coverage_id === claimCoverageId) ?? null, [claimCoverages, claimCoverageId]);

  const submitClaim = useCallback(async () => {
    if (!hospitalId || !claimPatientId) {
      toast.error("Select a patient.");
      return;
    }
    const billed = Number.parseFloat(claimBilled.replace(/,/g, ""));
    if (!Number.isFinite(billed) || billed < 0) {
      toast.error("Enter a valid billed amount.");
      return;
    }
    const claimNumber = `CLM-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    setSaving(true);
    try {
      const row: Record<string, unknown> = {
        hospital_id: hospitalId,
        patient_id: claimPatientId,
        claim_number: claimNumber,
        billed_amount: billed,
        approved_amount: 0,
        settled_amount: 0,
        status: "draft",
      };
      if (claimCoverageId) row.coverage_id = claimCoverageId;
      if (selectedClaimCoverage?.insurance_company_id) row.insurance_company_id = selectedClaimCoverage.insurance_company_id;
      const { error } = await supabase.from("insurance_claims").insert(row);
      if (error) throw new Error(error.message);
      toast.success(`Claim ${claimNumber} saved as draft.`);
      resetClaimModal();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [hospitalId, claimPatientId, claimBilled, claimCoverageId, selectedClaimCoverage, refresh]);

  function resetClaimModal() {
    setShowClaimModal(false);
    setClaimPatientSearch("");
    setClaimPatientOpts([]);
    setClaimPatientId("");
    setClaimPatientLabel("");
    setClaimCoverages([]);
    setClaimCoverageId("");
    setClaimBilled("");
  }

  // ──────────────────── Add Panel modal ────────────────────
  const submitPanel = useCallback(async () => {
    if (!hospitalId) return;
    if (!panelInsurerId) {
      toast.error("Select an insurer.");
      return;
    }
    setPanelSaving(true);
    try {
      const row: Record<string, unknown> = {
        hospital_id: hospitalId,
        insurance_company_id: panelInsurerId,
        scheme_type: panelSchemeType,
        is_active: true,
      };
      if (panelTpaId) row.tpa_id = panelTpaId;
      if (panelEmpanelment.trim()) row.empanelment_number = panelEmpanelment.trim();
      if (panelPortalLink.trim()) row.portal_link = panelPortalLink.trim();
      const { error } = await supabase.from("hospital_insurance_config").insert(row);
      if (error) throw new Error(error.message);
      toast.success("Panel added.");
      setShowPanelModal(false);
      setPanelSchemeType("tpa");
      setPanelInsurerId("");
      setPanelTpaId("");
      setPanelEmpanelment("");
      setPanelPortalLink("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPanelSaving(false);
    }
  }, [hospitalId, panelInsurerId, panelTpaId, panelSchemeType, panelEmpanelment, panelPortalLink, refresh]);

  const togglePanelActive = useCallback(async (id: string, current: boolean) => {
    const { error } = await supabase.from("hospital_insurance_config").update({ is_active: !current }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: !current } : p)));
  }, []);

  // ──────────────────── Tab button ────────────────────
  const tabBtn = (id: TabKey, label: string) => (
    <button
      type="button"
      key={id}
      onClick={() => setTab(id)}
      className={`rounded-lg px-4 py-2 text-sm transition ${
        tab === id
          ? "bg-white font-medium text-gray-900 dark:bg-white dark:text-gray-900"
          : "border border-gray-700 bg-transparent text-gray-400 hover:text-white dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  // ──────────────────── Skeleton ────────────────────
  const kpiSkeleton = (
    <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:border dark:border-gray-800 dark:bg-gray-900" />
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-transparent">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/billing" className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
              ← Billing
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Insurance management</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-gray-400">Preauthorizations, claims, and hospital insurance panels.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" asChild className={insSecondaryBtn}>
              <Link href="/billing/insurance/preauth/new">Submit preauth</Link>
            </Button>
            <Button type="button" variant="secondary" className={insSecondaryBtn} onClick={() => setShowClaimModal(true)}>
              New claim
            </Button>
          </div>
        </header>

        {/* ──────── KPI cards (Task 5) ──────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {loading ? (
            <>{kpiSkeleton}{kpiSkeleton}{kpiSkeleton}</>
          ) : (
            <>
              <Card className={insCard}>
                <CardHeader className="pb-2">
                  <CardDescription className="dark:text-gray-400">Pending preauths</CardDescription>
                  <CardTitle className="text-3xl tabular-nums dark:text-white">{kpis?.pending_preauths_count ?? 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-500 dark:text-gray-400">Draft / submitted / in review</p>
                </CardContent>
              </Card>
              <Card className={insCard}>
                <CardHeader className="pb-2">
                  <CardDescription className="dark:text-gray-400">Claims in review</CardDescription>
                  <CardTitle className="text-3xl tabular-nums dark:text-white">{kpis?.claims_in_review_count ?? 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-500 dark:text-gray-400">Submitted / in review / queried</p>
                </CardContent>
              </Card>
              <Card className={insCard}>
                <CardHeader className="pb-2">
                  <CardDescription className="dark:text-gray-400">Settlement due</CardDescription>
                  <CardTitle className="text-3xl tabular-nums text-amber-800 dark:text-amber-200">
                    {formatInr(kpis?.settlement_due_total ?? 0)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-500 dark:text-gray-400">Approved but not fully settled</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* ──────── Tabs (Task 7 — consistent active state) ──────── */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 dark:border-gray-800">
          {tabBtn("preauths", "Preauths")}
          {tabBtn("claims", "Claims")}
          {tabBtn("panels", "Panels")}
        </div>

        {/* ──────── Preauths tab (Task 4) ──────── */}
        {tab === "preauths" ? (
          <Card className={insCard}>
            <CardHeader className="border-b border-slate-200 dark:border-gray-800">
              <CardTitle className="text-base dark:text-white">Preauthorizations</CardTitle>
              <CardDescription className="dark:text-gray-400">All requests, newest first.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 md:p-0">
              <div className={insTableShell}>
                <Table>
                  <TableHeader className="bg-gray-800 [&_tr]:border-gray-800 [&_tr]:hover:bg-gray-800">
                    <TableRow className="border-gray-800 bg-gray-800 hover:bg-gray-800">
                      <TableHead className={insTh}>Patient</TableHead>
                      <TableHead className={insTh}>Insurer</TableHead>
                      <TableHead className={insTh}>Policy #</TableHead>
                      <TableHead className={`${insTh} text-right`}>Amount</TableHead>
                      <TableHead className={insTh}>Status</TableHead>
                      <TableHead className={`${insTh} text-right`}>Days pending</TableHead>
                      <TableHead className={`${insTh} text-right`}>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preauths.length === 0 ? (
                      <TableRow className={insTr}>
                        <TableCell colSpan={7} className={`${insTd} text-center text-slate-500 dark:text-gray-400`}>
                          {loading ? "Loading…" : "No preauths found."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      preauths.map((r) => (
                        <TableRow key={r.id} className={insTr}>
                          <TableCell className={`font-medium ${insTd}`}>
                            <div className="flex min-w-0 items-center gap-2">
                              <PatientAvatar patientId={r.patient_id || r.id} patientName={r.patient_full_name} size="sm" />
                              <span className="min-w-0 truncate">{r.patient_full_name}</span>
                            </div>
                          </TableCell>
                          <TableCell className={insTd}>{r.insurance_name}</TableCell>
                          <TableCell className={`font-mono text-xs ${insTd}`}>{r.policy_number || "—"}</TableCell>
                          <TableCell className={`text-right tabular-nums ${insTd}`}>{formatInr(r.requested_amount)}</TableCell>
                          <TableCell className={insTd}>
                            <InsuranceStatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${insTd}`}>{r.days_pending}</TableCell>
                          <TableCell className={`text-right ${insTd}`}>
                            <Button type="button" variant="outline" size="sm" className={insSecondaryBtn} asChild>
                              <Link href={r.status === "draft" ? `/billing/insurance/preauth/edit/${r.id}` : `/billing/insurance/preauth/${r.id}`}>
                                {r.status === "draft" ? "Edit" : "View"}
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

        {/* ──────── Claims tab (Task 4) ──────── */}
        {tab === "claims" ? (
          <Card className={insCard}>
            <CardHeader className="border-b border-slate-200 dark:border-gray-800">
              <CardTitle className="text-base dark:text-white">Claims</CardTitle>
              <CardDescription className="dark:text-gray-400">All claims, newest first.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 md:p-0">
              <div className={insTableShell}>
                <Table>
                  <TableHeader className="bg-gray-800 [&_tr]:border-gray-800 [&_tr]:hover:bg-gray-800">
                    <TableRow className="border-gray-800 bg-gray-800 hover:bg-gray-800">
                      <TableHead className={insTh}>Claim #</TableHead>
                      <TableHead className={insTh}>Patient</TableHead>
                      <TableHead className={insTh}>Insurer</TableHead>
                      <TableHead className={`${insTh} text-right`}>Billed</TableHead>
                      <TableHead className={`${insTh} text-right`}>Approved</TableHead>
                      <TableHead className={`${insTh} text-right`}>Settled</TableHead>
                      <TableHead className={insTh}>Status</TableHead>
                      <TableHead className={`${insTh} text-right`}>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.length === 0 ? (
                      <TableRow className={insTr}>
                        <TableCell colSpan={8} className={`${insTd} text-center text-slate-500 dark:text-gray-400`}>
                          {loading ? "Loading…" : "No claims yet."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      claims.map((r) => (
                        <TableRow key={r.id} className={insTr}>
                          <TableCell className={`font-mono text-sm ${insTd}`}>{r.claim_number}</TableCell>
                          <TableCell className={insTd}>
                            <div className="flex min-w-0 items-center gap-2">
                              <PatientAvatar patientId={r.patient_id || r.id} patientName={r.patient_full_name} size="sm" />
                              <span className="min-w-0 truncate font-medium">{r.patient_full_name}</span>
                            </div>
                          </TableCell>
                          <TableCell className={insTd}>{r.insurance_name}</TableCell>
                          <TableCell className={`text-right tabular-nums ${insTd}`}>{formatInr(r.billed_amount)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${insTd}`}>{formatInr(r.approved_amount)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${insTd}`}>{formatInr(r.settled_amount)}</TableCell>
                          <TableCell className={insTd}>
                            <InsuranceStatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className={`text-right ${insTd}`}>
                            <Button type="button" variant="outline" size="sm" className={insSecondaryBtn} asChild>
                              <Link href={r.status === "draft" ? `/billing/insurance/claims/edit/${r.id}` : `/billing/insurance/claims/${r.id}`}>
                                {r.status === "draft" ? "Edit" : "View"}
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

        {/* ──────── Panels tab (Task 4) ──────── */}
        {tab === "panels" ? (
          <Card className={insCard}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-200 dark:border-gray-800">
              <div>
                <CardTitle className="text-base dark:text-white">Hospital insurance panels</CardTitle>
                <CardDescription className="dark:text-gray-400">Insurer/TPA configurations for this hospital.</CardDescription>
              </div>
              <Button type="button" size="sm" className={insSecondaryBtn} onClick={() => setShowPanelModal(true)}>
                Add panel
              </Button>
            </CardHeader>
            <CardContent className="p-0 md:p-0">
              <div className={insTableShell}>
                <Table>
                  <TableHeader className="bg-gray-800 [&_tr]:border-gray-800 [&_tr]:hover:bg-gray-800">
                    <TableRow className="border-gray-800 bg-gray-800 hover:bg-gray-800">
                      <TableHead className={insTh}>Type</TableHead>
                      <TableHead className={insTh}>Insurer</TableHead>
                      <TableHead className={insTh}>TPA</TableHead>
                      <TableHead className={insTh}>Empanelment #</TableHead>
                      <TableHead className={insTh}>Portal</TableHead>
                      <TableHead className={insTh}>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {panels.length === 0 ? (
                      <TableRow className={insTr}>
                        <TableCell colSpan={6} className={`${insTd} text-center text-slate-500 dark:text-gray-400`}>
                          {loading ? "Loading…" : "No panels configured. Click \"Add panel\" to start."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      panels.map((p) => (
                        <TableRow key={p.id} className={insTr}>
                          <TableCell className={insTd}>
                            <SchemeBadge type={p.scheme_type} />
                          </TableCell>
                          <TableCell className={`font-medium ${insTd}`}>{p.insurer_name}</TableCell>
                          <TableCell className={`text-slate-600 dark:text-gray-400 ${insTd}`}>{p.tpa_name !== "—" ? p.tpa_name : "—"}</TableCell>
                          <TableCell className={`font-mono text-xs ${insTd}`}>{p.empanelment_number ?? "—"}</TableCell>
                          <TableCell className={insTd}>
                            {p.portal_link ? (
                              <a
                                href={p.portal_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                              >
                                Open
                              </a>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className={insTd}>
                            <button
                              type="button"
                              onClick={() => void togglePanelActive(p.id, p.is_active)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition ${p.is_active ? "bg-emerald-500" : "bg-slate-300 dark:bg-gray-600"}`}
                            >
                              <span
                                className={`mt-0.5 inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${p.is_active ? "translate-x-4" : "translate-x-0.5"}`}
                              />
                            </button>
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

        {/* ──────── New Claim modal (Task 2 + 7) ──────── */}
        {showClaimModal ? (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(e) => { if (e.target === e.currentTarget) resetClaimModal(); }}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 text-white shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <h2 className="text-lg font-semibold text-white">New claim (draft)</h2>
              <p className="mt-1 text-xs text-gray-400">Search for a patient, select coverage, enter billed amount.</p>
              <div className="mt-4 space-y-4">
                {/* Patient search */}
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-200">Patient</Label>
                  <Input
                    className={`h-9 w-full rounded-md ${insModalInput}`}
                    placeholder="Search by name or UHID (min 2 chars)…"
                    value={claimPatientSearch}
                    onChange={(e) => { setClaimPatientSearch(e.target.value); setClaimPatientId(""); setClaimCoverages([]); }}
                    autoComplete="off"
                  />
                  {claimPatientOpts.length > 0 && !claimPatientId ? (
                    <ul className="mt-1 max-h-40 overflow-auto rounded-md border border-gray-700 bg-gray-800">
                      {claimPatientOpts.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
                            onClick={() => void selectClaimPatient(p)}
                          >
                            {p.full_name}
                            {p.uhid ? <span className="ml-2 text-xs text-gray-500">({p.uhid})</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {claimPatientId && claimPatientLabel ? (
                    <p className="mt-1 text-xs text-emerald-400">Selected: {claimPatientLabel}</p>
                  ) : null}
                </div>

                {/* Coverage pills */}
                {claimPatientId && claimCoverages.length > 0 ? (
                  <div>
                    <Label className="mb-1.5 block text-sm font-medium text-gray-200">Coverage</Label>
                    <div className="flex flex-col gap-2">
                      {claimCoverages.map((c) => (
                        <button
                          key={c.coverage_id}
                          type="button"
                          onClick={() => setClaimCoverageId(c.coverage_id)}
                          className={`rounded-lg border p-3 text-left text-sm transition ${
                            claimCoverageId === c.coverage_id
                              ? "border-blue-500 bg-blue-950/40 ring-1 ring-blue-500"
                              : "border-gray-700 bg-gray-800 hover:border-gray-600"
                          }`}
                        >
                          <span className="font-medium text-white">{c.insurer_name}</span>
                          <span className="mx-1.5 text-gray-500">—</span>
                          <span className="font-mono text-gray-300">Policy #{c.policy_number || "N/A"}</span>
                          {c.tpa_name !== "—" ? (
                            <span className="ml-1.5 text-xs text-gray-400">(TPA: {c.tpa_name})</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : claimPatientId && claimCoverages.length === 0 ? (
                  <p className="text-sm text-amber-400">No active coverage for this patient.</p>
                ) : null}

                {/* Billed amount */}
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-200">Billed amount (₹)</Label>
                  <Input
                    className={`h-9 w-full rounded-md ${insModalInput}`}
                    inputMode="decimal"
                    value={claimBilled}
                    onChange={(e) => setClaimBilled(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" className={insSecondaryBtn} onClick={resetClaimModal}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitClaim()} disabled={saving || !claimPatientId}>
                  {saving ? "Saving…" : "Create draft"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ──────── Add Panel modal ──────── */}
        {showPanelModal ? (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setShowPanelModal(false); }}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6 text-white shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <h2 className="text-lg font-semibold text-white">Add insurance panel</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-200">Scheme type</Label>
                  <Select value={panelSchemeType} onValueChange={setPanelSchemeType}>
                    <SelectTrigger className={`h-9 w-full rounded-md ${insModalInput}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={insSelectContent}>
                      <SelectItem value="tpa">TPA</SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                      <SelectItem value="government">Government</SelectItem>
                      <SelectItem value="corporate">Corporate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-200">Insurer</Label>
                  <Select value={panelInsurerId || "__none__"} onValueChange={(v) => setPanelInsurerId(v === "__none__" ? "" : v)}>
                    <SelectTrigger className={`h-9 w-full rounded-md ${insModalInput}`}>
                      <SelectValue placeholder="Select insurer" />
                    </SelectTrigger>
                    <SelectContent className={insSelectContent}>
                      <SelectItem value="__none__">Select…</SelectItem>
                      {insurerOpts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-200">TPA (optional)</Label>
                  <Select value={panelTpaId || "__none__"} onValueChange={(v) => setPanelTpaId(v === "__none__" ? "" : v)}>
                    <SelectTrigger className={`h-9 w-full rounded-md ${insModalInput}`}>
                      <SelectValue placeholder="Select TPA" />
                    </SelectTrigger>
                    <SelectContent className={insSelectContent}>
                      <SelectItem value="__none__">None</SelectItem>
                      {tpaOpts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-200">Empanelment #</Label>
                  <Input className={`h-9 w-full rounded-md ${insModalInput}`} value={panelEmpanelment} onChange={(e) => setPanelEmpanelment(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-200">Portal link (optional)</Label>
                  <Input
                    className={`h-9 w-full rounded-md ${insModalInput}`}
                    value={panelPortalLink}
                    onChange={(e) => setPanelPortalLink(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" className={insSecondaryBtn} onClick={() => setShowPanelModal(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitPanel()} disabled={panelSaving || !panelInsurerId}>
                  {panelSaving ? "Saving…" : "Add panel"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
