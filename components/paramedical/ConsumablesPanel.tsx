"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

export type ConsumablesPanelProps = {
  wardId: string;
  /** Session hospital (RLS on inventory rows matches this via ward). */
  hospitalId: string;
  practitionerId: string;
  className?: string;
};

type InventoryRow = {
  ward_inventory_id: string;
  item_name: string;
  category: string;
  current_stock: number;
  minimum_stock: number;
  is_low_stock: boolean;
};

type WardPatientOption = {
  admission_id: string;
  patient_id: string;
  patient_name: string;
};

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function categoryBadgeClass(cat: string): string {
  const c = cat.trim().toLowerCase();
  if (c === "dressing" || c === "dressings")
    return "bg-violet-100 text-violet-900 ring-1 ring-violet-200 dark:bg-violet-950/80 dark:text-violet-100 dark:ring-violet-800";
  if (c === "iv" || c === "infusion")
    return "bg-sky-100 text-sky-900 ring-1 ring-sky-200 dark:bg-sky-950/80 dark:text-sky-100 dark:ring-sky-800";
  if (c === "ppe") return "bg-slate-100 text-slate-800 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600";
  return "bg-amber-50 text-amber-950 ring-1 ring-amber-200/80 dark:bg-amber-950/50 dark:text-amber-100 dark:ring-amber-800/80";
}

export function ConsumablesPanel({
  wardId,
  hospitalId,
  practitionerId: _practitionerId,
  className,
}: ConsumablesPanelProps) {
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [useForId, setUseForId] = useState<string | null>(null);
  const [useQty, setUseQty] = useState("1");
  const [useNotes, setUseNotes] = useState("");
  const [usePatientAdmissionId, setUsePatientAdmissionId] = useState("");
  const [useSubmitting, setUseSubmitting] = useState(false);

  const [wardPatients, setWardPatients] = useState<WardPatientOption[]>([]);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    const { data, error } = await supabase.rpc("get_ward_inventory", {
      p_ward_id: wardId,
    });
    setLoading(false);
    if (error) {
      setLoadErr(error.message);
      setInventory([]);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    setInventory(
      rows.map((r: Record<string, unknown>) => ({
        ward_inventory_id: s(r.ward_inventory_id),
        item_name: s(r.item_name),
        category: s(r.category) || "General",
        current_stock: num(r.current_stock),
        minimum_stock: num(r.minimum_stock),
        is_low_stock: Boolean(r.is_low_stock),
      })),
    );
  }, [wardId]);

  const loadWardPatients = useCallback(async () => {
    const { data, error } = await supabase
      .from("ipd_admissions")
      .select("id, patient_id, patients(full_name)")
      .eq("ward_id", wardId)
      .eq("status", "in-progress")
      .is("discharged_at", null);

    if (error) {
      toast.error(error.message);
      setWardPatients([]);
      return;
    }
    const list = Array.isArray(data) ? data : [];
    const opts: WardPatientOption[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const admId = s(o.id);
      const pid = s(o.patient_id);
      if (!admId || !pid) continue;
      const nested = o.patients as Record<string, unknown> | null | undefined;
      const pname =
        nested && typeof nested === "object"
          ? s(nested.full_name)
          : "Patient";
      opts.push({
        admission_id: admId,
        patient_id: pid,
        patient_name: pname || "Patient",
      });
    }
    opts.sort((a, b) => a.patient_name.localeCompare(b.patient_name));
    setWardPatients(opts);
  }, [wardId]);

  useEffect(() => {
    void loadInventory();
    void loadWardPatients();
  }, [loadInventory, loadWardPatients]);

  const activeUseRow = useMemo(
    () => inventory.find((r) => r.ward_inventory_id === useForId) ?? null,
    [inventory, useForId],
  );

  const maxUseQty = activeUseRow ? Math.floor(activeUseRow.current_stock) : 0;

  const openUseModal = (wardInventoryId: string) => {
    setUseForId(wardInventoryId);
    setUseQty("1");
    setUseNotes("");
    setUsePatientAdmissionId(wardPatients[0]?.admission_id ?? "");
  };

  const closeUseModal = () => {
    setUseForId(null);
  };

  const confirmUse = async () => {
    if (!useForId || !activeUseRow) return;
    const q = Number.parseInt(useQty, 10);
    if (!Number.isFinite(q) || q < 1) {
      toast.error("Enter a valid quantity");
      return;
    }
    if (q > maxUseQty) {
      toast.error("Insufficient stock");
      return;
    }
    const adm = wardPatients.find((p) => p.admission_id === usePatientAdmissionId);
    if (!adm) {
      toast.error("Select a patient");
      return;
    }
    setUseSubmitting(true);
    const { error } = await supabase.rpc("use_consumable", {
      p_ward_inventory_id: useForId,
      p_quantity: q,
      p_admission_id: adm.admission_id,
      p_patient_id: adm.patient_id,
      p_notes: useNotes.trim() || null,
    });
    setUseSubmitting(false);
    if (error) {
      const msg = error.message || "Could not record usage";
      if (/insufficient/i.test(msg)) {
        toast.error("Insufficient stock");
      } else {
        toast.error(msg);
      }
      return;
    }
    toast.success("Stock deducted. Charge auto-created.");
    closeUseModal();
    void loadInventory();
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-6",
        className,
      )}
      data-hospital-id={hospitalId}
    >
      <div className="mb-4 border-b border-border pb-3">
        <h2 className="text-base font-bold text-foreground">Consumables</h2>
        <p className="text-xs text-muted-foreground">
          Ward stock — use items against an admitted patient. Low stock is highlighted in red (NABH MOM.11).
        </p>
      </div>

      {loadErr ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadErr}
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold text-foreground">Ward inventory</h3>
        {loading ? (
          <div className="mt-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : inventory.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No consumable lines for this ward yet. Ask pharmacy / admin to seed{" "}
            <code className="rounded bg-muted px-1 text-xs">ward_inventory</code>.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {inventory.map((row) => (
              <li
                key={row.ward_inventory_id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between dark:bg-zinc-900/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{row.item_name}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                        categoryBadgeClass(row.category),
                      )}
                    >
                      {row.category}
                    </span>
                    {row.is_low_stock ? (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ring-1 ring-red-700/80 dark:bg-red-700">
                        Low stock
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    <span className="font-semibold text-foreground">{row.current_stock}</span>
                    {" / min "}
                    <span>{row.minimum_stock}</span>
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-primary/30 text-foreground hover:bg-muted"
                  onClick={() => openUseModal(row.ward_inventory_id)}
                >
                  + Use
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {useForId && activeUseRow ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal
          aria-labelledby="use-consumable-title"
          onClick={() => !useSubmitting && closeUseModal()}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-card p-4 text-card-foreground shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="use-consumable-title" className="text-base font-semibold text-foreground">
              Use {activeUseRow.item_name}
            </h4>
            <p className="text-xs text-muted-foreground">
              Stock available:{" "}
              <span className="font-semibold tabular-nums text-foreground">{maxUseQty}</span>
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <Label className="text-foreground">Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  max={maxUseQty}
                  className="mt-1 border-input bg-background text-foreground"
                  value={useQty}
                  onChange={(e) => setUseQty(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-foreground">Patient</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  value={usePatientAdmissionId}
                  onChange={(e) => setUsePatientAdmissionId(e.target.value)}
                >
                  {wardPatients.length === 0 ? (
                    <option value="">No admitted patients on this ward</option>
                  ) : (
                    wardPatients.map((p) => (
                      <option key={p.admission_id} value={p.admission_id}>
                        {p.patient_name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <Label className="text-foreground">Notes (optional)</Label>
                <Textarea
                  className="mt-1 border-input bg-background text-foreground"
                  rows={2}
                  value={useNotes}
                  onChange={(e) => setUseNotes(e.target.value)}
                  placeholder="e.g. dressing change post-op day 2"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={useSubmitting}
                onClick={closeUseModal}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={useSubmitting || wardPatients.length === 0}
                onClick={() => void confirmUse()}
              >
                {useSubmitting ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ConsumablesPanel;
