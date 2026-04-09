"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DRUG_LICENSE_RE = /^DL-[A-Z]{2}-\d+$/i;
const GST_RE = /^[0-9A-Z]{15}$/i;

function normalizeDrugLicense(s: string): string {
  return s.trim().toUpperCase();
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function parseBankDetails(raw: unknown): {
  accountNo: string;
  ifsc: string;
  bankName: string;
  branch: string;
} {
  if (!raw || typeof raw !== "object") {
    return { accountNo: "", ifsc: "", bankName: "", branch: "" };
  }
  const o = raw as Record<string, unknown>;
  return {
    accountNo: o.account_no != null ? String(o.account_no) : "",
    ifsc: o.ifsc != null ? String(o.ifsc) : "",
    bankName: o.bank_name != null ? String(o.bank_name) : "",
    branch: o.branch != null ? String(o.branch) : "",
  };
}

export type EditVendorModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string | null;
  hospitalId: string | null;
  supabase: SupabaseClient;
  onSaved?: () => void;
};

export function EditVendorModal({
  open,
  onOpenChange,
  vendorId,
  hospitalId,
  supabase,
  onSaved,
}: EditVendorModalProps) {
  const [vendorName, setVendorName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [drugLicenseNo, setDrugLicenseNo] = useState("");
  const [gstNo, setGstNo] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("30");
  const [accountNo, setAccountNo] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [branch, setBranch] = useState("");
  const [statusLabel, setStatusLabel] = useState<"active" | "inactive" | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingVendor, setLoadingVendor] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};

    if (!vendorName.trim()) e.vendor_name = "Vendor name is required.";
    if (!phone.trim()) e.phone = "Phone is required.";
    else if (digitsOnly(phone).length < 10) e.phone = "Enter at least 10 digits.";

    if (!drugLicenseNo.trim()) e.drug_license_no = "Drug license is required.";
    else if (!DRUG_LICENSE_RE.test(normalizeDrugLicense(drugLicenseNo))) {
      e.drug_license_no = "Use format DL-XX-12345 (e.g. DL-HR-12345).";
    }

    const gst = gstNo.trim().toUpperCase();
    if (gst && !GST_RE.test(gst)) {
      e.gst_no = "GST must be exactly 15 alphanumeric characters.";
    }

    const ptd = Number(paymentTermsDays);
    if (!Number.isFinite(ptd) || ptd < 0 || ptd > 3650) {
      e.payment_terms_days = "Enter a number between 0 and 3650.";
    }

    const em = email.trim();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      e.email = "Invalid email address.";
    }

    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }, [vendorName, phone, drugLicenseNo, gstNo, paymentTermsDays, email]);

  useEffect(() => {
    if (!open || !vendorId) {
      setLoadError(null);
      setLoadingVendor(false);
      return;
    }

    let cancelled = false;
    setLoadingVendor(true);
    setLoadError(null);
    setSubmitError(null);
    setFieldErrors({});

    void (async () => {
      const { data, error } = await supabase.rpc("get_vendor", { p_vendor_id: vendorId });
      if (cancelled) return;
      setLoadingVendor(false);
      if (error) {
        setLoadError(error.message);
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        setLoadError("Vendor not found.");
        return;
      }

      if (hospitalId && String(row.hospital_id) !== hospitalId) {
        setLoadError("Vendor does not belong to this hospital.");
        return;
      }

      setVendorName(String(row.vendor_name ?? ""));
      setContactPerson(row.contact_person != null ? String(row.contact_person) : "");
      setPhone(String(row.phone ?? ""));
      setEmail(row.email != null ? String(row.email) : "");
      setAddressLine1(row.address_line1 != null ? String(row.address_line1) : "");
      setAddressLine2(row.address_line2 != null ? String(row.address_line2) : "");
      setCity(row.city != null ? String(row.city) : "");
      setState(row.state != null ? String(row.state) : "");
      setPincode(row.pincode != null ? String(row.pincode) : "");
      setDrugLicenseNo(String(row.drug_license_no ?? ""));
      setGstNo(row.gst_no != null ? String(row.gst_no) : "");
      setPaymentTermsDays(String(row.payment_terms_days ?? 30));
      const bank = parseBankDetails(row.bank_details);
      setAccountNo(bank.accountNo);
      setIfsc(bank.ifsc);
      setBankName(bank.bankName);
      setBranch(bank.branch);
      setStatusLabel(row.is_active === false ? "inactive" : "active");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, vendorId, hospitalId, supabase]);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitError(null);
    if (!vendorId || !hospitalId) return;
    if (!validate()) return;

    const bankPayload =
      accountNo.trim() || ifsc.trim() || bankName.trim() || branch.trim()
        ? {
            account_no: accountNo.trim() || null,
            ifsc: ifsc.trim().toUpperCase() || null,
            bank_name: bankName.trim() || null,
            branch: branch.trim() || null,
          }
        : null;

    setSubmitting(true);
    const { error } = await supabase.rpc("update_vendor", {
      p_vendor_id: vendorId,
      p_vendor_name: vendorName.trim(),
      p_contact_person: contactPerson.trim() || null,
      p_phone: phone.trim(),
      p_email: email.trim() || null,
      p_address_line1: addressLine1.trim() || null,
      p_address_line2: addressLine2.trim() || null,
      p_city: city.trim() || null,
      p_state: state.trim() || null,
      p_pincode: pincode.trim() || null,
      p_drug_license_no: normalizeDrugLicense(drugLicenseNo),
      p_gst_no: gstNo.trim() ? gstNo.trim().toUpperCase() : null,
      p_payment_terms_days: Number.parseInt(paymentTermsDays, 10),
      p_bank_details: bankPayload,
    });
    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    onSaved?.();
    close();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close dialog"
        onClick={() => close()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-vendor-title"
        className={cn(
          "relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg",
        )}
      >
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <h2 id="edit-vendor-title" className="text-lg font-semibold tracking-tight">
            Edit vendor
          </h2>
          {statusLabel ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Status:{" "}
              <span className="font-medium text-foreground">
                {statusLabel === "active" ? "Active" : "Inactive"}
              </span>
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loadError ? (
            <p className="text-sm text-destructive" role="alert">
              {loadError}
            </p>
          ) : loadingVendor ? (
            <p className="text-sm text-muted-foreground">Loading vendor…</p>
          ) : (
            <form id="edit-vendor-form" onSubmit={(e) => void onSubmit(e)} className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Vendor</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_vendor_name">Vendor name *</Label>
                    <Input
                      id="edit_vendor_name"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      autoComplete="organization"
                    />
                    {fieldErrors.vendor_name ? (
                      <p className="text-xs text-destructive">{fieldErrors.vendor_name}</p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_contact_person">Contact person</Label>
                    <Input
                      id="edit_contact_person"
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_phone">Phone *</Label>
                    <Input id="edit_phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                    {fieldErrors.phone ? <p className="text-xs text-destructive">{fieldErrors.phone}</p> : null}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_email">Email</Label>
                    <Input id="edit_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                    {fieldErrors.email ? <p className="text-xs text-destructive">{fieldErrors.email}</p> : null}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Address</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_line1">Address line 1</Label>
                    <Input id="edit_line1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_line2">Address line 2</Label>
                    <Input id="edit_line2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_city">City</Label>
                    <Input id="edit_city" value={city} onChange={(e) => setCity(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_state">State</Label>
                    <Input id="edit_state" value={state} onChange={(e) => setState(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_pincode">Pincode</Label>
                    <Input id="edit_pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} />
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Compliance & terms</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_drug_license">Drug license no. *</Label>
                    <Input
                      id="edit_drug_license"
                      value={drugLicenseNo}
                      onChange={(e) => setDrugLicenseNo(e.target.value)}
                      placeholder="DL-HR-12345"
                    />
                    {fieldErrors.drug_license_no ? (
                      <p className="text-xs text-destructive">{fieldErrors.drug_license_no}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Format: DL-STATE_CODE-NUMBER</p>
                    )}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_gst">GST no.</Label>
                    <Input
                      id="edit_gst"
                      value={gstNo}
                      onChange={(e) => setGstNo(e.target.value.toUpperCase())}
                      placeholder="15-character GSTIN"
                      maxLength={15}
                    />
                    {fieldErrors.gst_no ? <p className="text-xs text-destructive">{fieldErrors.gst_no}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_payment_terms">Payment terms (days)</Label>
                    <Input
                      id="edit_payment_terms"
                      type="number"
                      min={0}
                      max={3650}
                      value={paymentTermsDays}
                      onChange={(e) => setPaymentTermsDays(e.target.value)}
                    />
                    {fieldErrors.payment_terms_days ? (
                      <p className="text-xs text-destructive">{fieldErrors.payment_terms_days}</p>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Bank details</h3>
                <p className="text-xs text-muted-foreground">Optional — stored as JSON on the vendor record.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_account_no">Account number</Label>
                    <Input id="edit_account_no" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_ifsc">IFSC</Label>
                    <Input id="edit_ifsc" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_bank_name">Bank name</Label>
                    <Input id="edit_bank_name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit_branch">Branch</Label>
                    <Input id="edit_branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
                  </div>
                </div>
              </section>

              {submitError ? (
                <p className="text-sm text-destructive" role="alert">
                  {submitError}
                </p>
              ) : null}
            </form>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" onClick={() => close()}>
            Cancel
          </Button>
          <Button type="submit" form="edit-vendor-form" disabled={loadingVendor || !!loadError || submitting || !vendorId}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
