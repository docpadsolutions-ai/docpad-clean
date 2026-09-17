"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchAuthOrgId } from "../../app/lib/authOrg";
import { practitionersOrFilterForAuthUid } from "../../app/lib/practitionerAuthLookup";
import { supabase } from "../../lib/supabaseClient";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type WardRow = {
  id: string;
  name: string;
  ward_type: string | null;
};

type InventoryRow = {
  ward_inventory_id: string;
  item_name: string;
  category: string;
  current_stock: number;
  minimum_stock: number;
  is_low_stock: boolean;
  last_restocked_at: string | null;
  last_restocked_by_name: string | null;
  unit_of_measure: string | null;
  unit_cost: number;
  charge_item_def_id: string | null;
  is_billable: boolean;
};

type DefOption = {
  id: string;
  display_name: string;
  category: string;
  code: string;
};

type RestockLogRow = {
  id: string;
  quantity_added: number;
  source_note: string | null;
  restocked_at: string;
  restocked_by: string | null;
  by_name: string | null;
};

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function bool(v: unknown): boolean {
  return Boolean(v);
}

export function WardInventoryManager() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);

  const [wards, setWards] = useState<WardRow[]>([]);
  const [wardId, setWardId] = useState<string>("");

  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [defs, setDefs] = useState<DefOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [invErr, setInvErr] = useState<string | null>(null);

  /** Pending inline edits keyed by ward_inventory_id */
  const [edits, setEdits] = useState<
    Record<
      string,
      {
        unit_of_measure: string;
        unit_cost: string;
        minimum_stock: string;
        charge_item_def_id: string;
        is_billable: boolean;
      }
    >
  >({});

  const [restock, setRestock] = useState<Record<string, { qty: string; note: string }>>({});
  const [restockBusy, setRestockBusy] = useState<string | null>(null);

  const [historyByItem, setHistoryByItem] = useState<Record<string, RestockLogRow[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({
    item_name: "",
    category: "",
    unit_of_measure: "",
    minimum_stock: "0",
    unit_cost: "0",
    is_billable: true,
    charge_item_def_id: "",
  });

  const loadSession = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id;
    if (!uid) {
      setPractitionerId(null);
      setHospitalId(null);
      return;
    }
    const { data: pr } = await supabase
      .from("practitioners")
      .select("id, hospital_id")
      .or(practitionersOrFilterForAuthUid(uid))
      .maybeSingle();
    setPractitionerId(pr?.id != null ? s(pr.id) : null);

    const { orgId } = await fetchAuthOrgId();
    const fromRpc = orgId?.trim() || null;
    const fromPr = pr && typeof pr === "object" && "hospital_id" in pr ? s((pr as { hospital_id?: unknown }).hospital_id) : "";
    setHospitalId(fromRpc || fromPr || null);
  }, []);

  const loadWards = useCallback(async (hid: string) => {
    const { data, error } = await supabase
      .from("ipd_wards")
      .select("id, name, ward_type")
      .eq("hospital_id", hid)
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) {
      toast.error(error.message);
      setWards([]);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    setWards(
      rows.map((r: Record<string, unknown>) => ({
        id: s(r.id),
        name: s(r.name) || "—",
        ward_type: r.ward_type != null ? s(r.ward_type) : null,
      })),
    );
  }, []);

  const loadDefs = useCallback(async (hid: string) => {
    const { data, error } = await supabase
      .from("charge_item_definitions")
      .select("id, display_name, category, code")
      .eq("hospital_id", hid)
      .eq("status", "active")
      .in("category", ["consumable", "medication", "equipment"])
      .order("display_name", { ascending: true });
    if (error) {
      toast.error(error.message);
      setDefs([]);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    setDefs(
      rows.map((r: Record<string, unknown>) => ({
        id: s(r.id),
        display_name: s(r.display_name),
        category: s(r.category),
        code: s(r.code),
      })),
    );
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!hospitalId) return;
    void loadWards(hospitalId);
    void loadDefs(hospitalId);
  }, [hospitalId, loadWards, loadDefs]);

  const loadInventory = useCallback(async (wid: string) => {
    if (!wid.trim()) {
      setInventory([]);
      return;
    }
    setLoading(true);
    setInvErr(null);
    const { data, error } = await supabase.rpc("get_ward_inventory", { p_ward_id: wid });
    setLoading(false);
    if (error) {
      setInvErr(error.message);
      setInventory([]);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    const mapped: InventoryRow[] = rows.map((r: Record<string, unknown>) => ({
      ward_inventory_id: s(r.ward_inventory_id),
      item_name: s(r.item_name),
      category: s(r.category) || "General",
      current_stock: num(r.current_stock),
      minimum_stock: num(r.minimum_stock),
      is_low_stock: bool(r.is_low_stock),
      last_restocked_at: r.last_restocked_at != null ? String(r.last_restocked_at) : null,
      last_restocked_by_name: r.last_restocked_by_name != null ? String(r.last_restocked_by_name) : null,
      unit_of_measure: r.unit_of_measure != null ? s(r.unit_of_measure) : null,
      unit_cost: num(r.unit_cost),
      charge_item_def_id: r.charge_item_def_id != null ? s(r.charge_item_def_id) : null,
      is_billable: r.is_billable !== undefined ? bool(r.is_billable) : true,
    }));
    setInventory(mapped);
    const nextEdits: typeof edits = {};
    for (const row of mapped) {
      nextEdits[row.ward_inventory_id] = {
        unit_of_measure: row.unit_of_measure ?? "",
        unit_cost: String(row.unit_cost),
        minimum_stock: String(row.minimum_stock),
        charge_item_def_id: row.charge_item_def_id ?? "",
        is_billable: row.is_billable,
      };
    }
    setEdits(nextEdits);
    setRestock({});
    setHistoryByItem({});
  }, []);

  useEffect(() => {
    if (wardId) void loadInventory(wardId);
  }, [wardId, loadInventory]);

  const selectedWard = useMemo(() => wards.find((w) => w.id === wardId) ?? null, [wards, wardId]);

  const loadHistory = useCallback(
    async (wardInventoryId: string) => {
      setHistoryLoading(wardInventoryId);
      const { data, error } = await supabase
        .from("ward_stock_restock_log")
        .select("id, quantity_added, source_note, restocked_at, restocked_by")
        .eq("ward_inventory_id", wardInventoryId)
        .order("restocked_at", { ascending: false })
        .limit(20);
      setHistoryLoading(null);
      if (error) {
        toast.error(error.message);
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      const byIds = [
        ...new Set(
          rows
            .map((r: Record<string, unknown>) => r.restocked_by)
            .filter((x): x is string => x != null && s(x) !== ""),
        ),
      ];
      let nameMap = new Map<string, string>();
      if (byIds.length > 0) {
        const { data: prs } = await supabase.from("practitioners").select("id, full_name").in("id", byIds);
        if (Array.isArray(prs)) {
          nameMap = new Map(
            prs.map((p: Record<string, unknown>) => [s(p.id), s(p.full_name) || "—"] as const),
          );
        }
      }
      const mapped: RestockLogRow[] = rows.map((r: Record<string, unknown>) => {
        const rid = s(r.restocked_by);
        return {
          id: s(r.id),
          quantity_added: num(r.quantity_added),
          source_note: r.source_note != null ? String(r.source_note) : null,
          restocked_at: r.restocked_at != null ? String(r.restocked_at) : "",
          restocked_by: rid || null,
          by_name: rid ? nameMap.get(rid) ?? null : null,
        };
      });
      setHistoryByItem((prev) => ({ ...prev, [wardInventoryId]: mapped }));
    },
    [],
  );

  const saveRow = async (rowId: string) => {
    const e = edits[rowId];
    if (!e) return;
    const min = Number.parseFloat(e.minimum_stock);
    const cost = Number.parseFloat(e.unit_cost);
    if (!Number.isFinite(min) || min < 0) {
      toast.error("Minimum stock must be a valid non-negative number");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Unit cost must be a valid non-negative number");
      return;
    }
    const { error } = await supabase
      .from("ward_inventory")
      .update({
        unit_of_measure: e.unit_of_measure.trim() ? e.unit_of_measure.trim() : null,
        unit_cost: cost,
        minimum_stock: min,
        charge_item_def_id: e.charge_item_def_id.trim() ? e.charge_item_def_id.trim() : null,
        is_billable: e.is_billable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Inventory row updated");
    if (wardId) void loadInventory(wardId);
  };

  const submitRestock = async (row: InventoryRow) => {
    if (!practitionerId) {
      toast.error("Practitioner session not found");
      return;
    }
    const st = restock[row.ward_inventory_id] ?? { qty: "", note: "" };
    const q = Number.parseFloat(st.qty);
    if (!Number.isFinite(q) || q <= 0) {
      toast.error("Enter a positive restock quantity");
      return;
    }
    setRestockBusy(row.ward_inventory_id);
    const { error } = await supabase.rpc("restock_ward_item", {
      p_ward_inventory_id: row.ward_inventory_id,
      p_add_quantity: q,
      p_practitioner_id: practitionerId,
      p_source_note: st.note.trim() ? st.note.trim() : null,
    });
    setRestockBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Stock restocked");
    setRestock((prev) => ({ ...prev, [row.ward_inventory_id]: { qty: "", note: "" } }));
    if (wardId) void loadInventory(wardId);
  };

  const submitAddItem = async () => {
    if (!hospitalId || !wardId.trim()) {
      toast.error("Select a ward first");
      return;
    }
    const name = addForm.item_name.trim();
    if (!name) {
      toast.error("Item name is required");
      return;
    }
    const min = Number.parseFloat(addForm.minimum_stock);
    const cost = Number.parseFloat(addForm.unit_cost);
    if (!Number.isFinite(min) || min < 0) {
      toast.error("Minimum stock invalid");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Unit cost invalid");
      return;
    }
    setAddSubmitting(true);
    const { error } = await supabase.from("ward_inventory").insert({
      ward_id: wardId.trim(),
      hospital_id: hospitalId,
      item_name: name,
      category: addForm.category.trim() ? addForm.category.trim() : null,
      unit_of_measure: addForm.unit_of_measure.trim() ? addForm.unit_of_measure.trim() : null,
      minimum_stock: min,
      unit_cost: cost,
      current_stock: 0,
      is_billable: addForm.is_billable,
      charge_item_def_id: addForm.charge_item_def_id.trim() ? addForm.charge_item_def_id.trim() : null,
    });
    setAddSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Item added");
    setAddOpen(false);
    setAddForm({
      item_name: "",
      category: "",
      unit_of_measure: "",
      minimum_stock: "0",
      unit_cost: "0",
      is_billable: true,
      charge_item_def_id: "",
    });
    void loadInventory(wardId);
  };

  if (!hospitalId) {
    return (
      <div className="light-form-surface rounded-xl border border-slate-200 p-6 text-sm text-slate-600 shadow-sm">
        Loading hospital context…
      </div>
    );
  }

  return (
    <div className="light-form-surface space-y-6 rounded-xl border border-slate-200 p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Label className="text-slate-800">Ward</Label>
          <select
            className="h-10 min-w-[240px] rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35"
            value={wardId}
            onChange={(e) => setWardId(e.target.value)}
          >
            <option value="">Select ward…</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.ward_type ? ` (${w.ward_type})` : ""}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" disabled={!wardId} onClick={() => setAddOpen(true)}>
          Add item
        </Button>
      </div>

      {selectedWard ? (
        <p className="text-xs text-slate-600">
          Managing inventory for <span className="font-medium text-slate-900">{selectedWard.name}</span>
        </p>
      ) : null}

      {invErr ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {invErr}
        </div>
      ) : null}

      {!wardId ? (
        <p className="text-sm text-slate-600">Choose a ward to load inventory.</p>
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-slate-200/80" />
          ))}
        </div>
      ) : inventory.length === 0 ? (
        <p className="text-sm text-slate-600">No line items for this ward yet.</p>
      ) : (
        <div className="space-y-8">
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-2">Item name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Current</th>
                  <th className="px-3 py-2">Min stock</th>
                  <th className="px-3 py-2">Unit cost</th>
                  <th className="px-3 py-2">Billable</th>
                  <th className="px-3 py-2">Charge def</th>
                  <th className="px-3 py-2">Low</th>
                  <th className="px-3 py-2 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((row) => {
                  const e = edits[row.ward_inventory_id];
                  return (
                    <tr
                      key={row.ward_inventory_id}
                      className={cn(
                        "border-b border-slate-200",
                        row.is_low_stock
                          ? "bg-red-50/90"
                          : "odd:bg-white even:bg-slate-50/90",
                      )}
                    >
                      <td className="px-3 py-2 font-medium text-slate-900">{row.item_name}</td>
                      <td className="px-3 py-2 text-slate-600">{row.category}</td>
                      <td className="px-3 py-2">
                        <Input
                          className="h-8 w-20 border-slate-300 bg-white text-xs text-slate-900"
                          value={e?.unit_of_measure ?? ""}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.ward_inventory_id]: {
                                ...prev[row.ward_inventory_id]!,
                                unit_of_measure: ev.target.value,
                              },
                            }))
                          }
                          placeholder="—"
                        />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-900">{row.current_stock}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          className="h-8 w-24 border-slate-300 bg-white text-xs tabular-nums text-slate-900"
                          value={e?.minimum_stock ?? ""}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.ward_inventory_id]: {
                                ...prev[row.ward_inventory_id]!,
                                minimum_stock: ev.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          className="h-8 w-24 border-slate-300 bg-white text-xs tabular-nums text-slate-900"
                          value={e?.unit_cost ?? ""}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.ward_inventory_id]: {
                                ...prev[row.ward_inventory_id]!,
                                unit_cost: ev.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={e?.is_billable ?? true}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.ward_inventory_id]: {
                                ...prev[row.ward_inventory_id]!,
                                is_billable: ev.target.checked,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="max-w-[200px] px-3 py-2">
                        <select
                          className="w-full max-w-[200px] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                          value={e?.charge_item_def_id ?? ""}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [row.ward_inventory_id]: {
                                ...prev[row.ward_inventory_id]!,
                                charge_item_def_id: ev.target.value,
                              },
                            }))
                          }
                        >
                          <option value="">—</option>
                          {defs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.display_name} ({d.category})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {row.is_low_stock ? (
                          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                            Low
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button type="button" size="sm" className="h-8" onClick={() => void saveRow(row.ward_inventory_id)}>
                          Save
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Restock</h3>
            <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50/90 p-4">
              {inventory.map((row) => {
                const st = restock[row.ward_inventory_id] ?? { qty: "", note: "" };
                return (
                  <div
                    key={`restock-${row.ward_inventory_id}`}
                    className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-end"
                  >
                    <div className="min-w-[180px] flex-1">
                      <p className="text-xs font-medium text-slate-900">{row.item_name}</p>
                      <p className="text-[11px] text-slate-600">
                        Last:{" "}
                        {row.last_restocked_at
                          ? new Date(row.last_restocked_at).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "—"}{" "}
                        · By:{" "}
                        <span className="font-medium text-slate-900">{row.last_restocked_by_name ?? "—"}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <Label className="text-[10px] uppercase text-slate-500">Qty</Label>
                        <Input
                          type="number"
                          min={0.01}
                          step={0.01}
                          className="mt-0.5 h-9 w-24 border-slate-300 bg-white text-slate-900"
                          value={st.qty}
                          onChange={(ev) =>
                            setRestock((prev) => ({
                              ...prev,
                              [row.ward_inventory_id]: { ...st, qty: ev.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="min-w-[200px] flex-1">
                        <Label className="text-[10px] uppercase text-slate-500">Source note</Label>
                        <Input
                          className="mt-0.5 h-9 border-slate-300 bg-white text-slate-900"
                          placeholder="Supplier / batch / PO"
                          value={st.note}
                          onChange={(ev) =>
                            setRestock((prev) => ({
                              ...prev,
                              [row.ward_inventory_id]: { ...st, note: ev.target.value },
                            }))
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        disabled={restockBusy === row.ward_inventory_id || !practitionerId}
                        onClick={() => void submitRestock(row)}
                      >
                        {restockBusy === row.ward_inventory_id ? "…" : "Restock"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Restock history</h3>
            <div className="space-y-2">
              {inventory.map((row) => (
                <details
                  key={`hist-${row.ward_inventory_id}`}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm"
                  onToggle={(ev) => {
                    const el = ev.currentTarget;
                    if (el.open && !historyByItem[row.ward_inventory_id]) void loadHistory(row.ward_inventory_id);
                  }}
                >
                  <summary className="cursor-pointer text-sm font-medium text-slate-900">
                    {row.item_name}
                  </summary>
                  {historyLoading === row.ward_inventory_id ? (
                    <p className="mt-2 text-xs text-slate-600">Loading…</p>
                  ) : (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[480px] text-xs">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="py-1 pr-2">Date</th>
                            <th className="py-1 pr-2">Qty added</th>
                            <th className="py-1 pr-2">By</th>
                            <th className="py-1">Source note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(historyByItem[row.ward_inventory_id] ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-2 text-slate-500">
                                No restock events yet.
                              </td>
                            </tr>
                          ) : (
                            (historyByItem[row.ward_inventory_id] ?? []).map((h) => (
                              <tr key={h.id} className="border-t border-slate-200">
                                <td className="py-1.5 pr-2 tabular-nums text-slate-900">
                                  {h.restocked_at
                                    ? new Date(h.restocked_at).toLocaleString(undefined, {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      })
                                    : "—"}
                                </td>
                                <td className="py-1.5 pr-2 tabular-nums text-slate-900">{h.quantity_added}</td>
                                <td className="py-1.5 pr-2 text-slate-900">{h.by_name ?? h.restocked_by ?? "—"}</td>
                                <td className="py-1.5 text-slate-600">{h.source_note ?? "—"}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              ))}
            </div>
          </div>
        </div>
      )}

      {addOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/45 backdrop-blur-[2px] sm:items-center"
          role="dialog"
          aria-modal
          onClick={() => !addSubmitting && setAddOpen(false)}
        >
          <div
            className="light-form-surface max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 p-5 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900">Add ward inventory item</h3>
            <div className="mt-4 space-y-3">
              <div>
                <Label className="text-slate-800">Item name</Label>
                <Input
                  className="mt-1 border-slate-300 bg-white text-slate-900"
                  value={addForm.item_name}
                  onChange={(e) => setAddForm((p) => ({ ...p, item_name: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-slate-800">Category (optional)</Label>
                <Input
                  className="mt-1 border-slate-300 bg-white text-slate-900"
                  value={addForm.category}
                  onChange={(e) => setAddForm((p) => ({ ...p, category: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-slate-800">Unit (optional)</Label>
                <Input
                  className="mt-1 border-slate-300 bg-white text-slate-900"
                  placeholder="e.g. piece, box"
                  value={addForm.unit_of_measure}
                  onChange={(e) => setAddForm((p) => ({ ...p, unit_of_measure: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-800">Min stock</Label>
                  <Input
                    type="number"
                    min={0}
                    className="mt-1 border-slate-300 bg-white text-slate-900"
                    value={addForm.minimum_stock}
                    onChange={(e) => setAddForm((p) => ({ ...p, minimum_stock: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-slate-800">Unit cost</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    className="mt-1 border-slate-300 bg-white text-slate-900"
                    value={addForm.unit_cost}
                    onChange={(e) => setAddForm((p) => ({ ...p, unit_cost: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="add-billable"
                  className="h-4 w-4 accent-primary"
                  checked={addForm.is_billable}
                  onChange={(e) => setAddForm((p) => ({ ...p, is_billable: e.target.checked }))}
                />
                <Label htmlFor="add-billable" className="text-slate-800">
                  Billable
                </Label>
              </div>
              <div>
                <Label className="text-slate-800">Charge definition (optional)</Label>
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={addForm.charge_item_def_id}
                  onChange={(e) => setAddForm((p) => ({ ...p, charge_item_def_id: e.target.value }))}
                >
                  <option value="">—</option>
                  {defs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.display_name} ({d.category})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={addSubmitting} onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={addSubmitting} onClick={() => void submitAddItem()}>
                {addSubmitting ? "Saving…" : "Add"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
