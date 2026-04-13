"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import ClinicalConfigurationNav from "@/components/admin/ClinicalConfigurationNav";

const CODE_SYSTEM = "http://snomed.info/sct";

const CATEGORIES = [
  "consultation",
  "procedure",
  "lab_test",
  "imaging",
  "medication",
  "supply",
  "room_charge",
  "nursing",
  "registration",
  "other",
] as const;

type Category = (typeof CATEGORIES)[number];

type ChargeRow = {
  id: string;
  hospital_id: string;
  code: string;
  display_name: string;
  category: string;
  base_price: number;
  currency: string;
  tax_type: string | null;
  tax_rate: number | null;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
};

const FILTER_TABS: { id: string; label: string; category: Category | null }[] = [
  { id: "all", label: "All", category: null },
  { id: "room_charge", label: "Room Charges", category: "room_charge" },
  { id: "consultation", label: "Consultation", category: "consultation" },
  { id: "procedure", label: "Procedures", category: "procedure" },
  { id: "lab_test", label: "Lab Tests", category: "lab_test" },
  { id: "imaging", label: "Imaging", category: "imaging" },
  { id: "registration", label: "Registration", category: "registration" },
  { id: "other", label: "Other", category: "other" },
];

const TAX_OPTIONS: { value: string; label: string }[] = [
  { value: "gst_exempt", label: "GST Exempt" },
  { value: "gst_5", label: "5%" },
  { value: "gst_12", label: "12%" },
  { value: "gst_18", label: "18%" },
];

const CATEGORY_CODE_PREFIX: Record<Category, string> = {
  room_charge: "CHG-ROOM",
  consultation: "CHG-CONS",
  procedure: "CHG-PROC",
  lab_test: "CHG-LAB",
  imaging: "CHG-IMG",
  registration: "CHG-REG",
  nursing: "CHG-NURS",
  supply: "CHG-SUP",
  medication: "CHG-MED",
  other: "CHG-OTH",
};

function taxRateForType(t: string): number {
  switch (t) {
    case "gst_5":
      return 5;
    case "gst_12":
      return 12;
    case "gst_18":
      return 18;
    default:
      return 0;
  }
}

function categoryLabel(cat: string): string {
  return cat.replace(/_/g, " ");
}

function formatTax(taxType: string | null): string {
  const o = TAX_OPTIONS.find((x) => x.value === taxType);
  return o?.label ?? (taxType || "—");
}

function statusBadgeClass(st: string): string {
  switch (st) {
    case "active":
      return "bg-emerald-50 text-emerald-900 ring-emerald-200";
    case "draft":
      return "bg-slate-100 text-slate-800 ring-slate-200";
    case "retired":
      return "bg-gray-100 text-gray-600 ring-gray-200";
    default:
      return "bg-gray-50 text-gray-700 ring-gray-200";
  }
}

function parseRow(r: Record<string, unknown>): ChargeRow | null {
  const id = r.id != null ? String(r.id) : "";
  if (!id) return null;
  const bp = r.base_price;
  const basePrice = typeof bp === "number" ? bp : bp != null ? Number(bp) : 0;
  const tr = r.tax_rate;
  const taxRate = typeof tr === "number" ? tr : tr != null ? Number(tr) : null;
  return {
    id,
    hospital_id: String(r.hospital_id ?? ""),
    code: String(r.code ?? ""),
    display_name: String(r.display_name ?? ""),
    category: String(r.category ?? "other"),
    base_price: Number.isFinite(basePrice) ? basePrice : 0,
    currency: String(r.currency ?? "INR"),
    tax_type: r.tax_type != null ? String(r.tax_type) : null,
    tax_rate: taxRate != null && Number.isFinite(taxRate) ? taxRate : null,
    status: String(r.status ?? "draft"),
    effective_from: r.effective_from != null ? String(r.effective_from).slice(0, 10) : null,
    effective_to: r.effective_to != null ? String(r.effective_to).slice(0, 10) : null,
  };
}

function TableSkeletonInner() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export default function AdminPricingPage() {
  const formId = useId();
  const searchParams = useSearchParams();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** `"all"` or a `category` value from FILTER_TABS */
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "edit">("edit");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const [fName, setFName] = useState("");
  /** Create panel only; `""` = unselected (e.g. filter tab "All"). */
  const [fCategory, setFCategory] = useState<Category | "">("");
  const [fPrice, setFPrice] = useState("");
  const [fTax, setFTax] = useState("gst_exempt");
  const [fStatus, setFStatus] = useState("active");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("charge_item_definitions")
      .select("*")
      .eq("hospital_id", hid)
      .order("category")
      .order("code");
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      setRows([]);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setRows(list.map(parseRow).filter((x): x is ChargeRow => x != null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { hospitalId: hid, error: e } = await fetchHospitalIdFromPractitionerAuthId();
      if (cancelled) return;
      if (e) setOrgError(e.message);
      const id = hid?.trim() || null;
      setHospitalId(id);
      if (id) await load(id);
      else setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const raw = searchParams.get("category");
    if (!raw) return;
    const match = FILTER_TABS.find((t) => t.id === raw);
    if (match) setFilterCategory(match.id);
  }, [searchParams]);

  const filteredRows = useMemo(() => {
    if (filterCategory === "all") return rows;
    return rows.filter((r) => r.category === filterCategory);
  }, [rows, filterCategory]);

  const previewGeneratedCode = useMemo(() => {
    if (!fCategory) return null;
    const prefix = CATEGORY_CODE_PREFIX[fCategory];
    const n = rows.filter((r) => r.category === fCategory).length;
    return `${prefix}-${String(n + 1).padStart(3, "0")}`;
  }, [rows, fCategory]);

  function filterKeyForTab(category: Category | null): string {
    return category == null ? "all" : category;
  }

  function openCreate() {
    setPanelMode("create");
    setEditingId(null);
    setFName("");
    if (filterCategory === "all") {
      setFCategory("");
    } else {
      const c = filterCategory as Category;
      setFCategory(CATEGORIES.includes(c) ? c : "");
    }
    setFPrice("");
    setFTax("gst_exempt");
    setFStatus("draft");
    setFFrom(new Date().toISOString().slice(0, 10));
    setFTo("");
    setFormError(null);
    setPanelOpen(true);
  }

  function openEdit(row: ChargeRow) {
    setPanelMode("edit");
    setEditingId(row.id);
    setFName(row.display_name);
    setFCategory((CATEGORIES.includes(row.category as Category) ? row.category : "other") as Category);
    setFPrice(String(row.base_price));
    setFTax(row.tax_type ?? "gst_exempt");
    setFStatus(row.status);
    setFFrom(row.effective_from ?? "");
    setFTo(row.effective_to ?? "");
    setFormError(null);
    setPanelOpen(true);
  }

  async function savePanel() {
    if (!hospitalId) return;
    const name = fName.trim();
    const price = parseFloat(fPrice.replace(/,/g, ""));
    if (!name) {
      setFormError("Display name is required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError("Enter a valid base price.");
      return;
    }
    if (panelMode === "create") {
      if (!fCategory) {
        setFormError("Category is required.");
        return;
      }
      setSaving(true);
      setFormError(null);
      const prefix = CATEGORY_CODE_PREFIX[fCategory];
      const { count, error: countErr } = await supabase
        .from("charge_item_definitions")
        .select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("category", fCategory);
      if (countErr) {
        setSaving(false);
        setFormError(countErr.message);
        return;
      }
      const nextNum = (count ?? 0) + 1;
      const code = `${prefix}-${String(nextNum).padStart(3, "0")}`;
      const tr = taxRateForType(fTax);
      const { error: upErr } = await supabase.from("charge_item_definitions").insert({
        hospital_id: hospitalId,
        code,
        code_system: CODE_SYSTEM,
        display_name: name,
        category: fCategory as Category,
        base_price: price,
        currency: "INR",
        tax_type: fTax,
        tax_rate: tr,
        status: fStatus,
        effective_from: fFrom.trim() || new Date().toISOString().slice(0, 10),
        effective_to: fTo.trim() || null,
      });
      setSaving(false);
      if (upErr) {
        setFormError(upErr.message);
        return;
      }
      setPanelOpen(false);
      void load(hospitalId);
      return;
    }
    if (!editingId) return;
    setSaving(true);
    setFormError(null);
    const { error: upErr } = await supabase
      .from("charge_item_definitions")
      .update({
        display_name: name,
        base_price: price,
        tax_type: fTax,
        tax_rate: taxRateForType(fTax),
        status: fStatus,
        effective_from: fFrom.trim() || null,
        effective_to: fTo.trim() || null,
      })
      .eq("id", editingId);
    setSaving(false);
    if (upErr) {
      setFormError(upErr.message);
      return;
    }
    setPanelOpen(false);
    void load(hospitalId);
  }

  async function toggleRetired(row: ChargeRow) {
    if (!hospitalId) return;
    if (row.status !== "active" && row.status !== "retired") return;
    const newStatus = row.status === "active" ? "retired" : "active";
    setRowBusyId(row.id);
    const { error: upErr } = await supabase.from("charge_item_definitions").update({ status: newStatus }).eq("id", row.id);
    setRowBusyId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    void load(hospitalId);
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clinical configuration</p>
              <ClinicalConfigurationNav />
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Pricing / Charge master</h1>
            <p className="text-sm text-muted-foreground">
              Hospital charge catalog — used by billing and admission deposit defaults.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/admin">← Admin home</Link>
          </Button>
        </div>

        {orgError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{orgError}</div>
        ) : null}
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {FILTER_TABS.map((t) => {
            const key = filterKeyForTab(t.category);
            const active = filterCategory === key;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilterCategory(key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  active ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-card text-muted-foreground hover:bg-muted/50",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader className="flex flex-col gap-3 border-b border-border sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Charge items</CardTitle>
              <CardDescription>Code, category, GST, and lifecycle status.</CardDescription>
            </div>
            <Button type="button" onClick={openCreate} disabled={!hospitalId}>
              <Plus className="mr-2 h-4 w-4" />
              Add charge item
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <TableSkeletonInner />
            ) : filteredRows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">No charge items in this filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-semibold">Code</TableHead>
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Category</TableHead>
                      <TableHead className="font-semibold">Price (₹)</TableHead>
                      <TableHead className="font-semibold">Tax</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="text-right font-semibold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.code}</TableCell>
                        <TableCell className="max-w-[220px] truncate font-medium" title={row.display_name}>
                          {row.display_name}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium uppercase text-muted-foreground">
                            {categoryLabel(row.category)}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{row.base_price.toFixed(0)}</TableCell>
                        <TableCell className="text-sm">{formatTax(row.tax_type)}</TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
                              statusBadgeClass(row.status),
                            )}
                          >
                            {row.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => openEdit(row)}
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            {row.status === "active" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                disabled={rowBusyId === row.id}
                                onClick={() => void toggleRetired(row)}
                              >
                                Retire
                              </Button>
                            ) : row.status === "retired" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                disabled={rowBusyId === row.id}
                                onClick={() => void toggleRetired(row)}
                              >
                                Activate
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {panelOpen ? (
        <div className="fixed inset-0 z-[100] flex justify-end" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close panel" onClick={() => setPanelOpen(false)} />
          <div
            className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${formId}-panel-title`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 id={`${formId}-panel-title`} className="text-lg font-bold text-foreground">
                {panelMode === "create" ? "Add charge item" : "Edit charge item"}
              </h2>
              <button
                type="button"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                onClick={() => setPanelOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4">
                {panelMode === "create" ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`${formId}-cat`}>Category</Label>
                      <select
                        id={`${formId}-cat`}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={fCategory}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFCategory(v === "" ? "" : (v as Category));
                        }}
                      >
                        <option value="">Select category…</option>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(c)}
                          </option>
                        ))}
                      </select>
                      {previewGeneratedCode ? (
                        <p className="text-xs text-gray-400">Code will be: {previewGeneratedCode}</p>
                      ) : null}
                    </div>
                  </>
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor={`${formId}-name`}>Display name</Label>
                  <Input id={`${formId}-name`} value={fName} onChange={(e) => setFName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${formId}-price`}>Base price (₹)</Label>
                  <Input
                    id={`${formId}-price`}
                    inputMode="decimal"
                    value={fPrice}
                    onChange={(e) => setFPrice(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${formId}-tax`}>Tax type</Label>
                  <select
                    id={`${formId}-tax`}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={fTax}
                    onChange={(e) => setFTax(e.target.value)}
                  >
                    {TAX_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium text-foreground">Status</span>
                  <div className="flex flex-wrap gap-2">
                    {(["active", "draft", "retired"] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFStatus(st)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                          fStatus === st ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-card",
                        )}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`${formId}-from`}>Effective from</Label>
                    <Input id={`${formId}-from`} type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${formId}-to`}>Effective to (optional)</Label>
                    <Input id={`${formId}-to`} type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
                  </div>
                </div>
                {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
              </div>
            </div>
            <div className="flex gap-2 border-t border-border px-5 py-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setPanelOpen(false)}>
                Cancel
              </Button>
              <Button type="button" className="flex-1" disabled={saving} onClick={() => void savePanel()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
