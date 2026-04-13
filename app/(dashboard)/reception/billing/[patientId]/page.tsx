"use client";

import { ChevronDown, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ACCEPT_RELATIONS } from "@/app/ipd/[admissionId]/estimate/procedure-estimate-types";

type ChargeItemMeta = {
  id: string;
  unit_price_snapshot: number | string | null;
  override_reason: string | null;
  display_label: string | null;
};

type LineItemRow = {
  id: string;
  line_number: number;
  unit_price: number | string | null;
  quantity: number | string | null;
  line_subtotal: number | string | null;
  net_amount: number | string | null;
  voided_at: string | null;
  charge_item: ChargeItemMeta | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  status: string | null;
  total_gross: number | string | null;
  amount_paid: number | string | null;
  balance_due: number | string | null;
  line_items: LineItemRow[] | null;
};

type BillingSummary = {
  wallet_balance: number | string | null;
  total_outstanding: number | string | null;
  invoices: InvoiceRow[] | null;
};

type PatientOpt = { id: string; full_name: string | null; docpad_id: string | null };

type EstimateCardRow = {
  id: string;
  admission_id: string;
  estimate_number: string;
  estimated_total: number | string | null;
  deposit_requested: number | string | null;
  deposit_collected: number | string | null;
  status: string;
  ot_surgeries: { procedure_name: string | null } | { procedure_name: string | null }[] | null;
};

function estimateSurgeryLabel(ot: EstimateCardRow["ot_surgeries"]): string {
  if (!ot) return "Procedure";
  if (Array.isArray(ot)) return ot[0]?.procedure_name ?? "Procedure";
  return ot.procedure_name ?? "Procedure";
}

const PAYMENT_METHODS = ["cash", "upi", "card", "netbanking", "cheque"] as const;

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatInr(v: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { dateStyle: "medium" });
}

function invoiceTypeBadgeLabel(status: string | null): string {
  switch (status) {
    case "draft":
      return "Proforma";
    case "issued":
      return "Final";
    case "balanced":
      return "Paid";
    case "cancelled":
    case "voided":
      return "Void";
    default:
      return "Invoice";
  }
}

function statusBadgeLabel(status: string | null): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

function estimateStatusBadgeClass(status: string | null): string {
  switch (status) {
    case "draft":
      return "bg-slate-600/30 text-slate-100";
    case "presented":
      return "bg-amber-500/25 text-amber-100";
    case "accepted":
      return "bg-emerald-500/25 text-emerald-100";
    case "declined":
      return "bg-red-500/25 text-red-100";
    case "superseded":
      return "bg-zinc-600/30 text-zinc-200";
    default:
      return "bg-slate-600/30 text-slate-100";
  }
}

function isUnpriced(ci: ChargeItemMeta | null): boolean {
  const r = (ci?.override_reason ?? "").trim().toUpperCase();
  return r.startsWith("UNPRICED");
}

function isVoidedLine(ci: ChargeItemMeta | null): boolean {
  const d = (ci?.display_label ?? "").trim();
  return d.startsWith("[VOIDED]");
}

function parseSummary(data: unknown): BillingSummary | null {
  let v: unknown = data;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  if (v == null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    wallet_balance: o.wallet_balance as BillingSummary["wallet_balance"],
    total_outstanding: o.total_outstanding as BillingSummary["total_outstanding"],
    invoices: Array.isArray(o.invoices) ? (o.invoices as InvoiceRow[]) : [],
  };
}

export default function ReceptionPatientBillingPage() {
  const params = useParams();
  const router = useRouter();
  const patientId = typeof params?.patientId === "string" ? params.patientId.trim() : "";

  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [patientLabel, setPatientLabel] = useState<string>("");
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState<PatientOpt[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<string>("cash");
  const [advanceRef, setAdvanceRef] = useState("");
  const [advanceSaving, setAdvanceSaving] = useState(false);

  const [voidTarget, setVoidTarget] = useState<{ lineId: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidSaving, setVoidSaving] = useState(false);

  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [priceSaving, setPriceSaving] = useState(false);

  const [billingTab, setBillingTab] = useState<"invoices" | "estimates">("invoices");
  const [estimates, setEstimates] = useState<EstimateCardRow[]>([]);
  const [estimatesLoading, setEstimatesLoading] = useState(false);
  const [acceptEstOpen, setAcceptEstOpen] = useState(false);
  const [acceptEstId, setAcceptEstId] = useState("");
  const [acceptName, setAcceptName] = useState("");
  const [acceptRel, setAcceptRel] = useState("self");
  const [acceptSaving, setAcceptSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchQuery), 350);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!patientId || !hospitalId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("patients").select("full_name, docpad_id").eq("id", patientId).maybeSingle();
      if (cancelled) return;
      if (data) {
        const fn = String(data.full_name ?? "").trim();
        setPatientLabel(fn || String(data.docpad_id ?? patientId));
      } else {
        setPatientLabel(patientId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, hospitalId]);

  const loadSummary = useCallback(async () => {
    if (!patientId || !hospitalId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("get_patient_billing_summary", {
      p_hospital_id: hospitalId,
      p_patient_id: patientId,
    });
    setLoading(false);
    if (e) {
      setError(e.message);
      setSummary(null);
      return;
    }
    setSummary(parseSummary(data));
  }, [patientId, hospitalId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadEstimates = useCallback(async () => {
    if (!patientId || !hospitalId) return;
    setEstimatesLoading(true);
    const { data, error: e } = await supabase
      .from("procedure_estimates")
      .select("id, admission_id, estimate_number, estimated_total, deposit_requested, deposit_collected, status, ot_surgeries(procedure_name)")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    setEstimatesLoading(false);
    if (e) {
      toast.error(e.message);
      setEstimates([]);
      return;
    }
    setEstimates((data ?? []) as unknown as EstimateCardRow[]);
  }, [patientId, hospitalId]);

  useEffect(() => {
    if (billingTab !== "estimates" || !patientId || !hospitalId) return;
    void loadEstimates();
  }, [billingTab, patientId, hospitalId, loadEstimates]);

  useEffect(() => {
    setPriceDrafts({});
  }, [patientId]);

  useEffect(() => {
    if (!searchOpen) return;
    const onDoc = (ev: MouseEvent) => {
      if (!searchRef.current?.contains(ev.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [searchOpen]);

  useEffect(() => {
    if (!hospitalId || !searchDebounced.trim() || searchDebounced.trim().length < 1) {
      setSearchOptions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("patients")
        .select("id, full_name, docpad_id")
        .eq("hospital_id", hospitalId)
        .ilike("full_name", `%${searchDebounced.trim()}%`)
        .limit(12);
      if (!cancelled) setSearchOptions((data ?? []) as PatientOpt[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchDebounced, hospitalId]);

  const walletBal = num(summary?.wallet_balance);
  const outStd = num(summary?.total_outstanding);
  const invoices = summary?.invoices ?? [];

  const toggleInvoice = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitAdvance = async () => {
    if (!hospitalId || !patientId) return;
    const amt = Number.parseFloat(advanceAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    setAdvanceSaving(true);
    const { data, error: e } = await supabase.rpc("apply_advance_wallet_payment", {
      p_hospital_id: hospitalId,
      p_patient_id: patientId,
      p_amount: amt,
      p_payment_method: advanceMethod,
      p_reference_number: advanceRef.trim() || null,
    });
    setAdvanceSaving(false);
    if (e) {
      toast.error(e.message);
      return;
    }
    toast.success(`Wallet updated · balance ${formatInr(num(data))}`);
    setAdvanceOpen(false);
    setAdvanceAmount("");
    setAdvanceRef("");
    void loadSummary();
  };

  const submitVoid = async () => {
    if (!voidTarget || !voidReason.trim()) {
      toast.error("Reason is required.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id;
    if (!uid) {
      toast.error("Not signed in.");
      return;
    }
    setVoidSaving(true);
    const { error: e } = await supabase.rpc("void_invoice_line_item", {
      p_line_item_id: voidTarget.lineId,
      p_reason: voidReason.trim(),
      p_cancelled_by: uid,
    });
    setVoidSaving(false);
    if (e) {
      toast.error(e.message);
      return;
    }
    toast.success("Line item voided");
    setVoidTarget(null);
    setVoidReason("");
    void loadSummary();
  };

  const saveLinePrice = async (lineId: string, raw: string) => {
    const p = Number.parseFloat(raw);
    if (!Number.isFinite(p) || p < 0) {
      toast.error("Invalid price");
      return;
    }
    setPriceSaving(true);
    const { error: e } = await supabase.rpc("set_invoice_line_item_unit_price", {
      p_line_item_id: lineId,
      p_unit_price: p,
    });
    setPriceSaving(false);
    if (e) {
      toast.error(e.message);
      return;
    }
    toast.success("Price updated");
    setPriceDrafts((d) => {
      const n = { ...d };
      delete n[lineId];
      return n;
    });
    void loadSummary();
  };

  const submitAcceptEstimate = async () => {
    if (!acceptEstId || !acceptName.trim()) {
      toast.error("Enter signatory name.");
      return;
    }
    setAcceptSaving(true);
    const { error } = await supabase
      .from("procedure_estimates")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by_name: acceptName.trim(),
        accepted_by_relation: acceptRel,
      })
      .eq("id", acceptEstId);
    setAcceptSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Estimate accepted");
    setAcceptEstOpen(false);
    setAcceptEstId("");
    setAcceptName("");
    void loadEstimates();
  };

  const searchPlaceholder = useMemo(() => "Search patient by name…", []);

  if (!patientId) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <p className="text-sm text-red-400">Invalid patient.</p>
        <Link href="/reception" className="mt-4 inline-block text-sm text-blue-400 hover:underline">
          ← Reception
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/reception" className="text-sm font-medium text-blue-400 hover:underline">
                ← Reception
              </Link>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Patient billing</h1>
              <p className="mt-1 text-sm text-slate-400">{patientLabel}</p>
            </div>
          </div>

          <div ref={searchRef} className="relative max-w-md">
            <Label className="text-slate-300">Find another patient</Label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder={searchPlaceholder}
                className="border-slate-700 bg-slate-900 pl-9 text-slate-100 placeholder:text-slate-500"
              />
            </div>
            {searchOpen && searchDebounced.trim().length > 0 ? (
              <div className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
                {searchOptions.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-slate-500">No matches.</p>
                ) : (
                  searchOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-800"
                      onClick={() => {
                        router.push(`/reception/billing/${p.id}`);
                        setSearchOpen(false);
                        setSearchQuery("");
                      }}
                    >
                      <span className="font-medium text-slate-100">{p.full_name ?? "—"}</span>
                      {p.docpad_id ? <span className="text-xs text-slate-500">{p.docpad_id}</span> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </header>

        {error ? (
          <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-slate-800 bg-slate-900/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-400">Wallet balance</CardDescription>
              <CardTitle className={cn("text-2xl tabular-nums", walletBal > 0 ? "text-emerald-400" : "text-slate-200")}>
                {loading ? "…" : formatInr(walletBal)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Button type="button" className="w-full sm:w-auto" onClick={() => setAdvanceOpen(true)}>
                Add advance payment
              </Button>
            </CardContent>
          </Card>
          <Card className="border-slate-800 bg-slate-900/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-slate-400">Total outstanding</CardDescription>
              <CardTitle className={cn("text-2xl tabular-nums", outStd > 0 ? "text-red-400" : "text-slate-200")}>
                {loading ? "…" : formatInr(outStd)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <section className="space-y-3">
          <div className="flex gap-1 border-b border-slate-800">
            <button
              type="button"
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition",
                billingTab === "invoices" ? "border-blue-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300",
              )}
              onClick={() => setBillingTab("invoices")}
            >
              Invoices
            </button>
            <button
              type="button"
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition",
                billingTab === "estimates" ? "border-blue-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300",
              )}
              onClick={() => setBillingTab("estimates")}
            >
              Estimates
            </button>
          </div>

          {billingTab === "invoices" ? (
            <>
          {loading && !summary ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-slate-500">No invoices for this patient.</p>
          ) : (
            <ul className="space-y-3">
              {invoices.map((inv) => {
                const open = expanded.has(inv.id);
                const lines = inv.line_items ?? [];
                return (
                  <li key={inv.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-800/80"
                      onClick={() => toggleInvoice(inv.id)}
                    >
                      {open ? (
                        <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                      )}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-white">{inv.invoice_number ?? inv.id.slice(0, 8)}</span>
                          <span className="text-xs text-slate-500">{formatDate(inv.invoice_date)}</span>
                          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-semibold text-violet-200">
                            {invoiceTypeBadgeLabel(inv.status)}
                          </span>
                          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] capitalize text-slate-200">
                            {statusBadgeLabel(inv.status)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm tabular-nums text-slate-300">
                          <span>
                            Gross <span className="text-slate-100">{formatInr(num(inv.total_gross))}</span>
                          </span>
                          <span>
                            Paid <span className="text-slate-100">{formatInr(num(inv.amount_paid))}</span>
                          </span>
                          <span>
                            Balance <span className="font-medium text-slate-100">{formatInr(num(inv.balance_due))}</span>
                          </span>
                        </div>
                      </div>
                    </button>
                    {open ? (
                      <div className="border-t border-slate-800 px-4 py-3">
                        <ul className="space-y-3">
                          {lines.map((li) => {
                            const ci = li.charge_item;
                            const voided = Boolean(li.voided_at) || isVoidedLine(ci);
                            const unpriced = isUnpriced(ci) && !voided;
                            const label = ci?.display_label ?? "Line item";
                            const draft =
                              priceDrafts[li.id] ?? (unpriced ? "" : String(num(ci?.unit_price_snapshot)));

                            return (
                              <li
                                key={li.id}
                                className={cn(
                                  "rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2 text-sm",
                                  voided && "border-red-900/40",
                                )}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p
                                      className={cn(
                                        "font-medium text-slate-100",
                                        voided && "text-red-400 line-through decoration-red-400/80",
                                      )}
                                    >
                                      {label}
                                    </p>
                                    <p className="mt-1 text-xs tabular-nums text-slate-500">
                                      Qty {num(li.quantity)} · Net {formatInr(num(li.net_amount))}
                                    </p>
                                    {unpriced ? (
                                      <span className="mt-1 inline-flex rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                                        Needs pricing
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {unpriced ? (
                                      <div className="flex flex-wrap items-center gap-1">
                                        <Input
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          className="h-8 w-28 border-amber-900/50 bg-slate-900 text-xs text-slate-100"
                                          value={draft}
                                          onChange={(e) =>
                                            setPriceDrafts((prev) => ({
                                              ...prev,
                                              [li.id]: e.target.value,
                                            }))
                                          }
                                        />
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          className="h-8 text-xs"
                                          disabled={priceSaving}
                                          onClick={() => saveLinePrice(li.id, draft)}
                                        >
                                          Save
                                        </Button>
                                      </div>
                                    ) : null}
                                    {!voided ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 border-red-900/60 text-xs text-red-300 hover:bg-red-950/50"
                                        onClick={() => setVoidTarget({ lineId: li.id })}
                                      >
                                        Void
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
            </>
          ) : estimatesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full bg-slate-800" />
              <Skeleton className="h-24 w-full bg-slate-800" />
            </div>
          ) : estimates.length === 0 ? (
            <p className="text-sm text-slate-500">No procedure estimates for this patient.</p>
          ) : (
            <ul className="space-y-3">
              {estimates.map((est) => (
                <li key={est.id} className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-white">{est.estimate_number}</span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                            estimateStatusBadgeClass(est.status),
                          )}
                        >
                          {statusBadgeLabel(est.status)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300">{estimateSurgeryLabel(est.ot_surgeries)}</p>
                      <div className="flex flex-wrap gap-4 text-sm tabular-nums text-slate-400">
                        <span>
                          Estimated{" "}
                          <span className="text-slate-100">{formatInr(num(est.estimated_total))}</span>
                        </span>
                        <span>
                          Deposit{" "}
                          <span className="text-slate-100">
                            {formatInr(num(est.deposit_collected))}/{formatInr(num(est.deposit_requested))}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {est.status === "draft" ? (
                        <Button type="button" size="sm" variant="secondary" asChild>
                          <Link href={`/ipd/${encodeURIComponent(est.admission_id)}/estimate`}>Review &amp; present</Link>
                        </Button>
                      ) : null}
                      {est.status === "presented" ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setAcceptEstId(est.id);
                            setAcceptName("");
                            setAcceptRel("self");
                            setAcceptEstOpen(true);
                          }}
                        >
                          Mark accepted
                        </Button>
                      ) : null}
                      {est.status === "accepted" ? (
                        <Button type="button" size="sm" variant="outline" asChild>
                          <Link href={`/ipd/${encodeURIComponent(est.admission_id)}/estimate`}>View</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {advanceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <Card className="w-full max-w-md border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
            <CardHeader>
              <CardTitle>Add advance payment</CardTitle>
              <CardDescription className="text-slate-400">Credits the patient wallet at this hospital.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="adv-amt">Amount (INR)</Label>
                <Input
                  id="adv-amt"
                  type="number"
                  min={0}
                  step={0.01}
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  className="border-slate-700 bg-slate-950 text-slate-100"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={advanceMethod} onValueChange={setAdvanceMethod}>
                  <SelectTrigger className="border-slate-700 bg-slate-950 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="adv-ref">Reference (optional)</Label>
                <Input
                  id="adv-ref"
                  value={advanceRef}
                  onChange={(e) => setAdvanceRef(e.target.value)}
                  className="border-slate-700 bg-slate-950 text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setAdvanceOpen(false)} disabled={advanceSaving}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitAdvance()} disabled={advanceSaving}>
                  {advanceSaving ? "Saving…" : "Submit"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {voidTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <Card className="w-full max-w-md border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
            <CardHeader>
              <CardTitle>Void line item</CardTitle>
              <CardDescription className="text-slate-400">This marks the charge line as void and updates invoice totals.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="void-reason">Reason</Label>
                <Input
                  id="void-reason"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="border-slate-700 bg-slate-950 text-slate-100"
                  placeholder="Required"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setVoidTarget(null);
                    setVoidReason("");
                  }}
                  disabled={voidSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-800 bg-red-950/50 text-red-200 hover:bg-red-900/60"
                  onClick={() => void submitVoid()}
                  disabled={voidSaving}
                >
                  {voidSaving ? "Voiding…" : "Confirm void"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {acceptEstOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <Card className="w-full max-w-md border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
            <CardHeader>
              <CardTitle>Mark accepted</CardTitle>
              <CardDescription className="text-slate-400">Who accepted this estimate?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="est-acc-name">Accepted by (name)</Label>
                <Input
                  id="est-acc-name"
                  value={acceptName}
                  onChange={(e) => setAcceptName(e.target.value)}
                  className="border-slate-700 bg-slate-950 text-slate-100"
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-2">
                <Label>Relation to patient</Label>
                <Select value={acceptRel} onValueChange={setAcceptRel}>
                  <SelectTrigger className="border-slate-700 bg-slate-950 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCEPT_RELATIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAcceptEstOpen(false);
                    setAcceptEstId("");
                  }}
                  disabled={acceptSaving}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitAcceptEstimate()} disabled={acceptSaving}>
                  {acceptSaving ? "Saving…" : "Confirm"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
