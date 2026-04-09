"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type HospitalProfile = {
  id: string;
  name: string;
  address_line1: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  email: string | null;
  website: string | null;
  hfr_id: string | null;
  nabh_accredited: boolean;
  nabh_certificate_number: string | null;
  nabh_valid_until: string | null;
};

function parseProfileRow(r: Record<string, unknown>): HospitalProfile | null {
  if (r?.id == null) return null;
  const rawDate = r.nabh_valid_until;
  let validUntil: string | null = null;
  if (rawDate != null && String(rawDate).trim() !== "") {
    const s = String(rawDate);
    validUntil = s.length >= 10 ? s.slice(0, 10) : s;
  }
  return {
    id: String(r.id),
    name: String(r.name ?? "").trim() || "—",
    address_line1: r.address_line1 != null && String(r.address_line1).trim() ? String(r.address_line1).trim() : null,
    phone: r.phone != null && String(r.phone).trim() ? String(r.phone).trim() : null,
    city: r.city != null && String(r.city).trim() ? String(r.city).trim() : null,
    state: r.state != null && String(r.state).trim() ? String(r.state).trim() : null,
    pincode: r.pincode != null && String(r.pincode).trim() ? String(r.pincode).trim() : null,
    email: r.email != null && String(r.email).trim() ? String(r.email).trim() : null,
    website: r.website != null && String(r.website).trim() ? String(r.website).trim() : null,
    hfr_id: r.hfr_id != null && String(r.hfr_id).trim() ? String(r.hfr_id).trim() : null,
    nabh_accredited: Boolean(r.nabh_accredited),
    nabh_certificate_number:
      r.nabh_certificate_number != null && String(r.nabh_certificate_number).trim()
        ? String(r.nabh_certificate_number).trim()
        : null,
    nabh_valid_until: validUntil,
  };
}

function profileToForm(p: HospitalProfile): FormState {
  return {
    name: p.name === "—" ? "" : p.name,
    address_line1: p.address_line1 ?? "",
    phone: p.phone ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    pincode: p.pincode ?? "",
    email: p.email ?? "",
    website: p.website ?? "",
    hfr_id: p.hfr_id ?? "",
    nabh_accredited: p.nabh_accredited,
    nabh_certificate_number: p.nabh_certificate_number ?? "",
    nabh_valid_until: p.nabh_valid_until ?? "",
  };
}

type FormState = {
  name: string;
  address_line1: string;
  phone: string;
  city: string;
  state: string;
  pincode: string;
  email: string;
  website: string;
  hfr_id: string;
  nabh_accredited: boolean;
  nabh_certificate_number: string;
  nabh_valid_until: string;
};

function formatDisplayDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
}

function websiteHref(url: string): string {
  const t = url.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export default function HospitalProfilePage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [profile, setProfile] = useState<HospitalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const loadProfile = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("get_hospital_profile", { p_hospital_id: hid });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setProfile(null);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    const row = list[0];
    if (!row) {
      setError("Hospital profile not found.");
      setProfile(null);
      return;
    }
    const parsed = parseProfileRow(row);
    setProfile(parsed);
    if (parsed) {
      setForm(profileToForm(parsed));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid, error: e } = await fetchHospitalIdFromPractitionerAuthId();
      const id = hid?.trim() || null;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      if (!id) {
        setError("No hospital on your practitioner record. Contact support.");
        setLoading(false);
        return;
      }
      setHospitalId(id);
      await loadProfile(id);
    })();
  }, [loadProfile]);

  const startEdit = useCallback(() => {
    if (!profile) return;
    setForm(profileToForm(profile));
    setSaveError(null);
    setFieldErrors({});
    setEditing(true);
  }, [profile]);

  const cancelEdit = useCallback(() => {
    if (profile) setForm(profileToForm(profile));
    setSaveError(null);
    setFieldErrors({});
    setEditing(false);
  }, [profile]);

  const validateForm = useCallback((f: FormState): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!f.name.trim()) next.name = "Required";
    if (!f.address_line1.trim()) next.address_line1 = "Required";
    if (!f.phone.trim()) next.phone = "Required";
    if (!f.city.trim()) next.city = "Required";
    if (!f.state.trim()) next.state = "Required";
    if (!f.pincode.trim()) next.pincode = "Required";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }, []);

  const save = useCallback(async () => {
    if (!hospitalId || !form) return;
    setSaveError(null);
    if (!validateForm(form)) return;
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc("update_hospital_profile", {
      p_hospital_id: hospitalId,
      p_name: form.name.trim(),
      p_address_line1: form.address_line1.trim(),
      p_phone: form.phone.trim(),
      p_city: form.city.trim(),
      p_state: form.state.trim(),
      p_pincode: form.pincode.trim(),
      p_email: form.email.trim() || null,
      p_website: form.website.trim() || null,
      p_hfr_id: form.hfr_id.trim() || null,
      p_nabh_accredited: form.nabh_accredited,
      p_nabh_certificate_number: form.nabh_certificate_number.trim() || null,
      p_nabh_valid_until: form.nabh_valid_until.trim() || null,
    });
    setSaving(false);
    if (rpcErr) {
      setSaveError(rpcErr.message);
      return;
    }
    setEditing(false);
    await loadProfile(hospitalId);
  }, [form, hospitalId, loadProfile, validateForm]);

  const displayName = profile?.name === "—" || !profile?.name ? "Hospital" : profile.name;

  const readOnlyRows = useMemo(() => {
    if (!profile) return [];
    return [
      { label: "Hospital name", value: profile.name },
      { label: "Address", value: profile.address_line1 ?? "—" },
      { label: "Phone", value: profile.phone ?? "—", mono: false },
      { label: "City", value: profile.city ?? "—" },
      { label: "State", value: profile.state ?? "—" },
      { label: "Pincode", value: profile.pincode ?? "—", mono: true },
      { label: "Email", value: profile.email ?? "—" },
      {
        label: "Website",
        value: profile.website ? (
          <a
            href={websiteHref(profile.website)}
            className="font-medium text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {profile.website}
          </a>
        ) : (
          "—"
        ),
      },
      { label: "HFR ID", value: profile.hfr_id ?? "—", mono: true },
      {
        label: "NABH certificate #",
        value: profile.nabh_accredited ? (profile.nabh_certificate_number ?? "—") : "—",
      },
      {
        label: "NABH valid until",
        value: profile.nabh_accredited ? formatDisplayDate(profile.nabh_valid_until) : "—",
      },
    ] as { label: string; value: ReactNode; mono?: boolean }[];
  }, [profile]);

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Hospital profile</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Organization details for your hospital (read-only unless editing).
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/admin">← Admin home</Link>
          </Button>
        </div>

        {loading ? (
          <Card className="border-border shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 py-14">
              <div
                className="h-9 w-9 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                aria-hidden
              />
              <p className="text-sm font-medium text-muted-foreground">Loading hospital profile…</p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-border shadow-sm">
            <CardContent className="py-8">
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            </CardContent>
          </Card>
        ) : profile && form ? (
          <>
            <Card className="border-border shadow-sm">
              <CardHeader className="flex flex-col gap-4 border-b border-border sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-2xl">{editing ? "Edit hospital profile" : displayName}</CardTitle>
                    {!editing && profile.nabh_accredited ? (
                      <span
                        className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                        title="National Accreditation Board for Hospitals & Healthcare Providers"
                      >
                        NABH accredited
                      </span>
                    ) : null}
                  </div>
                  <CardDescription>
                    {editing
                      ? "Required fields are marked. Save applies changes for your organization."
                      : "Official listing and compliance fields for invoices and registrations."}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!editing ? (
                    <Button type="button" onClick={startEdit}>
                      Edit
                    </Button>
                  ) : (
                    <>
                      <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </Button>
                      <Button type="button" onClick={() => void save()} disabled={saving}>
                        {saving ? "Saving…" : "Save"}
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>

              {saveError ? (
                <CardContent className="border-b border-border pb-4 pt-0">
                  <p className="text-sm text-red-600" role="alert">
                    {saveError}
                  </p>
                </CardContent>
              ) : null}

              {!editing ? (
                <CardContent className="space-y-6 pt-6">
                  <dl className="grid gap-4 sm:grid-cols-2">
                    {readOnlyRows.map((row) => (
                      <div
                        key={row.label}
                        className={
                          row.label === "Hospital name" || row.label === "Address" || row.label === "Website"
                            ? "sm:col-span-2"
                            : ""
                        }
                      >
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</dt>
                        <dd
                          className={`mt-1 text-sm text-foreground ${row.mono ? "font-mono" : ""} ${typeof row.value === "string" ? "whitespace-pre-wrap" : ""}`}
                        >
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              ) : (
                <CardContent className="space-y-6 pt-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="hp-name">
                        Hospital name <span className="text-red-600">*</span>
                      </Label>
                      <Input
                        id="hp-name"
                        value={form.name}
                        onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                        className={fieldErrors.name ? "border-red-500" : ""}
                        autoComplete="organization"
                      />
                      {fieldErrors.name ? <p className="text-xs text-red-600">{fieldErrors.name}</p> : null}
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="hp-address">
                        Address <span className="text-red-600">*</span>
                      </Label>
                      <Textarea
                        id="hp-address"
                        rows={3}
                        value={form.address_line1}
                        onChange={(e) => setForm((f) => (f ? { ...f, address_line1: e.target.value } : f))}
                        className={fieldErrors.address_line1 ? "border-red-500" : ""}
                      />
                      {fieldErrors.address_line1 ? (
                        <p className="text-xs text-red-600">{fieldErrors.address_line1}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hp-phone">
                        Phone <span className="text-red-600">*</span>
                      </Label>
                      <Input
                        id="hp-phone"
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm((f) => (f ? { ...f, phone: e.target.value } : f))}
                        className={fieldErrors.phone ? "border-red-500" : ""}
                      />
                      {fieldErrors.phone ? <p className="text-xs text-red-600">{fieldErrors.phone}</p> : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hp-city">
                        City <span className="text-red-600">*</span>
                      </Label>
                      <Input
                        id="hp-city"
                        value={form.city}
                        onChange={(e) => setForm((f) => (f ? { ...f, city: e.target.value } : f))}
                        className={fieldErrors.city ? "border-red-500" : ""}
                      />
                      {fieldErrors.city ? <p className="text-xs text-red-600">{fieldErrors.city}</p> : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hp-state">
                        State <span className="text-red-600">*</span>
                      </Label>
                      <Input
                        id="hp-state"
                        value={form.state}
                        onChange={(e) => setForm((f) => (f ? { ...f, state: e.target.value } : f))}
                        className={fieldErrors.state ? "border-red-500" : ""}
                      />
                      {fieldErrors.state ? <p className="text-xs text-red-600">{fieldErrors.state}</p> : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hp-pincode">
                        Pincode <span className="text-red-600">*</span>
                      </Label>
                      <Input
                        id="hp-pincode"
                        value={form.pincode}
                        onChange={(e) => setForm((f) => (f ? { ...f, pincode: e.target.value } : f))}
                        className={fieldErrors.pincode ? "border-red-500" : ""}
                      />
                      {fieldErrors.pincode ? <p className="text-xs text-red-600">{fieldErrors.pincode}</p> : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hp-email">Email</Label>
                      <Input
                        id="hp-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hp-website">Website</Label>
                      <Input
                        id="hp-website"
                        type="url"
                        placeholder="https://"
                        value={form.website}
                        onChange={(e) => setForm((f) => (f ? { ...f, website: e.target.value } : f))}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="hp-hfr">HFR ID</Label>
                      <Input
                        id="hp-hfr"
                        className="font-mono text-sm"
                        value={form.hfr_id}
                        onChange={(e) => setForm((f) => (f ? { ...f, hfr_id: e.target.value } : f))}
                      />
                    </div>
                    <div className="flex items-start gap-3 sm:col-span-2">
                      <input
                        id="hp-nabh"
                        type="checkbox"
                        checked={form.nabh_accredited}
                        onChange={(e) => setForm((f) => (f ? { ...f, nabh_accredited: e.target.checked } : f))}
                        className="mt-1 h-4 w-4 rounded border-input text-blue-600 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                      />
                      <div className="space-y-1">
                        <Label htmlFor="hp-nabh" className="cursor-pointer font-medium text-foreground">
                          NABH accredited
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Enable to record certificate number and validity (optional fields).
                        </p>
                      </div>
                    </div>
                    {form.nabh_accredited ? (
                      <>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="hp-nabh-cert">NABH certificate #</Label>
                          <Input
                            id="hp-nabh-cert"
                            value={form.nabh_certificate_number}
                            onChange={(e) =>
                              setForm((f) => (f ? { ...f, nabh_certificate_number: e.target.value } : f))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="hp-nabh-until">Valid until</Label>
                          <Input
                            id="hp-nabh-until"
                            type="date"
                            value={form.nabh_valid_until}
                            onChange={(e) => setForm((f) => (f ? { ...f, nabh_valid_until: e.target.value } : f))}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
