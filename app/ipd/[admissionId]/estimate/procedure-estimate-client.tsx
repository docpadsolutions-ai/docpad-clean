"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { practitionersOrFilterForAuthUid } from "@/app/lib/practitionerAuthLookup";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ACCEPT_RELATIONS,
  CHARGE_CATEGORIES,
  type ProcedureEstimateLineItem,
  type ProcedureEstimateStatus,
} from "./procedure-estimate-types";

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatInrPlain(v: number): string {
  return v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function asLineItems(raw: unknown): ProcedureEstimateLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row, idx) => {
    const r = row as Record<string, unknown>;
    return {
      seq: num(r.seq) || idx + 1,
      description: String(r.description ?? ""),
      category: String(r.category ?? "other"),
      definition_id: r.definition_id != null ? String(r.definition_id) : null,
      quantity: num(r.quantity) || 0,
      unit_price: num(r.unit_price),
      total: num(r.total),
      is_unpriced: Boolean(r.is_unpriced),
      unpriced_note: String(r.unpriced_note ?? ""),
      is_auto_estimated: Boolean(r.is_auto_estimated),
      estimation_basis: String(r.estimation_basis ?? ""),
      est_days: r.est_days != null ? num(r.est_days) : null,
    };
  });
}

function recomputeTotals(items: ProcedureEstimateLineItem[]): ProcedureEstimateLineItem[] {
  return items.map((row) => ({
    ...row,
    total: Math.round(row.quantity * row.unit_price * 100) / 100,
  }));
}

function sumEstimated(items: ProcedureEstimateLineItem[]): number {
  return Math.round(items.reduce((s, r) => s + num(r.total), 0) * 100) / 100;
}

function renumberSeq(items: ProcedureEstimateLineItem[]): ProcedureEstimateLineItem[] {
  return items.map((row, i) => ({ ...row, seq: i + 1 }));
}

type EstimateRow = {
  id: string;
  hospital_id: string;
  admission_id: string;
  patient_id: string;
  ot_surgery_id: string | null;
  estimate_number: string;
  status: ProcedureEstimateStatus;
  line_items: unknown;
  estimated_total: number | string | null;
  deposit_requested: number | string | null;
  deposit_collected: number | string | null;
  notes: string | null;
  presented_at: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  accepted_by_relation: string | null;
  actual_invoice_id: string | null;
  variance_amount: number | string | null;
  created_at: string;
  ot_surgeries: {
    procedure_name: string | null;
    surgery_date: string | null;
    anaesthesia_type: string | null;
  } | null;
  ipd_admissions: {
    admission_number: string | null;
    expected_discharge_date: string | null;
  } | null;
};

type CoverageRow = {
  id: string;
  policy_number: string | null;
  coverage_limit: number | string | null;
  remaining_balance: number | string | null;
  tpa_name: string | null;
  insurance_companies: { name: string | null } | { name: string | null }[] | null;
};

const PAYMENT_METHODS = ["cash", "upi", "card", "netbanking", "cheque"] as const;

function statusBadgeClass(status: ProcedureEstimateStatus): string {
  switch (status) {
    case "draft":
      return "bg-slate-500/20 text-slate-200";
    case "presented":
      return "bg-amber-500/20 text-amber-100";
    case "accepted":
      return "bg-emerald-500/20 text-emerald-100";
    case "declined":
      return "bg-red-500/20 text-red-100";
    case "superseded":
      return "bg-zinc-500/20 text-zinc-200";
    default:
      return "bg-slate-500/20 text-slate-200";
  }
}

export function ProcedureEstimateClient({ admissionId }: { admissionId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<EstimateRow | null>(null);
  const [patientName, setPatientName] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [walletBalance, setWalletBalance] = useState(0);
  const [coverages, setCoverages] = useState<CoverageRow[]>([]);
  const [actualInvoiceGross, setActualInvoiceGross] = useState<number | null>(null);

  const [lineItems, setLineItems] = useState<ProcedureEstimateLineItem[]>([]);
  const [depositRequested, setDepositRequested] = useState("");
  const [notes, setNotes] = useState("");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutosaveRef = useRef(true);
  const justLoadedRef = useRef(false);
  const [saving, setSaving] = useState(false);

  const [depositOpen, setDepositOpen] = useState(false);
  const [depAmount, setDepAmount] = useState("");
  const [depMethod, setDepMethod] = useState<string>("cash");
  const [depRef, setDepRef] = useState("");
  const [depSaving, setDepSaving] = useState(false);

  const [acceptOpen, setAcceptOpen] = useState(false);
  const [accName, setAccName] = useState("");
  const [accRel, setAccRel] = useState<string>("self");
  const [accSaving, setAccSaving] = useState(false);

  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const estimateId = estimate?.id ?? "";

  const loadAll = useCallback(async () => {
    if (!admissionId) return;
    setLoading(true);
    try {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      if (!hid) {
        toast.error("Could not resolve hospital for your account.");
        setLoading(false);
        return;
      }

      const { data: rows, error: e1 } = await supabase
        .from("procedure_estimates")
        .select(
          "*, ot_surgeries(procedure_name, surgery_date, anaesthesia_type), ipd_admissions(admission_number, expected_discharge_date)",
        )
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: false });

      if (e1) throw e1;
      const list = (rows ?? []) as EstimateRow[];
      const active = list.find((r) => r.status !== "superseded") ?? null;

      if (!active) {
        setEstimate(null);
        setLineItems([]);
        setDepositRequested("");
        setNotes("");
        setPatientName("");
        setWalletBalance(0);
        setCoverages([]);
        setActualInvoiceGross(null);
        setLoading(false);
        return;
      }

      setEstimate(active);
      const items = recomputeTotals(asLineItems(active.line_items));
      setLineItems(items);
      setDepositRequested(String(num(active.deposit_requested)));
      setNotes(active.notes ?? "");
      skipAutosaveRef.current = true;
      justLoadedRef.current = true;
      window.setTimeout(() => {
        skipAutosaveRef.current = false;
      }, 0);
      window.setTimeout(() => {
        justLoadedRef.current = false;
      }, 600);

      const pid = active.patient_id;
      const hidRow = active.hospital_id;

      const [{ data: pat }, { data: org }, { data: wallet }, { data: covRows }, { data: invRow }] = await Promise.all([
        supabase.from("patients").select("full_name").eq("id", pid).maybeSingle(),
        supabase.from("organizations").select("name").eq("id", hidRow).maybeSingle(),
        supabase.from("patient_wallet").select("balance").eq("patient_id", pid).eq("hospital_id", hidRow).maybeSingle(),
        supabase
          .from("patient_insurance_coverage")
          .select("id, policy_number, coverage_limit, remaining_balance, tpa_name, insurance_companies(name)")
          .eq("patient_id", pid)
          .eq("status", "active"),
        active.actual_invoice_id
          ? supabase.from("invoices").select("total_gross").eq("id", active.actual_invoice_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      setPatientName(String(pat?.full_name ?? "").trim() || "Patient");
      setHospitalName(String(org?.name ?? "").trim() || "Hospital");
      setWalletBalance(num(wallet?.balance));
      setCoverages((covRows ?? []) as unknown as CoverageRow[]);
      setActualInvoiceGross(active.actual_invoice_id ? num(invRow?.total_gross) : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load estimate");
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** Print: hide app sidebar (aside) for a cleaner A4 layout */
  useEffect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-procedure-estimate-print", "1");
    el.textContent = `@media print {
      aside { display: none !important; }
      .no-print { display: none !important; }
      .estimate-print-root { background: white !important; color: black !important; }
    }`;
    document.head.appendChild(el);
    return () => {
      document.head.querySelector('style[data-procedure-estimate-print="1"]')?.remove();
    };
  }, []);

  const persistPatch = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!estimateId) return;
      const { error } = await supabase.from("procedure_estimates").update(patch).eq("id", estimateId);
      if (error) {
        toast.error(error.message);
        return;
      }
    },
    [estimateId],
  );

  useEffect(() => {
    if (!estimateId || skipAutosaveRef.current || justLoadedRef.current) return;
    const st = estimate?.status;
    if (st && st !== "draft" && st !== "presented") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
    saveTimerRef.current = setTimeout(() => {
      const withTotals = recomputeTotals(lineItems);
      const grand = sumEstimated(withTotals);
      void (async () => {
        await persistPatch({
          line_items: withTotals,
          estimated_total: grand,
          deposit_requested: num(depositRequested),
          notes,
        });
        setEstimate((prev) =>
          prev
            ? {
                ...prev,
                line_items: withTotals,
                estimated_total: grand,
                deposit_requested: num(depositRequested),
                notes,
              }
            : prev,
        );
        setSaving(false);
      })();
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [lineItems, depositRequested, notes, estimateId, estimate?.status, persistPatch]);

  const grandTotal = useMemo(() => sumEstimated(lineItems), [lineItems]);

  const updateLine = (seq: number, patch: Partial<ProcedureEstimateLineItem>) => {
    setLineItems((prev) => {
      let next = prev.map((row) => (row.seq === seq ? { ...row, ...patch } : row));
      next = recomputeTotals(next);
      if (patch.unit_price != null && seq === 2) {
        const fee = num(patch.unit_price);
        next = next.map((row) => {
          if (row.is_auto_estimated) {
            const up = Math.round(fee * 0.25 * 100) / 100;
            return { ...row, unit_price: up, total: Math.round(row.quantity * up * 100) / 100 };
          }
          return row;
        });
      }
      return next;
    });
  };

  const onFeePriceBlur = (seq: number, raw: string) => {
    const p = Number.parseFloat(raw);
    if (!Number.isFinite(p)) return;
    updateLine(seq, { unit_price: p });
  };

  const addLine = () => {
    setLineItems((prev) => {
      const maxSeq = prev.reduce((m, r) => Math.max(m, r.seq), 0);
      const row: ProcedureEstimateLineItem = {
        seq: maxSeq + 1,
        description: "",
        category: "other",
        definition_id: null,
        quantity: 1,
        unit_price: 0,
        total: 0,
        is_unpriced: false,
        unpriced_note: "",
        is_auto_estimated: false,
        estimation_basis: "",
        est_days: null,
      };
      const next = recomputeTotals([...prev, row]);
      return renumberSeq(next);
    });
  };

  const removeLine = (seq: number) => {
    setLineItems((prev) => {
      const next = renumberSeq(recomputeTotals(prev.filter((r) => r.seq !== seq)));
      return next;
    });
  };

  const createEstimate = async () => {
    setActionBusy("create");
    try {
      const { data: adm, error: aerr } = await supabase
        .from("ipd_admissions")
        .select("patient_id, hospital_id")
        .eq("id", admissionId)
        .maybeSingle();
      if (aerr || !adm) throw new Error(aerr?.message ?? "Admission not found");

      const { data: surg } = await supabase
        .from("ot_surgeries")
        .select("id")
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: ins, error: ierr } = await supabase
        .from("procedure_estimates")
        .insert({
          hospital_id: adm.hospital_id,
          admission_id: admissionId,
          patient_id: adm.patient_id,
          ot_surgery_id: surg?.id ?? null,
          estimate_number: "",
          status: "draft",
          line_items: [],
          estimated_total: 0,
          deposit_requested: 0,
          deposit_collected: 0,
          notes: "",
        })
        .select("id")
        .maybeSingle();
      if (ierr) throw ierr;
      if (ins?.id) {
        toast.success("Estimate created");
        await loadAll();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create estimate");
    } finally {
      setActionBusy(null);
    }
  };

  const submitDeposit = async () => {
    if (!estimate) return;
    const amt = Number.parseFloat(depAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    setDepSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error("Not signed in.");
        return;
      }
      const { data: pr } = await supabase.from("practitioners").select("id").or(practitionersOrFilterForAuthUid(user.id)).maybeSingle();
      const { data, error } = await supabase.rpc("record_procedure_estimate_deposit", {
        p_estimate_id: estimate.id,
        p_amount: amt,
        p_payment_method: depMethod,
        p_reference_number: depRef.trim() || null,
        p_performed_by: pr?.id ?? null,
      });
      setDepSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      const depCol = num((data as { deposit_collected?: unknown })?.deposit_collected);
      setWalletBalance(num((data as { wallet_balance?: unknown })?.wallet_balance));
      setEstimate((prev) => (prev ? { ...prev, deposit_collected: depCol } : prev));
      toast.success("Deposit recorded");
      setDepositOpen(false);
      setDepAmount("");
      setDepRef("");
    } catch (e) {
      setDepSaving(false);
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const approvePresent = async () => {
    setActionBusy("present");
    const { error } = await supabase
      .from("procedure_estimates")
      .update({ status: "presented", presented_at: new Date().toISOString() })
      .eq("id", estimateId);
    setActionBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Estimate presented to reception");
    void loadAll();
  };

  const markDeclined = async () => {
    if (!window.confirm("Mark this estimate as declined?")) return;
    setActionBusy("declined");
    const { error } = await supabase.from("procedure_estimates").update({ status: "declined", declined_at: new Date().toISOString() }).eq("id", estimateId);
    setActionBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marked declined");
    void loadAll();
  };

  const submitAccepted = async () => {
    if (!accName.trim()) {
      toast.error("Enter signatory name.");
      return;
    }
    setAccSaving(true);
    const { error } = await supabase
      .from("procedure_estimates")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by_name: accName.trim(),
        accepted_by_relation: accRel,
      })
      .eq("id", estimateId);
    setAccSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Estimate accepted");
    setAcceptOpen(false);
    setAccName("");
    void loadAll();
  };

  const supersede = async () => {
    if (!window.confirm("Create a new draft from this estimate and mark this version superseded?")) return;
    setActionBusy("supersede");
    const { data, error } = await supabase.rpc("supersede_procedure_estimate", { p_estimate_id: estimateId });
    setActionBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const newId = String(data ?? "").trim();
    toast.success("New draft created");
    if (newId) {
      router.replace(`/ipd/${encodeURIComponent(admissionId)}/estimate`);
      void loadAll();
    } else {
      void loadAll();
    }
  };

  const depositReqN = num(depositRequested);
  const depositColl = num(estimate?.deposit_collected);
  const outstanding = Math.round((depositReqN - depositColl) * 100) / 100;

  const variance =
    actualInvoiceGross != null ? Math.round((actualInvoiceGross - num(estimate?.estimated_total)) * 100) / 100 : null;

  const embeddedAdmission = estimate?.ipd_admissions;
  const embeddedSurgery = estimate?.ot_surgeries;

  const editable = estimate && (estimate.status === "draft" || estimate.status === "presented");

  if (!admissionId) {
    return <p className="p-6 text-sm text-destructive">Invalid admission.</p>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/dashboard/ipd/${encodeURIComponent(admissionId)}`} className="text-sm text-primary hover:underline">
              ← Admission
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Procedure estimate</h1>
            <p className="mt-1 text-sm text-muted-foreground">Admission · {embeddedAdmission?.admission_number ?? admissionId.slice(0, 8)}</p>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !estimate ? (
          <Card>
            <CardHeader>
              <CardTitle>No procedure estimate</CardTitle>
              <CardDescription>Create a draft to itemise expected charges for this admission.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" onClick={() => void createEstimate()} disabled={actionBusy === "create"}>
                {actionBusy === "create" ? "Creating…" : "Create procedure estimate"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="estimate-print-root space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">Procedure Estimate {estimate.estimate_number}</h2>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", statusBadgeClass(estimate.status))}>
                      {estimate.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {embeddedSurgery?.procedure_name ? `${embeddedSurgery.procedure_name}` : "Surgery not linked"}
                    {embeddedSurgery?.surgery_date ? ` · ${embeddedSurgery.surgery_date}` : ""}
                  </p>
                </div>
              </div>

              {/* Print-only header */}
              <div className="hidden print:block print:space-y-4">
                <div className="border-b pb-3 text-center">
                  <div className="text-lg font-bold">{hospitalName}</div>
                  <div className="text-sm">Procedure cost estimate</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Patient:</span> {patientName}
                  </div>
                  <div>
                    <span className="font-medium">Admission no.:</span> {embeddedAdmission?.admission_number ?? "—"}
                  </div>
                  <div>
                    <span className="font-medium">Estimate no.:</span> {estimate.estimate_number}
                  </div>
                  <div>
                    <span className="font-medium">Expected discharge:</span>{" "}
                    {embeddedAdmission?.expected_discharge_date ? String(embeddedAdmission.expected_discharge_date) : "—"}
                  </div>
                </div>
              </div>

              <Card className="no-print border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Line items</CardTitle>
                  <CardDescription>Edit quantities and unit prices; changes save automatically.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-2">#</th>
                        <th className="py-2 pr-2">Description</th>
                        <th className="py-2 pr-2">Category</th>
                        <th className="py-2 pr-2">Qty</th>
                        <th className="py-2 pr-2">Unit price (₹)</th>
                        <th className="py-2 pr-2">Total</th>
                        <th className="py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((row) => (
                        <tr key={row.seq} className="border-b border-border/60 align-top">
                          <td className="py-2 pr-2 tabular-nums">{row.seq}</td>
                          <td className="py-2 pr-2">
                            <Input
                              value={row.description}
                              onChange={(e) => updateLine(row.seq, { description: e.target.value })}
                              className="h-9 min-w-[140px]"
                              disabled={!editable}
                            />
                            {row.is_unpriced ? (
                              <span className="mt-1 inline-flex rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-200">
                                Needs pricing
                              </span>
                            ) : null}
                            {row.is_auto_estimated ? (
                              <span className="mt-1 inline-flex rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-200">
                                Auto-estimated
                              </span>
                            ) : null}
                            {row.is_auto_estimated ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {row.estimation_basis ||
                                  "Based on 25% of procedure fee — adjust for actual implants/disposables"}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2">
                            <Select
                              value={row.category}
                              onValueChange={(v) => updateLine(row.seq, { category: v })}
                              disabled={!editable}
                            >
                              <SelectTrigger className="h-9 w-[140px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CHARGE_CATEGORIES.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              className="h-9 w-20"
                              value={row.quantity}
                              onChange={(e) => updateLine(row.seq, { quantity: Number.parseFloat(e.target.value) || 0 })}
                              disabled={!editable}
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              className={cn("h-9 w-28", row.is_unpriced && "border-orange-500 ring-1 ring-orange-500/40")}
                              value={row.unit_price}
                              onChange={(e) => updateLine(row.seq, { unit_price: Number.parseFloat(e.target.value) || 0 })}
                              onBlur={(e) => onFeePriceBlur(row.seq, e.target.value)}
                              disabled={!editable}
                            />
                            {row.is_unpriced && row.unpriced_note ? (
                              <p className="mt-1 text-xs text-muted-foreground">{row.unpriced_note}</p>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2 tabular-nums">₹{formatInrPlain(row.total)}</td>
                          <td className="py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive"
                              disabled={!editable}
                              onClick={() => removeLine(row.seq)}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="no-print"
                      disabled={!editable}
                      onClick={addLine}
                    >
                      + Add line item
                    </Button>
                    <div className="text-base font-semibold tabular-nums">
                      Grand total · ₹{formatInrPlain(grandTotal)}
                      {saving ? <span className="ml-2 text-xs font-normal text-muted-foreground">Saving…</span> : null}
                    </div>
                  </div>

                  <div className="no-print grid gap-4 border-t pt-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Deposit requested (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={depositRequested}
                        onChange={(e) => setDepositRequested(e.target.value)}
                        disabled={!editable}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Notes</Label>
                      <Textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={!editable}
                      />
                    </div>
                  </div>

                  <div className="no-print flex flex-wrap gap-2 pt-2">
                    {estimate.status === "draft" ? (
                      <Button type="button" onClick={() => void approvePresent()} disabled={actionBusy === "present"}>
                        {actionBusy === "present" ? "Updating…" : "Approve & send to reception"}
                      </Button>
                    ) : null}
                    {estimate.status === "presented" ? (
                      <>
                        <Button type="button" onClick={() => setAcceptOpen(true)}>
                          Mark accepted
                        </Button>
                        <Button type="button" variant="outline" onClick={() => void markDeclined()} disabled={actionBusy === "declined"}>
                          Mark declined
                        </Button>
                      </>
                    ) : null}
                    <Button type="button" variant="secondary" onClick={() => window.print()}>
                      Download PDF
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void supersede()} disabled={actionBusy === "supersede"}>
                      Supersede
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="hidden print:block print:pt-8">
                <div className="mt-12 flex justify-between border-t pt-8 text-sm">
                  <span>Patient / attendant signature</span>
                  <span>Authorised signatory</span>
                </div>
                <p className="mt-6 text-center text-xs text-muted-foreground">
                  This is an estimate and actual charges may vary.
                </p>
              </div>

              <div className="hidden print:block">
                <table className="mt-4 w-full border text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">Description</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Unit ₹</th>
                      <th className="p-2 text-right">Total ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((row) => (
                      <tr key={row.seq} className="border-b">
                        <td className="p-2">{row.seq}</td>
                        <td className="p-2">{row.description}</td>
                        <td className="p-2 text-right tabular-nums">{row.quantity}</td>
                        <td className="p-2 text-right tabular-nums">{formatInrPlain(row.unit_price)}</td>
                        <td className="p-2 text-right tabular-nums">{formatInrPlain(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-4 text-right font-semibold">Grand total · ₹{formatInrPlain(grandTotal)}</p>
              </div>
            </div>

            <div className="no-print space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Deposit status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Requested</span>
                    <span className="tabular-nums">₹{formatInrPlain(depositReqN)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Collected</span>
                    <span className="tabular-nums">₹{formatInrPlain(depositColl)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Wallet balance</span>
                    <span className="tabular-nums">₹{formatInrPlain(walletBalance)}</span>
                  </div>
                  <div className="flex justify-between gap-2 font-medium">
                    <span>Outstanding</span>
                    <span className={cn("tabular-nums", outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
                      ₹{formatInrPlain(outstanding)}
                    </span>
                  </div>
                  <Button type="button" className="mt-2 w-full" variant="secondary" onClick={() => setDepositOpen(true)}>
                    Record deposit
                  </Button>
                </CardContent>
              </Card>

              {coverages.length > 0 ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Insurance</CardTitle>
                    <CardDescription>Active coverage on file</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {coverages.map((c) => (
                      <div key={c.id} className="rounded-lg border border-border p-3">
                        <p className="font-medium">
                          {(Array.isArray(c.insurance_companies) ? c.insurance_companies[0]?.name : c.insurance_companies?.name) ??
                            "Insurer"}
                        </p>
                        {c.tpa_name ? <p className="text-xs text-muted-foreground">TPA: {c.tpa_name}</p> : null}
                        <p className="mt-1 text-muted-foreground">Policy · {c.policy_number ?? "—"}</p>
                        <div className="mt-2 flex justify-between tabular-nums">
                          <span>Sum insured</span>
                          <span>₹{formatInrPlain(num(c.coverage_limit))}</span>
                        </div>
                        <div className="flex justify-between tabular-nums">
                          <span>Balance sum insured</span>
                          <span>₹{formatInrPlain(num(c.remaining_balance))}</span>
                        </div>
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="w-full" asChild>
                      <Link href={`/billing/insurance/preauth/new?admissionId=${encodeURIComponent(admissionId)}`}>Create pre-auth</Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              {estimate.actual_invoice_id && actualInvoiceGross != null ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Estimate vs actual</CardTitle>
                    <CardDescription>After discharge final bill</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Estimated</span>
                      <span className="tabular-nums">₹{formatInrPlain(num(estimate.estimated_total))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Actual billed</span>
                      <span className="tabular-nums">₹{formatInrPlain(actualInvoiceGross)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Variance</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          variance != null && variance < 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : variance != null && variance > 0
                              ? "text-red-600 dark:text-red-400"
                              : "",
                        )}
                      >
                        ₹{formatInrPlain(variance ?? 0)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {depositOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <Card className="w-full max-w-md border-border bg-card text-card-foreground shadow-2xl">
            <CardHeader>
              <CardTitle>Record deposit</CardTitle>
              <CardDescription>Credits wallet and links to this estimate.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dep-amt">Amount (₹)</Label>
                <Input
                  id="dep-amt"
                  type="number"
                  min={0}
                  step={0.01}
                  value={depAmount}
                  onChange={(e) => setDepAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={depMethod} onValueChange={setDepMethod}>
                  <SelectTrigger>
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
                <Label htmlFor="dep-ref">Reference (optional)</Label>
                <Input id="dep-ref" value={depRef} onChange={(e) => setDepRef(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setDepositOpen(false)} disabled={depSaving}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitDeposit()} disabled={depSaving}>
                  {depSaving ? "Saving…" : "Submit"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {acceptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <Card className="w-full max-w-md border-border bg-card text-card-foreground shadow-2xl">
            <CardHeader>
              <CardTitle>Mark accepted</CardTitle>
              <CardDescription>Who accepted this estimate?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="acc-name">Accepted by (name)</Label>
                <Input id="acc-name" value={accName} onChange={(e) => setAccName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-2">
                <Label>Relation to patient</Label>
                <Select value={accRel} onValueChange={setAccRel}>
                  <SelectTrigger>
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
                <Button type="button" variant="ghost" onClick={() => setAcceptOpen(false)} disabled={accSaving}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void submitAccepted()} disabled={accSaving}>
                  {accSaving ? "Saving…" : "Confirm"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
