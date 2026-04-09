"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";

const TEMPLATE_TYPES = ["consultation", "follow_up", "procedure", "intake", "other"] as const;

type DeptOption = { id: string; name: string };

type DetailRow = {
  id: string;
  hospital_id: string;
  department_id: string;
  department_name: string;
  name: string;
  template_type: string;
  is_default: boolean;
  is_active: boolean;
  structure: Record<string, unknown>;
};

function parseDetail(r: Record<string, unknown>): DetailRow | null {
  if (r.id == null) return null;
  const raw = r.structure;
  let structure: Record<string, unknown> = {};
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    structure = raw as Record<string, unknown>;
  }
  return {
    id: String(r.id),
    hospital_id: String(r.hospital_id ?? ""),
    department_id: String(r.department_id ?? ""),
    department_name: String(r.department_name ?? "—"),
    name: String(r.name ?? ""),
    template_type: String(r.template_type ?? ""),
    is_default: Boolean(r.is_default),
    is_active: Boolean(r.is_active),
    structure,
  };
}

function templateTypeOptions(current: string | undefined): string[] {
  const u = new Set<string>(TEMPLATE_TYPES);
  if (current) u.add(current);
  return [...u];
}

export default function OpdTemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = typeof params?.id === "string" ? params.id.trim() : "";

  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [detail, setDetail] = useState<DetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [templateType, setTemplateType] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [structureText, setStructureText] = useState("{}");
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (hid: string, tid: string) => {
    setLoading(true);
    setError(null);
    const { data: depData, error: depErr } = await supabase.rpc("get_departments", { p_hospital_id: hid });
    if (!depErr && Array.isArray(depData)) {
      setDepartments(
        depData.map((d: Record<string, unknown>) => ({
          id: String(d.id),
          name: String(d.name ?? "—"),
        })),
      );
    }
    const { data, error: rpcErr } = await supabase.rpc("get_opd_template_detail", {
      p_template_id: tid,
    });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      setDetail(null);
      return;
    }
    const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    const row = list[0];
    const parsed = row ? parseDetail(row) : null;
    setDetail(parsed);
    if (parsed) {
      setName(parsed.name);
      setTemplateType(parsed.template_type);
      setDepartmentId(parsed.department_id);
      setStructureText(JSON.stringify(parsed.structure, null, 2));
      setIsDefault(parsed.is_default);
      setIsActive(parsed.is_active);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (!templateId) {
        setError("Missing template id.");
        setLoading(false);
        return;
      }
      const { hospitalId: hid, error: e } = await fetchHospitalIdFromPractitionerAuthId();
      const id = hid?.trim() || null;
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      if (!id) {
        setError("No hospital on your practitioner record.");
        setLoading(false);
        return;
      }
      setHospitalId(id);
      await load(id, templateId);
    })();
  }, [templateId, load]);

  const save = useCallback(async () => {
    if (!templateId || !detail) return;
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!departmentId) {
      setFormError("Select a department.");
      return;
    }
    let structure: Record<string, unknown>;
    try {
      const parsed = JSON.parse(structureText || "{}") as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setFormError("Structure must be a JSON object.");
        return;
      }
      structure = parsed as Record<string, unknown>;
    } catch {
      setFormError("Invalid JSON in structure.");
      return;
    }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc("update_opd_template", {
      p_template_id: templateId,
      p_name: name.trim(),
      p_template_type: templateType.trim(),
      p_department_id: departmentId,
      p_structure: structure,
      p_is_default: isDefault,
      p_is_active: isActive,
    });
    setSaving(false);
    if (rpcErr) {
      setFormError(rpcErr.message);
      return;
    }
    if (hospitalId) await load(hospitalId, templateId);
  }, [
    departmentId,
    detail,
    hospitalId,
    isActive,
    isDefault,
    load,
    name,
    structureText,
    templateId,
    templateType,
  ]);

  const remove = useCallback(async () => {
    if (!templateId || !detail) return;
    if (!window.confirm("Delete this template? This cannot be undone.")) return;
    setSaving(true);
    const { error: delErr } = await supabase.rpc("delete_opd_template", { p_template_id: templateId });
    setSaving(false);
    if (delErr) {
      setFormError(delErr.message);
      return;
    }
    router.push("/admin/dashboard/templates");
  }, [detail, router, templateId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
        <p className="text-sm text-red-600" role="alert">
          {error ?? "Template not found."}
        </p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/admin/dashboard/templates">← Templates</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Button variant="outline" asChild>
          <Link href="/admin/dashboard/templates">← Templates</Link>
        </Button>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Edit template</CardTitle>
            <CardDescription>
              {detail.department_name} · structure JSON loads only on this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {formError ? (
              <p className="text-sm text-red-600" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="ed-name">Name *</Label>
              <Input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-type">Type *</Label>
              <Select value={templateType} onValueChange={setTemplateType}>
                <SelectTrigger id="ed-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templateTypeOptions(detail.template_type).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-dept">Department *</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="ed-dept">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <input
                  id="ed-def"
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-blue-600 focus:ring-2 focus:ring-ring"
                />
                <Label htmlFor="ed-def" className="cursor-pointer">
                  Default for department
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="ed-act"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-blue-600 focus:ring-2 focus:ring-ring"
                />
                <Label htmlFor="ed-act" className="cursor-pointer">
                  Active
                </Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ed-json">Structure (JSON)</Label>
              <Textarea
                id="ed-json"
                rows={16}
                value={structureText}
                onChange={(e) => setStructureText(e.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" className="text-red-600" disabled={saving} onClick={() => void remove()}>
                Delete
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" asChild>
                  <Link href="/admin/dashboard/templates">Cancel</Link>
                </Button>
                <Button type="button" onClick={() => void save()} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
