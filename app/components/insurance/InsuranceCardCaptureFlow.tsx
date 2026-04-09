"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/app/supabase";
import { bestInsuranceCompanyMatch, type InsuranceCompanyRow } from "@/app/lib/insuranceFuzzyMatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InsuranceCardSideCamera } from "./InsuranceCardSideCamera";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

type Props = {
  patientId: string;
  hospitalId: string;
  onSaved?: () => void;
  onCancel?: () => void;
};

export function InsuranceCardCaptureFlow({ patientId, hospitalId, onSaved, onCancel }: Props) {
  const [frontBlob, setFrontBlob] = useState<Blob | null>(null);
  const [backBlob, setBackBlob] = useState<Blob | null>(null);
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  const [backUrl, setBackUrl] = useState<string | null>(null);

  const [ocrLoading, setOcrLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  const [policyNumber, setPolicyNumber] = useState("");
  const [memberId, setMemberId] = useState("");
  const [insuranceName, setInsuranceName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [remainingBalance, setRemainingBalance] = useState("");
  const [coverageLimit, setCoverageLimit] = useState("");

  const [companies, setCompanies] = useState<InsuranceCompanyRow[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [newPayerName, setNewPayerName] = useState("");

  useEffect(() => {
    if (frontBlob) {
      const u = URL.createObjectURL(frontBlob);
      setFrontUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setFrontUrl(null);
    return undefined;
  }, [frontBlob]);

  useEffect(() => {
    if (backBlob) {
      const u = URL.createObjectURL(backBlob);
      setBackUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setBackUrl(null);
    return undefined;
  }, [backBlob]);

  const loadCompanies = useCallback(async () => {
    const { data, error } = await supabase
      .from("insurance_companies")
      .select("id, name")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("name");
    if (error) {
      toast.error(error.message);
      return;
    }
    const list = ((data ?? []) as InsuranceCompanyRow[]).map((r) => ({ id: String(r.id), name: String(r.name) }));
    setCompanies(list);
    return list;
  }, [hospitalId]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  const runOcr = useCallback(async () => {
    if (!frontBlob && !backBlob) {
      toast.error("Capture at least the front or back of the card.");
      return;
    }
    setOcrLoading(true);
    try {
      const front_image_base64 = frontBlob ? await blobToBase64(frontBlob) : "";
      const back_image_base64 = backBlob ? await blobToBase64(backBlob) : "";
      const res = await fetch("/api/insurance/ocr-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          front_image_base64: front_image_base64 || undefined,
          back_image_base64: back_image_base64 || undefined,
          mime_type: "image/jpeg",
        }),
      });
      const json = (await res.json()) as {
        policy_number?: string;
        member_id?: string;
        insurance_name?: string;
        valid_until?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "OCR failed");
      }
      const extractedName = json.insurance_name ?? "";
      setPolicyNumber(json.policy_number ?? "");
      setMemberId(json.member_id ?? "");
      setInsuranceName(extractedName);
      setValidUntil(json.valid_until ?? "");

      const { data: compData } = await supabase
        .from("insurance_companies")
        .select("id, name")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true);
      const list = ((compData ?? []) as InsuranceCompanyRow[]).map((r) => ({ id: String(r.id), name: String(r.name) }));
      setCompanies(list);
      const best = bestInsuranceCompanyMatch(extractedName, list);
      if (best) {
        setSelectedCompanyId(best.row.id);
        setMatchScore(best.score);
      } else {
        setSelectedCompanyId("");
        setMatchScore(null);
      }

      toast.success("Card text extracted — review fields before saving.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "OCR failed");
    } finally {
      setOcrLoading(false);
    }
  }, [frontBlob, backBlob, hospitalId]);

  const addPayer = useCallback(async () => {
    const n = newPayerName.trim();
    if (!n) {
      toast.error("Enter payer name.");
      return;
    }
    const { data, error } = await supabase
      .from("insurance_companies")
      .insert({ hospital_id: hospitalId, name: n })
      .select("id, name")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = data as { id: string; name: string };
    await loadCompanies();
    setSelectedCompanyId(String(row.id));
    setNewPayerName("");
    toast.success("Payer added to directory.");
  }, [hospitalId, newPayerName, loadCompanies]);

  const save = useCallback(async () => {
    const pol = policyNumber.trim();
    const mem = memberId.trim();
    const nameRaw = insuranceName.trim();
    if (!pol && !mem && !nameRaw) {
      toast.error("Enter at least policy number, member ID, or insurer name.");
      return;
    }

    const bal = remainingBalance.trim() === "" ? null : Number.parseFloat(remainingBalance.replace(/,/g, ""));
    const lim = coverageLimit.trim() === "" ? null : Number.parseFloat(coverageLimit.replace(/,/g, ""));
    if (bal != null && Number.isNaN(bal)) {
      toast.error("Invalid remaining balance.");
      return;
    }
    if (lim != null && Number.isNaN(lim)) {
      toast.error("Invalid coverage limit.");
      return;
    }

    const companyId = selectedCompanyId && selectedCompanyId !== "__none__" ? selectedCompanyId : null;

    setSaveLoading(true);
    try {
      const { error } = await supabase.from("patient_insurance_coverage").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        insurance_company_id: companyId,
        insurance_name_raw: nameRaw || null,
        policy_number: pol || null,
        member_id: mem || null,
        valid_until: validUntil.trim() || null,
        remaining_balance: bal,
        coverage_limit: lim,
      });
      if (error) throw new Error(error.message);
      toast.success("Insurance coverage saved.");
      setFrontBlob(null);
      setBackBlob(null);
      setPolicyNumber("");
      setMemberId("");
      setInsuranceName("");
      setValidUntil("");
      setRemainingBalance("");
      setCoverageLimit("");
      setSelectedCompanyId("");
      setMatchScore(null);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaveLoading(false);
    }
  }, [
    policyNumber,
    memberId,
    insuranceName,
    validUntil,
    remainingBalance,
    coverageLimit,
    selectedCompanyId,
    hospitalId,
    patientId,
    onSaved,
  ]);

  const companySelectValue = useMemo(() => selectedCompanyId || "__none__", [selectedCompanyId]);

  return (
    <div className="space-y-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40 md:p-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InsuranceCardSideCamera
          label="Card front"
          description="Policy holder name, plan, insurer logo"
          imageBlob={frontBlob}
          imageUrl={frontUrl}
          onCapture={setFrontBlob}
          onClear={() => setFrontBlob(null)}
        />
        <InsuranceCardSideCamera
          label="Card back"
          description="Phone numbers, address, member ID — optional if details are on front"
          imageBlob={backBlob}
          imageUrl={backUrl}
          onCapture={setBackBlob}
          onClear={() => setBackBlob(null)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={runOcr} disabled={ocrLoading || (!frontBlob && !backBlob)}>
          {ocrLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Read card (OCR)
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-900 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="ins-name">Insurer name (from card)</Label>
          <Input
            id="ins-name"
            className="mt-1.5"
            value={insuranceName}
            onChange={(e) => setInsuranceName(e.target.value)}
            placeholder="e.g. Star Health Insurance"
          />
          {matchScore != null && selectedCompanyId ? (
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
              Matched directory payer (~{Math.round(matchScore * 100)}% similar). You can change the selection below.
            </p>
          ) : insuranceName.trim() ? (
            <p className="mt-1 text-xs text-slate-500">No close directory match — pick a payer manually or add a new one.</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="policy">Policy number</Label>
          <Input id="policy" className="mt-1.5" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="member">Member / subscriber ID</Label>
          <Input id="member" className="mt-1.5" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="valid">Valid until</Label>
          <Input id="valid" type="date" className="mt-1.5" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>

        <div>
          <Label>Directory payer</Label>
          <Select
            value={companySelectValue}
            onValueChange={(v) => {
              setSelectedCompanyId(v === "__none__" ? "" : v);
              if (v === "__none__") setMatchScore(null);
            }}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select payer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No match / not listed</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="new-payer">Add payer to directory</Label>
            <Input
              id="new-payer"
              className="mt-1.5"
              value={newPayerName}
              onChange={(e) => setNewPayerName(e.target.value)}
              placeholder="Exact name for future fuzzy match"
            />
          </div>
          <Button type="button" variant="outline" onClick={addPayer}>
            Add payer
          </Button>
        </div>

        <div>
          <Label htmlFor="bal">Remaining balance (₹)</Label>
          <Input
            id="bal"
            className="mt-1.5"
            inputMode="decimal"
            value={remainingBalance}
            onChange={(e) => setRemainingBalance(e.target.value)}
            placeholder="From eligibility / manual"
          />
        </div>
        <div>
          <Label htmlFor="lim">Coverage limit (₹)</Label>
          <Input
            id="lim"
            className="mt-1.5"
            inputMode="decimal"
            value={coverageLimit}
            onChange={(e) => setCoverageLimit(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <Button type="button" className="w-full sm:w-auto" onClick={save} disabled={saveLoading}>
        {saveLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save coverage
      </Button>
    </div>
  );
}
