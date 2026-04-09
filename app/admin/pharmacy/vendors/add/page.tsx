"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchAuthOrgId } from "@/app/lib/authOrg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "../../hooks/useSupabase";

const DRUG_LICENSE_RE = /^DL-[A-Z]{2}-\d+$/i;
const GST_RE = /^[0-9A-Z]{15}$/i;

function normalizeDrugLicense(s: string): string {
  return s.trim().toUpperCase();
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function rpcFailureMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof o.message === "string" && o.message.length > 0) return o.message;
    const parts = [o.code, o.details, o.hint].filter((x) => typeof x === "string" && x.length > 0) as string[];
    if (parts.length > 0) return parts.join(" — ");
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function AddVendorPage() {
  const router = useRouter();
  const supabase = useSupabase();

  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

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

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const { orgId, error } = await fetchAuthOrgId();
      if (error) {
        setOrgError(error.message);
        return;
      }
      const id = orgId?.trim() ?? "";
      if (!id) {
        setOrgError("No hospital context — cannot add vendors.");
        return;
      }
      setHospitalId(id);
    })();
  }, []);

  const validate = useCallback((): { valid: boolean; errors: Record<string, string> } => {
    const e: Record<string, string> = {};

    if (!vendorName.trim()) e.vendor_name = "Vendor name is required.";
    const phoneTrimmed = phone.trim();
    if (!phoneTrimmed) e.phone = "Phone is required.";
    else if (digitsOnly(phoneTrimmed).length < 10) e.phone = "Enter at least 10 digits.";

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
    return { valid: Object.keys(e).length === 0, errors: e };
  }, [vendorName, phone, drugLicenseNo, gstNo, paymentTermsDays, email]);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitError(null);
    if (!hospitalId) return;

    const { valid } = validate();
    if (!valid) {
      return;
    }

    const formData = {
      vendor_name: vendorName.trim(),
      contact_person: contactPerson.trim() || null,
      phone: phone.trim(),
      email: email.trim() || null,
      address_line1: addressLine1.trim() || null,
      address_line2: addressLine2.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      pincode: pincode.trim() || null,
      drug_license_no: normalizeDrugLicense(drugLicenseNo),
      gst_no: gstNo.trim() ? gstNo.trim().toUpperCase() : null,
      payment_terms_days: paymentTermsDays,
      account_no: accountNo.trim() || null,
      ifsc: ifsc.trim() ? ifsc.trim().toUpperCase() : null,
      bank_name: bankName.trim() || null,
      branch: branch.trim() || null,
    };

    const paymentTermsParsed = parseInt(formData.payment_terms_days, 10);
    const rpcPayload = {
      p_hospital_id: hospitalId,
      p_vendor_name: formData.vendor_name,
      p_contact_person: formData.contact_person,
      p_phone: formData.phone,
      p_email: formData.email,
      p_address: {
        line1: formData.address_line1,
        line2: formData.address_line2,
        city: formData.city,
        state: formData.state,
        pincode: formData.pincode,
      },
      p_drug_license_no: formData.drug_license_no,
      p_gst_no: formData.gst_no,
      p_payment_terms_days: Number.isFinite(paymentTermsParsed) ? paymentTermsParsed : 30,
      p_bank_details: {
        account_no: formData.account_no,
        ifsc: formData.ifsc,
        bank_name: formData.bank_name,
        branch: formData.branch,
      },
    };

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("create_vendor", rpcPayload);
      if (error) throw error;
      if (data == null) {
        throw new Error("Vendor was not created.");
      }
    } catch (err) {
      const message = rpcFailureMessage(err);
      alert(message);
      setSubmitError(message);
      return;
    } finally {
      setSubmitting(false);
    }

    try {
      sessionStorage.setItem("docpad_refetch_vendors", "1");
      router.push("/admin/pharmacy/vendors");
    } catch {
      window.location.assign("/admin/pharmacy/vendors");
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" asChild>
            <Link href="/admin/pharmacy/vendors">← Vendors</Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Add vendor</h1>
          <p className="mt-1 text-sm text-muted-foreground">Register a distributor or wholesaler for your hospital.</p>
        </div>

        {orgError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {orgError}
          </p>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle>Vendor</CardTitle>
              <CardDescription>Required fields are marked *</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="vendor_name">Vendor name *</Label>
                <Input
                  id="vendor_name"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  autoComplete="organization"
                />
                {fieldErrors.vendor_name ? <p className="text-xs text-destructive">{fieldErrors.vendor_name}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact_person">Contact person</Label>
                <Input
                  id="contact_person"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                {fieldErrors.phone ? <p className="text-xs text-destructive">{fieldErrors.phone}</p> : null}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                {fieldErrors.email ? <p className="text-xs text-destructive">{fieldErrors.email}</p> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle>Address</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="line1">Address line 1</Label>
                <Input id="line1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="line2">Address line 2</Label>
                <Input id="line2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pincode">Pincode</Label>
                <Input id="pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle>Compliance & terms</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="drug_license">Drug license no. *</Label>
                <Input
                  id="drug_license"
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
                <Label htmlFor="gst">GST no.</Label>
                <Input
                  id="gst"
                  value={gstNo}
                  onChange={(e) => setGstNo(e.target.value.toUpperCase())}
                  placeholder="15-character GSTIN"
                  maxLength={15}
                />
                {fieldErrors.gst_no ? <p className="text-xs text-destructive">{fieldErrors.gst_no}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment_terms">Payment terms (days)</Label>
                <Input
                  id="payment_terms"
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
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle>Bank details</CardTitle>
              <CardDescription>Optional — stored as JSON on the vendor record.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="account_no">Account number</Label>
                <Input id="account_no" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ifsc">IFSC</Label>
                <Input id="ifsc" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank_name">Bank name</Label>
                <Input id="bank_name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="branch">Branch</Label>
                <Input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {submitError ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!hospitalId || submitting}>
              {submitting ? "Saving…" : "Create vendor"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/admin/pharmacy/vendors">Cancel</Link>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
