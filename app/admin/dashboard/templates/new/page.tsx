"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { supabase } from "@/app/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TEMPLATE_TYPES = ["consultation", "follow_up", "procedure", "intake", "other"] as const;

type DeptOption = { id: string; name: string };

export default function NewOpdTemplatePage() {
  const router = useRouter();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [templateType, setTemplateType] = useState<string>("consultation");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [structureText, setStructureText] = useState("{}");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid, error: e } = await fetchHospitalIdFromPractitionerAuthId();
      const id = hid?.trim() || null;
      if (e) {
        setError(e.message);
        setLoadingMeta(false);
        return;
      }
      if (!id) {
        setError("No hospital on your practitioner record.");
        setLoadingMeta(false);
        return;
      }
      setHospitalId(id);
      const { data, error: depErr } = await supabase.rpc("get_departments", { p_hospital_id: id });
      if (depErr) {
        setError(depErr.message);
        setLoadingMeta(false);
        return;
      }
      const list = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
      const opts = list.map((d) => ({ id: String(d.id), name: String(d.name ?? "—") }));
      setDepartments(opts);
      if (opts.length > 0) setDepartmentId(opts[0].id);
      setLoadingMeta(false);
    })();
  }, []);

  const submit = useCallback(async () => {
    if (!hospitalId) return;
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!departmentId) {
      setFormError("Select a department.");
      return;
    }
    let structure: Record<string, unknown> = {};
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
    const { data, error: rpcErr } = await supabase.rpc("create_opd_template", {
      p_hospital_id: hospitalId,
      p_department_id: departmentId,
      p_name: name.trim(),
      p_template_type: templateType.trim(),
      p_structure: structure,
      p_is_default: isDefault,
    });
    setSaving(false);
    if (rpcErr) {
      setFormError(rpcErr.message);
      return;
    }
    const newId = data != null ? String(data) : "";
    if (newId) {
      router.push(`/admin/dashboard/templates/${newId}`);
    } else {
      setFormError("Created but no id returned.");
    }
  }, [departmentId, hospitalId, isDefault, name, router, structureText, templateType]);

  if (loadingMeta) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error && !hospitalId) {
    return (
      <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/admin/dashboard/templates">← Back</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <Button variant="outline" asChild>
          <Link href="/admin/dashboard/templates">← Templates</Link>
        </Button>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl">Create OPD template</CardTitle>
            <CardDescription>Structure stays on this hospital; you can refine it on the detail page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {formError ? (
              <p className="text-sm text-red-600" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="nt-name">Name *</Label>
              <Input id="nt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SOAP — general" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nt-type">Type *</Label>
              <Select value={templateType} onValueChange={setTemplateType}>
                <SelectTrigger id="nt-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nt-dept">Department *</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="nt-dept">
                  <SelectValue placeholder="Select department" />
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
            <div className="flex items-start gap-3">
              <input
                id="nt-def"
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input text-blue-600 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              />
              <div>
                <Label htmlFor="nt-def" className="cursor-pointer">
                  Default template for this department
                </Label>
                <p className="text-xs text-muted-foreground">Clears other defaults in the same department.</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nt-json">Structure (JSON object)</Label>
              <Textarea
                id="nt-json"
                rows={10}
                value={structureText}
                onChange={(e) => setStructureText(e.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/admin/dashboard/templates">Cancel</Link>
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={saving || departments.length === 0}>
                {saving ? "Creating…" : "Create"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
