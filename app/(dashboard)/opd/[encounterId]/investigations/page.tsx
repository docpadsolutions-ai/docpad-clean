"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAuthOrgId } from "../../../../lib/authOrg";
import { practitionersOrFilterForAuthUid } from "../../../../lib/practitionerAuthLookup";
import { mapCatalogCategoryToInvestigationTestCategory } from "../../../../lib/investigationTestCategory";
import { supabase } from "../../../../supabase";

type TestCatalogueRow = {
  id: string;
  test_name: string | null;
  short_code: string | null;
  category: string | null;
  subcategory: string | null;
  loinc_code: string | null;
  sample_type: string | null;
  requires_fasting: boolean | null;
  expected_tat_hours: number | null;
  snomed_code: string | null;
  snomed_display: string | null;
  is_active: boolean | null;
  hospital_id?: string | null;
  sort_order?: number | null;
};

type OrderLine = {
  catalogueId: string;
  catalog: TestCatalogueRow;
  priority: "routine" | "urgent" | "stat";
  clinical_indication: string;
};

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const labelCls = "mb-1 block text-xs font-medium text-gray-700";

const btnPrimary =
  "inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40";

const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50";

const btnDanger =
  "inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 transition hover:bg-rose-100";

function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export default function InvestigationPlanPage() {
  const params = useParams();
  const encounterId =
    typeof params.encounterId === "string"
      ? params.encounterId
      : Array.isArray(params.encounterId)
        ? params.encounterId[0] ?? ""
        : "";

  const [patientId, setPatientId] = useState<string | null>(null);
  const [encounterDoctorId, setEncounterDoctorId] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [encounterError, setEncounterError] = useState<string | null>(null);
  const [encounterLoading, setEncounterLoading] = useState(true);

  const [catalogue, setCatalogue] = useState<TestCatalogueRow[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [placing, setPlacing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const orderedIds = useMemo(() => new Set(orderLines.map((l) => l.catalogueId)), [orderLines]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    if (!encounterId) {
      setEncounterLoading(false);
      setEncounterError("Missing encounter.");
      return;
    }

    let cancelled = false;
    setEncounterLoading(true);
    setEncounterError(null);

    void (async () => {
      const { data: enc, error: encErr } = await supabase
        .from("opd_encounters")
        .select("patient_id, doctor_id, hospital_id")
        .eq("id", encounterId)
        .maybeSingle();

      if (cancelled) return;

      if (encErr || !enc) {
        setEncounterError(encErr?.message ?? "Encounter not found.");
        setPatientId(null);
        setEncounterDoctorId(null);
        setHospitalId(null);
        setEncounterLoading(false);
        return;
      }

      const pid = enc.patient_id != null ? String(enc.patient_id).trim() : "";
      const did = enc.doctor_id != null ? String(enc.doctor_id).trim() : "";
      let hid = enc.hospital_id != null ? String(enc.hospital_id).trim() : "";

      if (!hid) {
        const { orgId } = await fetchAuthOrgId();
        hid = orgId?.trim() ?? "";
      }

      let resolvedDoctor = did || null;
      if (!resolvedDoctor) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const uid = user?.id;
        if (uid) {
          const { data: pr } = await supabase
            .from("practitioners")
            .select("id")
            .or(practitionersOrFilterForAuthUid(uid))
            .maybeSingle();
          if (pr?.id) resolvedDoctor = String(pr.id);
        }
      }

      setPatientId(pid || null);
      setEncounterDoctorId(resolvedDoctor);
      setHospitalId(hid || null);
      if (!pid) setEncounterError("Encounter has no patient.");
      else if (!hid) setEncounterError("Hospital context missing for this encounter.");
      else if (!resolvedDoctor) setEncounterError("No ordering doctor on file — link a doctor to this encounter or your account.");
      setEncounterLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [encounterId]);

  const loadCatalogue = useCallback(async (hid: string | null) => {
    if (!hid) {
      setCatalogue([]);
      return;
    }
    setCatalogueLoading(true);
    setCatalogueError(null);
    const { data, error } = await supabase
      .from("test_catalogue")
      .select("*")
      .eq("is_active", true)
      .or(`hospital_id.eq.${hid},hospital_id.is.null`)
      .order("category", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true, nullsFirst: false });

    if (error) {
      setCatalogueError(error.message);
      setCatalogue([]);
    } else {
      setCatalogue((data ?? []) as TestCatalogueRow[]);
    }
    setCatalogueLoading(false);
  }, []);

  useEffect(() => {
    if (!hospitalId) return;
    void loadCatalogue(hospitalId);
  }, [hospitalId, loadCatalogue]);

  const filteredCatalogue = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalogue;
    return catalogue.filter((t) => {
      const name = norm(t.test_name).toLowerCase();
      const code = norm(t.short_code).toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [catalogue, search]);

  const byCategory = useMemo(() => {
    const m = new Map<string, TestCatalogueRow[]>();
    for (const row of filteredCatalogue) {
      const cat = norm(row.category) || "Uncategorized";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(row);
    }
    const sortKey = (r: TestCatalogueRow) =>
      r.sort_order != null && !Number.isNaN(Number(r.sort_order)) ? Number(r.sort_order) : 9999;
    for (const [, rows] of m) {
      rows.sort((a, b) => sortKey(a) - sortKey(b) || norm(a.test_name).localeCompare(norm(b.test_name)));
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredCatalogue]);

  function addTest(row: TestCatalogueRow) {
    if (orderedIds.has(row.id)) return;
    setOrderLines((prev) => [
      ...prev,
      {
        catalogueId: row.id,
        catalog: row,
        priority: "routine",
        clinical_indication: "",
      },
    ]);
  }

  function removeLine(catalogueId: string) {
    setOrderLines((prev) => prev.filter((l) => l.catalogueId !== catalogueId));
  }

  function updateLine(catalogueId: string, patch: Partial<Pick<OrderLine, "priority" | "clinical_indication">>) {
    setOrderLines((prev) =>
      prev.map((l) => (l.catalogueId === catalogueId ? { ...l, ...patch } : l)),
    );
  }

  async function placeOrder() {
    if (!encounterId || !patientId || !hospitalId || !encounterDoctorId) {
      showToast("Missing encounter, patient, hospital, or doctor.");
      return;
    }
    if (orderLines.length === 0) {
      showToast("Add at least one test.");
      return;
    }

    setPlacing(true);
    const now = new Date().toISOString();
    const rows = orderLines.map((line) => {
      const c = line.catalog;
      return {
        hospital_id: hospitalId,
        patient_id: patientId,
        encounter_id: encounterId,
        doctor_id: encounterDoctorId,
        test_name: norm(c.test_name) || norm(c.short_code) || "Test",
        test_code: norm(c.short_code) || null,
        test_category: mapCatalogCategoryToInvestigationTestCategory(c.category),
        /** Preserve catalogue grouping in subcategory when the row has no finer subcategory. */
        test_subcategory: norm(c.subcategory) || norm(c.category) || null,
        status: "ordered",
        result_status: "pending",
        priority: line.priority,
        clinical_indication: line.clinical_indication.trim() || null,
        ordered_at: now,
        expected_tat_hours: c.expected_tat_hours ?? null,
        snomed_procedure_code: norm(c.snomed_code) || null,
        snomed_procedure_display: norm(c.snomed_display) || null,
        billing_status: "unbilled",
        fhir_service_request_json: null,
      };
    });

    const { error } = await supabase.from("investigations").insert(rows);
    setPlacing(false);

    if (error) {
      showToast(error.message);
      return;
    }

    showToast(`Placed ${rows.length} investigation order(s).`);
    setOrderLines([]);
  }

  if (!encounterId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-slate-50 p-6 text-sm text-gray-600">
        Invalid encounter link.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href={`/dashboard/opd/encounter/${encounterId}?tab=investigations`}
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              ← Back to encounter
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">Investigation plan</h1>
            <p className="mt-1 text-sm text-gray-600">Order labs from the hospital catalogue for this visit.</p>
          </div>
        </div>

        {encounterLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-[480px] animate-pulse rounded-2xl border border-gray-200 bg-white" />
            <div className="h-[480px] animate-pulse rounded-2xl border border-gray-200 bg-white" />
          </div>
        ) : encounterError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{encounterError}</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {/* Catalogue */}
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Test catalogue</h2>
                <p className="text-xs text-gray-500">Search and add tests to the order.</p>
                <input
                  type="search"
                  className={`${inputCls} mt-3`}
                  placeholder="Search by name or short code…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search tests"
                />
              </div>
              <div className="max-h-[min(70vh,640px)] overflow-y-auto p-3">
                {catalogueLoading ? (
                  <div className="space-y-2 p-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
                    ))}
                  </div>
                ) : catalogueError ? (
                  <p className="p-4 text-sm text-red-600">{catalogueError}</p>
                ) : byCategory.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No active tests in the catalogue for this hospital.</p>
                ) : (
                  <div className="space-y-6">
                    {byCategory.map(([category, tests]) => (
                      <div key={category}>
                        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-gray-500">{category}</h3>
                        <ul className="space-y-2">
                          {tests.map((t) => {
                            const added = orderedIds.has(t.id);
                            return (
                              <li key={t.id}>
                                <button
                                  type="button"
                                  disabled={added}
                                  onClick={() => addTest(t)}
                                  className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                                    added
                                      ? "cursor-not-allowed border-blue-200 bg-blue-50/80 text-gray-600"
                                      : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-gray-900">{norm(t.test_name) || "—"}</span>
                                    {t.requires_fasting ? (
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                                        Fasting
                                      </span>
                                    ) : null}
                                    {added ? (
                                      <span className="text-xs font-medium text-blue-700">In order</span>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 text-xs text-gray-500">
                                    {norm(t.sample_type) ? <span>Sample: {t.sample_type}</span> : null}
                                    {t.expected_tat_hours != null ? (
                                      <span>TAT: {t.expected_tat_hours}h</span>
                                    ) : null}
                                    {norm(t.short_code) ? <span className="font-mono">{t.short_code}</span> : null}
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Order list */}
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Order list</h2>
                <p className="text-xs text-gray-500">{orderLines.length} test(s) selected</p>
              </div>
              <div className="max-h-[min(56vh,520px)] overflow-y-auto p-3">
                {orderLines.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">Select tests from the catalogue.</p>
                ) : (
                  <ul className="space-y-3">
                    {orderLines.map((line) => (
                      <li
                        key={line.catalogueId}
                        className="rounded-xl border border-gray-100 bg-gray-50/50 p-3"
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {norm(line.catalog.test_name) || norm(line.catalog.short_code) || "Test"}
                          </span>
                          <button type="button" className={btnDanger} onClick={() => removeLine(line.catalogueId)}>
                            Remove
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className={labelCls}>Priority</label>
                            <select
                              className={inputCls}
                              value={line.priority}
                              onChange={(e) =>
                                updateLine(line.catalogueId, {
                                  priority: e.target.value as OrderLine["priority"],
                                })
                              }
                            >
                              <option value="routine">Routine</option>
                              <option value="urgent">Urgent</option>
                              <option value="stat">Stat</option>
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <label className={labelCls}>Clinical indication</label>
                            <input
                              className={inputCls}
                              value={line.clinical_indication}
                              onChange={(e) =>
                                updateLine(line.catalogueId, { clinical_indication: e.target.value })
                              }
                              placeholder="Why is this test needed?"
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-gray-100 p-4">
                <button type="button" className={btnPrimary} disabled={placing || orderLines.length === 0} onClick={() => void placeOrder()}>
                  {placing ? "Placing order…" : "Place order"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
