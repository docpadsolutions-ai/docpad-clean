"use client";

import Link from "next/link";
import { Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import ClinicalConfigurationNav from "@/components/admin/ClinicalConfigurationNav";
import { ConsentTemplateModal, type ConsentTemplateModalMode } from "@/components/admin/ConsentTemplateModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

type Row = Record<string, unknown>;

function MandatoryBadge({ mandatory }: { mandatory: boolean }) {
  if (mandatory) {
    return (
      <span className="inline-flex rounded-full bg-red-600/15 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300">
        Mandatory
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      Optional
    </span>
  );
}

function ConsentTableRow({
  row,
  muted,
  actions,
}: {
  row: Row;
  muted?: boolean;
  actions: React.ReactNode;
}) {
  const fp = row.file_path != null && s(row.file_path) !== "";
  return (
    <tr className={cn("border-b border-border", muted && "bg-muted/50")}>
      <td className={cn("px-3 py-2.5 font-medium", muted ? "text-muted-foreground" : "text-foreground")}>{s(row.display_name)}</td>
      <td className="px-3 py-2.5 capitalize text-muted-foreground">{s(row.category).replace(/_/g, " ") || "—"}</td>
      <td className="px-3 py-2.5">
        <MandatoryBadge mandatory={Boolean(row.is_mandatory)} />
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          {s(row.version) || "—"}
          {fp ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Has PDF" /> : null}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">{actions}</td>
    </tr>
  );
}

export default function ConsentTemplatesPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [systemRows, setSystemRows] = useState<Row[]>([]);
  const [customRows, setCustomRows] = useState<Row[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ConsentTemplateModalMode>("create");
  const [modalSource, setModalSource] = useState<Row | null>(null);

  const load = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const [sysRes, custRes] = await Promise.all([
      supabase.from("ipd_consent_types").select("*").is("hospital_id", null).order("sort_order"),
      supabase.from("ipd_consent_types").select("*").eq("hospital_id", hid).order("sort_order"),
    ]);
    setLoading(false);
    if (sysRes.error) {
      setError(sysRes.error.message);
      setSystemRows([]);
      setCustomRows([]);
      return;
    }
    if (custRes.error) {
      setError(custRes.error.message);
      setSystemRows([]);
      setCustomRows([]);
      return;
    }
    setSystemRows((sysRes.data ?? []) as Row[]);
    setCustomRows((custRes.data ?? []) as Row[]);
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
      await load(id);
    })();
  }, [load]);

  const openCreate = () => {
    setModalMode("create");
    setModalSource(null);
    setModalOpen(true);
  };

  const openCustomize = (row: Row) => {
    setModalMode("customize");
    setModalSource(row);
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setModalMode("edit");
    setModalSource(row);
    setModalOpen(true);
  };

  const handleToggleActive = async (row: Row) => {
    if (!hospitalId || !row.id) return;
    const next = !(row.is_active !== false);
    setBusyId(s(row.id));
    const { error: upErr } = await supabase
      .from("ipd_consent_types")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", s(row.id))
      .eq("hospital_id", hospitalId);
    setBusyId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await load(hospitalId);
  };

  const handleDelete = async (row: Row) => {
    if (!hospitalId || !row.id) return;
    if (!globalThis.confirm(`Delete consent template “${s(row.display_name)}”? This cannot be undone.`)) return;
    setBusyId(s(row.id));
    const { error: delErr } = await supabase.from("ipd_consent_types").delete().eq("id", s(row.id)).eq("hospital_id", hospitalId);
    setBusyId(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await load(hospitalId);
  };

  const tableShell = useMemo(
    () => (
      <thead className="border-b border-border bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="px-3 py-2">Consent name</th>
          <th className="px-3 py-2">Category</th>
          <th className="px-3 py-2">Mandatory</th>
          <th className="px-3 py-2">Version</th>
          <th className="px-3 py-2 text-right">Actions</th>
        </tr>
      </thead>
    ),
    [],
  );

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clinical configuration</p>
              <ClinicalConfigurationNav />
            </div>
            <div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Consent Template Library</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Manage consent forms used across IPD admissions. System defaults apply to all hospitals. Upload custom versions
                to override with your hospital&apos;s own forms.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin">← Admin home</Link>
            </Button>
            <Button type="button" onClick={() => openCreate()} disabled={!hospitalId}>
              + New consent
            </Button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">System defaults</CardTitle>
            <CardDescription>Read-only catalog shared by all hospitals. Use Customise to create a hospital copy.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  {tableShell}
                  <tbody>
                    {systemRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">
                          No system consent types found. Add rows via database migration or admin seed.
                        </td>
                      </tr>
                    ) : (
                      systemRows.map((row) => (
                        <ConsentTableRow
                          key={s(row.id)}
                          row={row}
                          muted
                          actions={
                            <Button type="button" variant="outline" size="sm" onClick={() => openCustomize(row)} disabled={!hospitalId}>
                              Customise →
                            </Button>
                          }
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Hospital custom consents</CardTitle>
            <CardDescription>Overrides and additional forms for your organisation only.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!loading && customRows.length === 0 ? (
              <p className="border-t border-border px-6 py-10 text-center text-sm text-muted-foreground">
                No custom consents yet. Customise a system default above or create a new one from scratch.
              </p>
            ) : null}
            {!loading && customRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  {tableShell}
                  <tbody>
                    {customRows.map((row) => {
                      const id = s(row.id);
                      const busy = busyId === id;
                      return (
                        <ConsentTableRow
                          key={id}
                          row={row}
                          actions={
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)} disabled={busy}>
                                Edit
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => void handleDelete(row)} disabled={busy}>
                                Delete
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleToggleActive(row)}
                                disabled={busy}
                              >
                                {busy ? "…" : row.is_active === false ? "Activate" : "Deactivate"}
                              </Button>
                            </div>
                          }
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ConsentTemplateModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        hospitalId={hospitalId}
        mode={modalMode}
        sourceRow={modalSource}
        onSaved={() => {
          if (hospitalId) void load(hospitalId);
        }}
      />
    </div>
  );
}
