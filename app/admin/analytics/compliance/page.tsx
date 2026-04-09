"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/app/supabase";
import { fetchHospitalIdFromPractitionerAuthId } from "@/app/lib/authOrg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function gaugeColor(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "#64748b";
  if (pct < 70) return "#dc2626";
  if (pct < 85) return "#ca8a04";
  return "#16a34a";
}

function SemicircleGauge({ label, value }: { label: string; value: number | null }) {
  const pct = value != null ? Math.min(100, Math.max(0, value)) : 0;
  const color = gaugeColor(value);
  const arcLen = 100;
  const dash = value != null ? (pct / 100) * arcLen : 0;

  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <svg viewBox="0 0 100 55" className="w-44">
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          className="stroke-slate-200 dark:stroke-slate-700"
          strokeWidth="10"
          strokeLinecap="round"
          pathLength={arcLen}
        />
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          pathLength={arcLen}
          strokeDasharray={`${dash} ${arcLen}`}
        />
      </svg>
      <p className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value != null ? `${value}%` : "—"}
      </p>
      <p className="max-w-[12rem] text-center text-xs font-medium text-slate-700 dark:text-slate-300">{label}</p>
      <p className="text-[10px] text-slate-500">Red &lt;70% · Yellow 70–85% · Green &gt;85%</p>
    </div>
  );
}

type SnapRow = {
  check_type: string;
  department_id: string | null;
  department_name: string;
  score_percentage: number | null;
  detail: Record<string, unknown> | null;
  last_calculated_at: string | null;
};

export default function ComplianceAnalyticsPage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [rows, setRows] = useState<SnapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { hospitalId: hid } = await fetchHospitalIdFromPractitionerAuthId();
      setHospitalId(hid);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("get_nabh_compliance_snapshot", { p_hospital_id: hospitalId });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setRows(
      ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        check_type: String(r.check_type ?? ""),
        department_id: r.department_id != null ? String(r.department_id) : null,
        department_name: String(r.department_name ?? ""),
        score_percentage: r.score_percentage != null ? n(r.score_percentage) : null,
        detail: r.detail != null && typeof r.detail === "object" && !Array.isArray(r.detail) ? (r.detail as Record<string, unknown>) : null,
        last_calculated_at: r.last_calculated_at != null ? String(r.last_calculated_at) : null,
      })),
    );
  }, [hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hospitalWide = useCallback(
    (type: string) => rows.find((r) => r.check_type === type && r.department_id == null) ?? null,
    [rows],
  );

  const doc = hospitalWide("documentation_complete");
  const consent = hospitalWide("consent_present");
  const timely = hospitalWide("note_timeliness");

  const docDetail = doc?.detail ?? null;
  const missRows =
    docDetail != null
      ? [
          { key: "Chief complaint", val: n(docDetail.missing_chief_complaint) },
          { key: "Examination findings", val: n(docDetail.missing_examination_findings) },
          { key: "Diagnosis (ICD-10/SNOMED)", val: n(docDetail.missing_diagnosis) },
          { key: "Treatment plan", val: n(docDetail.missing_treatment_plan) },
          { key: "Follow-up instructions", val: n(docDetail.missing_follow_up_instructions) },
        ]
      : [];

  async function onRefresh() {
    if (!hospitalId) return;
    setRefreshing(true);
    setError(null);
    const { error: e } = await supabase.rpc("refresh_nabh_compliance_for_hospital", { p_hospital_id: hospitalId });
    setRefreshing(false);
    if (e) {
      setError(e.message);
      return;
    }
    await load();
  }

  const deptRows = rows.filter((r) => r.department_id != null);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">NABH compliance</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            NABH 6th Ed. §5.3 — documentation completeness, procedure consent capture, and note timeliness (24h). Scores
            use completed encounters from the last 30 days (UTC).
          </p>
        </div>
        <Button type="button" disabled={!hospitalId || refreshing} onClick={() => void onRefresh()}>
          {refreshing ? "Recalculating…" : "Recalculate now"}
        </Button>
      </header>

      {!hospitalId ? <p className="text-sm text-slate-500">Sign in as hospital staff to load compliance data.</p> : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        Last calculated: {doc?.last_calculated_at ? new Date(doc.last_calculated_at).toLocaleString("en-IN") : "—"} ·
        Nightly job: call <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">calculate_compliance_scores()</code> via
        pg_cron (service role).
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SemicircleGauge label="Documentation completeness (hospital)" value={doc?.score_percentage ?? null} />
        <SemicircleGauge
          label="Consent before procedure (encounters with procedures)"
          value={consent?.score_percentage ?? null}
        />
        <SemicircleGauge label="Clinical note timeliness (≤24h)" value={timely?.score_percentage ?? null} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Missing fields breakdown</CardTitle>
          <p className="text-xs text-slate-500">
            Counts of completed encounters missing each NABH §5.3 element (same window as documentation score).
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : missRows.length === 0 ? (
            <p className="text-sm text-slate-500">Run recalculate to populate breakdown.</p>
          ) : (
            <table className="w-full max-w-md text-sm">
              <tbody>
                {missRows.map((r) => (
                  <tr key={r.key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 text-slate-700 dark:text-slate-300">{r.key}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">{r.val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By department</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                <th className="pb-2 pr-3 font-semibold">Department</th>
                <th className="pb-2 pr-3 font-semibold">Check</th>
                <th className="pb-2 pr-3 font-semibold text-right">Score %</th>
                <th className="pb-2 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {deptRows.map((r) => (
                <tr key={`${r.check_type}-${r.department_id}`} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">{r.department_name}</td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{r.check_type.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums" style={{ color: gaugeColor(r.score_percentage) }}>
                    {r.score_percentage != null ? `${r.score_percentage}%` : "—"}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {r.last_calculated_at ? new Date(r.last_calculated_at).toLocaleDateString("en-IN") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && deptRows.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No department-level rows yet — run recalculate after encounters exist.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
