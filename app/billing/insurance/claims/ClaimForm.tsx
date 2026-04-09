"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function numFromInput(v: unknown): number {
  if (v === "" || v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

const claimFormSchema = z.object({
  billedAmount: z.number().min(0),
  approvedAmount: z.number().min(0),
  settledAmount: z.number().min(0),
  insuranceCompanyId: z.string().default(""),
  settlementDueDate: z.string().default(""),
  notes: z.string().max(20000).default(""),
});

type ClaimFormValues = z.infer<typeof claimFormSchema>;

type CompanyOpt = { id: string; name: string };

const formLabel = "mb-1.5 block text-sm font-medium text-slate-800 dark:text-gray-200";
const formControl =
  "border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 dark:focus-visible:border-blue-500 dark:focus-visible:ring-blue-500";
const helperText = "text-sm text-slate-600 dark:text-gray-400";
const sectionHeader = "text-lg font-semibold text-slate-900 dark:text-white";

export type ClaimFormVariant = "edit" | "view";

export function ClaimForm({
  variant,
  claimId,
  title,
}: {
  variant: ClaimFormVariant;
  claimId: string;
  title: string;
}) {
  const router = useRouter();
  const readOnly = variant === "view";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [status, setStatus] = useState("");
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);

  const form = useForm<ClaimFormValues>({
    resolver: zodResolver(claimFormSchema) as Resolver<ClaimFormValues>,
    defaultValues: {
      billedAmount: 0,
      approvedAmount: 0,
      settledAmount: 0,
      insuranceCompanyId: "",
      settlementDueDate: "",
      notes: "",
    },
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = form;
  const companyWatch = watch("insuranceCompanyId");

  const loadCompanies = useCallback(async (hid: string) => {
    const { data } = await supabase.from("insurance_companies").select("id, name").eq("hospital_id", hid).eq("is_active", true).order("name");
    setCompanies(((data ?? []) as { id: string; name: string }[]).map((c) => ({ id: String(c.id), name: String(c.name) })));
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
        if (hid) await loadCompanies(hid);

        const { data, error } = await supabase.rpc("get_claim_by_id", { p_id: claimId });
        if (error) throw new Error(error.message);
        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
        if (!row?.id) throw new Error("Claim not found.");

        const st = String(row.status ?? "").toLowerCase();
        setStatus(st);
        if (variant === "edit" && st !== "draft") {
          router.replace(`/billing/insurance/claims/${claimId}`);
          return;
        }

        setPatientName(String(row.patient_full_name ?? "—"));
        setClaimNumber(String(row.claim_number ?? ""));

        reset({
          billedAmount: n(row.billed_amount),
          approvedAmount: n(row.approved_amount),
          settledAmount: n(row.settled_amount),
          insuranceCompanyId: row.insurance_company_id != null ? String(row.insurance_company_id) : "",
          settlementDueDate: row.settlement_due_date != null ? String(row.settlement_due_date).slice(0, 10) : "",
          notes: row.notes != null ? String(row.notes) : "",
        });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load claim");
        toast.error(e instanceof Error ? e.message : "Failed to load claim");
      } finally {
        setLoading(false);
      }
    })();
  }, [claimId, variant, reset, router, loadCompanies]);

  const persist = async (values: ClaimFormValues, submitToPayer: boolean) => {
    const companyId = values.insuranceCompanyId?.trim() || null;
    const due = values.settlementDueDate?.trim() || null;
    const payload: Record<string, unknown> = {
      billed_amount: values.billedAmount,
      insurance_company_id: companyId,
      settlement_due_date: due || null,
      notes: values.notes.trim() ? values.notes.trim() : null,
      updated_at: new Date().toISOString(),
    };
    if (submitToPayer) {
      payload.status = "submitted";
      payload.submitted_at = new Date().toISOString();
    }
    const { error } = await supabase.from("insurance_claims").update(payload).eq("id", claimId);
    if (error) throw new Error(error.message);
  };

  const saveDraft = handleSubmit(async (values) => {
    if (readOnly) return;
    setSaving(true);
    try {
      await persist(values, false);
      toast.success("Claim saved.");
      router.push("/billing/insurance");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  });

  const submitClaim = handleSubmit(async (values) => {
    if (readOnly) return;
    if (values.billedAmount <= 0) {
      toast.error("Enter a billed amount greater than zero to submit.");
      return;
    }
    setSaving(true);
    try {
      await persist(values, true);
      toast.success("Claim submitted.");
      router.push("/billing/insurance");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSaving(false);
    }
  });

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 p-6 dark:bg-slate-950 dark:text-slate-300">
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <p className="text-red-600 dark:text-red-400">{loadError}</p>
        <Button type="button" variant="outline" asChild>
          <Link href="/billing/insurance">Back to insurance</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 md:p-6 lg:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <Link href="/billing/insurance" className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
            ← Insurance
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
          <p className={cn("mt-1", helperText)}>
            {readOnly
              ? "Read-only. Approved and settled amounts reflect payer and payment records."
              : "Edit details, save your draft, or submit to the payer."}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Status: <span className="font-medium capitalize text-slate-700 dark:text-slate-200">{status.replace(/_/g, " ")}</span>
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className={sectionHeader}>Claim</CardTitle>
            <CardDescription className={helperText}>Identifiers and patient.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className={formLabel}>Claim number</span>
              <p className="font-mono font-medium text-slate-900 dark:text-slate-50">{claimNumber || "—"}</p>
            </div>
            <div>
              <span className={formLabel}>Patient</span>
              <p className="font-medium text-slate-900 dark:text-slate-50">{patientName}</p>
            </div>
          </CardContent>
        </Card>

        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <Card>
            <CardHeader>
              <CardTitle className={sectionHeader}>Amounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="cl-billed" className={formLabel}>
                  Billed amount (₹)
                </Label>
                <Input
                  id="cl-billed"
                  className={cn("h-9 w-full rounded-md shadow-sm", formControl)}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  disabled={readOnly}
                  {...register("billedAmount", { setValueAs: numFromInput })}
                />
                {errors.billedAmount ? <p className="mt-1 text-xs text-red-600">{errors.billedAmount.message}</p> : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cl-appr" className={formLabel}>
                    Approved (₹)
                  </Label>
                  <Input
                    id="cl-appr"
                    className={cn("h-9 w-full rounded-md shadow-sm", formControl)}
                    type="number"
                    min={0}
                    step="0.01"
                    disabled
                    {...register("approvedAmount", { setValueAs: numFromInput })}
                  />
                  <p className={cn("mt-1 text-xs", helperText)}>Set by payer after submission.</p>
                </div>
                <div>
                  <Label htmlFor="cl-set" className={formLabel}>
                    Settled (₹)
                  </Label>
                  <Input
                    id="cl-set"
                    className={cn("h-9 w-full rounded-md shadow-sm", formControl)}
                    type="number"
                    min={0}
                    step="0.01"
                    disabled
                    {...register("settledAmount", { setValueAs: numFromInput })}
                  />
                  <p className={cn("mt-1 text-xs", helperText)}>Updated when payment is recorded.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className={sectionHeader}>Payer & dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className={formLabel}>Insurer</Label>
                <Select
                  value={companyWatch && companyWatch !== "" ? companyWatch : "__none__"}
                  onValueChange={(v) => setValue("insuranceCompanyId", v === "__none__" ? "" : v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className={cn("h-9 w-full rounded-md shadow-sm", formControl)}>
                    <SelectValue placeholder="Not specified" />
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
                <Label htmlFor="cl-due" className={formLabel}>
                  Settlement due
                </Label>
                <Input id="cl-due" type="date" className={cn("h-9 w-full rounded-md shadow-sm", formControl)} disabled={readOnly} {...register("settlementDueDate")} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className={sectionHeader}>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                className={cn("min-h-[100px] w-full rounded-md px-3 py-2 text-sm shadow-sm", formControl)}
                disabled={readOnly}
                placeholder="Internal notes…"
                {...register("notes")}
              />
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href="/billing/insurance">Cancel</Link>
            </Button>
            {!readOnly ? (
              <>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => void saveDraft()}>
                  {saving ? "Saving…" : "Save draft"}
                </Button>
                <Button type="button" disabled={saving} onClick={() => void submitClaim()}>
                  {saving ? "Submitting…" : "Submit claim"}
                </Button>
              </>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
