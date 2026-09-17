"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";

export type NursingProcedureLoggerProps = {
  hospitalId: string;
  patientId: string;
  admissionId: string;
  nursingTaskId?: string | null;
  className?: string;
  /** Called after a successful RPC log (e.g. refresh unbilled charges). */
  onLogged?: () => void;
};

type DefRow = {
  id: string;
  code: string;
  display_name: string;
  base_price: number;
};

type LogNursingProcedureResult = {
  success?: boolean;
  error?: string;
};

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NursingProcedureLogger({
  hospitalId,
  patientId: _patientId,
  admissionId,
  nursingTaskId: _nursingTaskId,
  className,
  onLogged,
}: NursingProcedureLoggerProps) {
  const [defs, setDefs] = useState<DefRow[]>([]);
  const [defsLoading, setDefsLoading] = useState(true);
  const [defsErr, setDefsErr] = useState<string | null>(null);

  const [selectedProcedureId, setSelectedProcedureId] = useState("");
  const [performedAtLocal, setPerformedAtLocal] = useState(() => toLocalDatetimeValue(new Date()));
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadDefs = useCallback(async () => {
    const hid = hospitalId.trim();
    if (!hid) {
      setDefs([]);
      setDefsLoading(false);
      return;
    }
    setDefsLoading(true);
    setDefsErr(null);
    const { data, error } = await supabase
      .from("charge_item_definitions")
      .select("id, code, display_name, base_price")
      .eq("hospital_id", hid)
      .eq("category", "procedure")
      .eq("status", "active")
      .order("display_name", { ascending: true });
    setDefsLoading(false);
    if (error) {
      setDefsErr(error.message);
      setDefs([]);
      return;
    }
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    setDefs(
      rows.map((r) => ({
        id: s(r.id),
        code: s(r.code),
        display_name: s(r.display_name),
        base_price: num(r.base_price),
      })),
    );
  }, [hospitalId]);

  useEffect(() => {
    void loadDefs();
  }, [loadDefs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProcedureId || !admissionId.trim()) return;
    setLoading(true);
    setSubmitError(null);
    const performedAt = new Date(performedAtLocal).toISOString();
    const { data, error } = await supabase.rpc("log_nursing_procedure", {
      p_admission_id: admissionId.trim(),
      p_charge_item_def_id: selectedProcedureId,
      p_performed_at: performedAt,
      p_notes: notes.trim() ? notes.trim() : null,
    });
    setLoading(false);

    const payload = data as LogNursingProcedureResult | null;
    if (error || !payload?.success) {
      const msg = payload?.error ?? error?.message ?? "Could not log procedure";
      setSubmitError(msg);
      return;
    }

    setSelectedProcedureId("");
    setNotes("");
    setPerformedAtLocal(toLocalDatetimeValue(new Date()));
    toast.success("Procedure logged.");
    onLogged?.();
  };

  const procedurePlaceholder = defsLoading
    ? "Loading procedures…"
    : defs.length === 0
      ? "No procedures configured"
      : "Select a billable procedure";

  const selectDisabled = defsLoading || defs.length === 0;

  const canSubmit =
    Boolean(hospitalId.trim() && admissionId.trim() && selectedProcedureId) && !loading && !defsLoading;

  return (
    <section
      className={cn(
        "light-form-surface rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm md:p-5 dark:border-slate-200",
        className,
      )}
    >
      <h3 className="text-base font-semibold text-slate-900">Log nursing procedure</h3>
      <p className="mt-1 text-xs text-slate-600">
        Selecting a billable procedure records it and creates an unbilled charge for this admission.
      </p>

      {defsErr ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {defsErr}
        </p>
      ) : null}

      {submitError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {submitError}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="npl-procedure" className="text-slate-800">
            Billable procedure
          </Label>
          <Select
            value={selectedProcedureId || undefined}
            onValueChange={setSelectedProcedureId}
            disabled={selectDisabled}
          >
            <SelectTrigger id="npl-procedure" className="h-10 bg-white text-slate-900 border-slate-300">
              <SelectValue placeholder={procedurePlaceholder} />
            </SelectTrigger>
            <SelectContent className="bg-white text-slate-900 border-slate-200">
              {defs.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="npl-at" className="text-slate-800">
            Performed at
          </Label>
          <Input
            id="npl-at"
            type="datetime-local"
            value={performedAtLocal}
            onChange={(e) => setPerformedAtLocal(e.target.value)}
            className="h-10 border-slate-300 bg-white text-slate-900"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="npl-notes" className="text-slate-800">
            Notes
          </Label>
          <Textarea
            id="npl-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional clinical notes"
            className="min-h-[88px] border-slate-300 bg-white text-slate-900 placeholder:text-slate-500"
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={!canSubmit}>
            {loading ? "Saving…" : "Log procedure"}
          </Button>
        </div>
      </form>
    </section>
  );
}
