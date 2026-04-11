"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List as VirtualList } from "react-window";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ClinicalConfigurationNav from "@/components/admin/ClinicalConfigurationNav";
import {
  OpdTemplateTableRowInner,
  OpdTemplateVirtualRow,
  OPD_TEMPLATE_LIST_GRID,
  type OpdTemplateListRow,
  type OpdTemplateRowHandlers,
  type VirtualRowData,
} from "./OpdTemplateTableRow";

const ROW_HEIGHT = 56;
const VIRTUAL_THRESHOLD = 50;
const DEBOUNCE_MS = 300;

function parseTemplateRow(r: Record<string, unknown>): OpdTemplateListRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    template_type: String(r.template_type ?? ""),
    department_id: String(r.department_id ?? ""),
    department_name: String(r.department_name ?? "—"),
    is_default: Boolean(r.is_default),
    is_active: Boolean(r.is_active),
  };
}

type DeptOption = { id: string; name: string };

export default function OpdTemplatesListPage() {
  const router = useRouter();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(960);

  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [rows, setRows] = useState<OpdTemplateListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const debouncedDepartment = useDebouncedValue(departmentFilter, DEBOUNCE_MS);
  const debouncedSearch = useDebouncedValue(searchInput, DEBOUNCE_MS);

  const loadDepartments = useCallback(async (hid: string) => {
    const { data, error: rpcErr } = await supabase.rpc("get_departments", { p_hospital_id: hid });
    if (rpcErr) return;
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setDepartments(
      list.map((d) => ({
        id: String(d.id),
        name: String(d.name ?? "—"),
      })),
    );
  }, []);

  const loadTemplates = useCallback(async (hid: string, deptKey: string, nameSearch: string) => {
    setLoading(true);
    setError(null);
    const p_department_id = deptKey === "all" ? null : deptKey;
    const q = nameSearch.trim();
    const { data, error: rpcErr } = await supabase.rpc("get_opd_templates", {
      p_hospital_id: hid,
      p_department_id,
      p_name_search: q.length > 0 ? q : null,
    });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setRows([]);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setRows(list.map(parseTemplateRow));
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
      await loadDepartments(id);
    })();
  }, [loadDepartments]);

  useEffect(() => {
    if (!hospitalId) return;
    void loadTemplates(hospitalId, debouncedDepartment, debouncedSearch);
  }, [hospitalId, debouncedDepartment, debouncedSearch, loadTemplates]);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setListWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setListWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, [rows.length, loading]);

  const handleRowClick = useCallback(
    (id: string) => {
      router.push(`/admin/dashboard/templates/${id}`);
    },
    [router],
  );

  const handleToggleActive = useCallback(
    async (id: string, next: boolean) => {
      if (!hospitalId) return;
      setBusyId(id);
      const { error: rpcErr } = await supabase.rpc("patch_opd_template_flags", {
        p_template_id: id,
        p_is_active: next,
      });
      setBusyId(null);
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      await loadTemplates(hospitalId, debouncedDepartment, debouncedSearch);
    },
    [hospitalId, debouncedDepartment, debouncedSearch, loadTemplates],
  );

  const handleToggleDefault = useCallback(
    async (id: string, next: boolean) => {
      if (!hospitalId) return;
      setBusyId(id);
      const { error: rpcErr } = await supabase.rpc("patch_opd_template_flags", {
        p_template_id: id,
        p_is_default: next,
      });
      setBusyId(null);
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      await loadTemplates(hospitalId, debouncedDepartment, debouncedSearch);
    },
    [hospitalId, debouncedDepartment, debouncedSearch, loadTemplates],
  );

  const handlers = useMemo<OpdTemplateRowHandlers>(
    () => ({
      busyId,
      onRowClick: handleRowClick,
      onToggleActive: handleToggleActive,
      onToggleDefault: handleToggleDefault,
    }),
    [busyId, handleRowClick, handleToggleActive, handleToggleDefault],
  );

  const virtualData = useMemo<VirtualRowData>(() => ({ rows, handlers }), [rows, handlers]);

  const useVirtual = rows.length > VIRTUAL_THRESHOLD;
  const listHeight = Math.min(560, Math.max(rows.length, 1) * ROW_HEIGHT);

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Administration</p>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clinical configuration</p>
              <ClinicalConfigurationNav />
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">OPD templates</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Note structures load only on the detail page. Search and filters are debounced ({DEBOUNCE_MS}ms).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin">← Admin home</Link>
            </Button>
            <Button asChild>
              <Link href="/admin/dashboard/templates/new">Create template</Link>
            </Button>
          </div>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader className="space-y-4 border-b border-border pb-4">
            <div>
              <CardTitle className="text-lg">Templates</CardTitle>
              <CardDescription>Name, type, and department — without heavy JSON payloads.</CardDescription>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="space-y-2 sm:min-w-[200px]">
                <Label htmlFor="tpl-dept">Department</Label>
                <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                  <SelectTrigger id="tpl-dept">
                    <SelectValue placeholder="All departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-[min(100%,16rem)] flex-1 space-y-2">
                <Label htmlFor="tpl-search">Search name</Label>
                <Input
                  id="tpl-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Filter by template name…"
                  autoComplete="off"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <p className="px-6 py-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            {loading ? (
              <div className="flex flex-col items-center gap-3 p-12">
                <div
                  className="h-9 w-9 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">Loading templates…</p>
              </div>
            ) : rows.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                No templates match your filters. Create one to get started.
              </p>
            ) : (
              <div ref={listContainerRef} className="overflow-x-auto">
                <div
                  className={`${OPD_TEMPLATE_LIST_GRID} border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}
                  role="rowgroup"
                >
                  <div role="columnheader">Name</div>
                  <div role="columnheader">Type</div>
                  <div role="columnheader">Department</div>
                  <div role="columnheader">Default</div>
                  <div role="columnheader">Status</div>
                  <div role="columnheader" className="text-right">
                    Actions
                  </div>
                </div>
                {useVirtual ? (
                  <VirtualList
                    rowCount={rows.length}
                    rowHeight={ROW_HEIGHT}
                    rowComponent={OpdTemplateVirtualRow}
                    rowProps={virtualData}
                    overscanCount={8}
                    style={{ height: listHeight, width: listWidth }}
                  />
                ) : (
                  <div role="rowgroup">
                    {rows.map((row) => (
                      <OpdTemplateTableRowInner key={row.id} row={row} handlers={handlers} />
                    ))}
                  </div>
                )}
                {rows.length > VIRTUAL_THRESHOLD ? (
                  <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    Showing {rows.length} templates (virtualized list)
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
