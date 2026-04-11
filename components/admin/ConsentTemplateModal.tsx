"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/app/supabase";
import { consentCodeFromDisplayName } from "@/app/lib/ipdConsentTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "admission",
  "anaesthesia",
  "surgical",
  "blood_transfusion",
  "procedure",
  "financial",
  "dpdpa",
  "media",
  "research",
  "dnr",
  "other",
] as const;

const LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "both", label: "Both" },
];

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export type ConsentTemplateModalMode = "create" | "edit" | "customize";

export type ConsentTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hospitalId: string | null;
  mode: ConsentTemplateModalMode;
  /** System row when customizing; custom row when editing. */
  sourceRow: Record<string, unknown> | null;
  onSaved: () => void;
};

async function uploadConsentPdf(file: File, hospitalId: string, code: string): Promise<{ path: string; name: string }> {
  const safeCode = consentCodeFromDisplayName(code);
  const path = `${hospitalId}/${safeCode}.pdf`;
  const { error } = await supabase.storage.from("consent-templates").upload(path, file, {
    upsert: true,
    contentType: "application/pdf",
  });
  if (error) throw error;
  return { path, name: file.name };
}

export function ConsentTemplateModal({
  open,
  onOpenChange,
  hospitalId,
  mode,
  sourceRow,
  onSaved,
}: ConsentTemplateModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [isMandatory, setIsMandatory] = useState(false);
  const [templateLanguage, setTemplateLanguage] = useState("en");
  const [templateBody, setTemplateBody] = useState("");
  const [version, setVersion] = useState("1.0");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const codeTouchedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetFromSource = useCallback(() => {
    const row = asRec(sourceRow);
    codeTouchedRef.current = mode === "edit" || mode === "customize";
    if (!row) {
      setDisplayName("");
      setCode("");
      setCategory("other");
      setIsMandatory(false);
      setTemplateLanguage("en");
      setTemplateBody("");
      setVersion("1.0");
      setSortOrder(0);
      setIsActive(true);
      setFilePath(null);
      setFileName(null);
      setPendingFile(null);
      return;
    }
    setDisplayName(s(row.display_name));
    setCode(s(row.code));
    setCategory(CATEGORIES.includes(row.category as (typeof CATEGORIES)[number]) ? s(row.category) : "other");
    setIsMandatory(Boolean(row.is_mandatory));
    setTemplateLanguage(["en", "hi", "both"].includes(s(row.template_language)) ? s(row.template_language) : "en");
    setTemplateBody(s(row.template_body));
    setVersion(s(row.version) || "1.0");
    setSortOrder(Number(row.sort_order ?? 0));
    setIsActive(row.is_active !== false);
    setFilePath(row.file_path != null ? s(row.file_path) : null);
    setFileName(row.file_name != null ? s(row.file_name) : null);
    setPendingFile(null);
  }, [sourceRow, mode]);

  useEffect(() => {
    if (!open) return;
    resetFromSource();
    setError(null);
  }, [open, resetFromSource]);

  const close = () => {
    onOpenChange(false);
    setPendingFile(null);
    setError(null);
  };

  const title =
    mode === "create" ? "New consent template" : mode === "edit" ? "Edit consent template" : "Customise consent template";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hospitalId) {
      setError("No hospital selected.");
      return;
    }
    const dn = displayName.trim();
    const cd = code.trim();
    if (!dn || !cd) {
      setError("Consent name and code are required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? null;

      let nextPath = filePath;
      let nextFileName = fileName;
      if (pendingFile) {
        const up = await uploadConsentPdf(pendingFile, hospitalId, cd);
        nextPath = up.path;
        nextFileName = up.name;
      }

      const payload: Record<string, unknown> = {
        hospital_id: hospitalId,
        code: consentCodeFromDisplayName(cd),
        display_name: dn,
        category,
        is_mandatory: isMandatory,
        template_language: templateLanguage,
        template_body: templateBody.trim() || null,
        version: version.trim() || "1.0",
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        is_active: isActive,
        file_path: nextPath,
        file_name: nextFileName,
        updated_by: uid,
        updated_at: new Date().toISOString(),
      };

      if (mode === "edit" && sourceRow?.id) {
        const { error: upErr } = await supabase
          .from("ipd_consent_types")
          .update(payload)
          .eq("id", s(sourceRow.id))
          .eq("hospital_id", hospitalId);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase.from("ipd_consent_types").insert(payload);
        if (insErr) throw insErr;
      }

      onSaved();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const publicUrl =
    filePath && filePath.length > 0 ? supabase.storage.from("consent-templates").getPublicUrl(filePath).data.publicUrl : null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close dialog" onClick={() => close()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-template-modal-title"
        className={cn(
          "relative z-10 flex max-h-[min(92vh,800px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg",
        )}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3 sm:px-6">
          <h2 id="consent-template-modal-title" className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
            onClick={() => close()}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {error ? (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ct-display-name">Consent name *</Label>
              <Input
                id="ct-display-name"
                value={displayName}
                onChange={(e) => {
                  const v = e.target.value;
                  setDisplayName(v);
                  if (!codeTouchedRef.current && (mode === "create" || mode === "customize")) {
                    setCode(consentCodeFromDisplayName(v));
                  }
                }}
                onBlur={() => {
                  if (!code.trim() && displayName.trim()) {
                    setCode(consentCodeFromDisplayName(displayName));
                  }
                }}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-code">Code *</Label>
              <Input
                id="ct-code"
                value={code}
                onChange={(e) => {
                  codeTouchedRef.current = true;
                  setCode(e.target.value.toUpperCase().replace(/\s+/g, "_"));
                }}
                placeholder="e.g. OT_CONSENT_ORTHO"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ct-category">Category</Label>
                <select
                  id="ct-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-lang">Language</Label>
                <select
                  id="ct-lang"
                  value={templateLanguage}
                  onChange={(e) => setTemplateLanguage(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {LANGUAGES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={isMandatory}
                  onChange={(e) => setIsMandatory(e.target.checked)}
                />
                Mandatory for admission?
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
              </label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-body">Template body</Label>
              <Textarea
                id="ct-body"
                value={templateBody}
                onChange={(e) => setTemplateBody(e.target.value)}
                rows={8}
                placeholder="Paste or type the full consent text here. Use {patient_name}, {doctor_name}, {procedure_name} as placeholders."
                className="min-h-[160px] resize-y font-mono text-[13px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-pdf">PDF version</Label>
              <Input
                id="ct-pdf"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPendingFile(f ?? null);
                }}
                className="cursor-pointer"
              />
              {pendingFile ? (
                <p className="text-xs text-muted-foreground">Selected: {pendingFile.name} (uploads on save)</p>
              ) : null}
              {publicUrl && !pendingFile ? (
                <p className="text-sm">
                  <a href={publicUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-700">
                    Download current PDF
                  </a>
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ct-version">Version</Label>
                <Input id="ct-version" value={version} onChange={(e) => setVersion(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-sort">Display order</Label>
                <Input
                  id="ct-sort"
                  type="number"
                  value={Number.isFinite(sortOrder) ? sortOrder : 0}
                  onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !hospitalId}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
