"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ClinicalConfigurationNav from "@/components/admin/ClinicalConfigurationNav";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchAuthOrgId } from "@/app/lib/authOrg";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type TestRow = {
  id: string;
  test_name: string | null;
  category: string | null;
  is_in_house: boolean | null;
  external_lab_name: string | null;
};

export default function AdminTestsCataloguePage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async (hid: string) => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("test_catalogue")
      .select("id, test_name, category, is_in_house, external_lab_name")
      .eq("is_active", true)
      .or(`hospital_id.eq.${hid},hospital_id.is.null`)
      .order("test_name");
    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as TestRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void (async () => {
      const { orgId } = await fetchAuthOrgId();
      setHospitalId(orgId);
      if (orgId) await load(orgId);
      else setLoading(false);
    })();
  }, [load]);

  async function saveRow(id: string, patch: { is_in_house: boolean; external_lab_name: string | null }) {
    setSavingId(id);
    const { error: upErr } = await supabase.from("test_catalogue").update(patch).eq("id", id);
    setSavingId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    if (hospitalId) await load(hospitalId);
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <ClinicalConfigurationNav />
            <div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Test catalogue</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Mark tests as in-house or external reference labs. External tests can show a partner lab name.
              </p>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/admin">← Admin home</Link>
          </Button>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
        ) : null}

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Tests</CardTitle>
            <CardDescription>Scoped to your hospital and global catalogue rows.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto px-6 pb-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Test</th>
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3">Lab</th>
                    <th className="py-2">In-house / external</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <TestCatalogueEditRow key={r.id} row={r} saving={savingId === r.id} onSave={saveRow} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function TestCatalogueEditRow({
  row,
  saving,
  onSave,
}: {
  row: TestRow;
  saving: boolean;
  onSave: (id: string, patch: { is_in_house: boolean; external_lab_name: string | null }) => void;
}) {
  const [inHouse, setInHouse] = useState(row.is_in_house !== false);
  const [ext, setExt] = useState(row.external_lab_name ?? "");

  useEffect(() => {
    setInHouse(row.is_in_house !== false);
    setExt(row.external_lab_name ?? "");
  }, [row.id, row.is_in_house, row.external_lab_name]);

  return (
    <tr className="border-b border-border/60">
      <td className="py-2 pr-3 font-medium">{row.test_name ?? "—"}</td>
      <td className="py-2 pr-3 text-muted-foreground">{row.category ?? "—"}</td>
      <td className="py-2 pr-3">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
            inHouse ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700",
          )}
        >
          {inHouse ? "In-house" : "External"}
        </span>
      </td>
      <td className="py-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={inHouse}
              onChange={(e) => setInHouse(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span>Is in-house</span>
          </label>
          {!inHouse ? (
            <Input
              className="max-w-xs"
              placeholder="External lab name"
              value={ext}
              onChange={(e) => setExt(e.target.value)}
            />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() =>
              onSave(row.id, {
                is_in_house: inHouse,
                external_lab_name: inHouse ? null : ext.trim() || null,
              })
            }
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </td>
    </tr>
  );
}
