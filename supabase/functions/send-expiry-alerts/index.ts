import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Daily expiring-stock emails via Resend (one digest per hospital → each pharmacist).
 *
 * Deploy:
 *   supabase functions deploy send-expiry-alerts
 *
 * Secrets (Dashboard → Edge Functions → Secrets, or CLI) — CRON_SECRET is required for POST:
 *   supabase secrets set RESEND_API_KEY=re_...
 *   supabase secrets set RESEND_FROM="DocPad Pharmacy <pharmacy@yourdomain.com>"  # verified Resend domain
 *   supabase secrets set CRON_SECRET=<strong-random>   # must match pg_cron / Vault (see supabase/sql/daily-expiry-alerts-cron.example.sql)
 *
 * Vault (Dashboard → Project Settings → Vault): create a secret named CRON_SECRET with the same value
 * so pg_cron can pass it in the x-cron-secret header without hardcoding in SQL.
 *
 * Schedule: run the example in `supabase/sql/daily-expiry-alerts-cron.example.sql` in the SQL Editor (adjust project URL if needed).
 *
 * Schema: organizations (id, name), pharmacy_expiring_stock (days_left, …), practitioners (email, user_role: pharmacist | admin).
 */

const RESEND_API_URL = "https://api.resend.com/emails";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type OrganizationRow = { id: string; name: string | null };
type ExpiringRow = {
  brand_name: string | null;
  generic_name: string | null;
  batch_number: string | null;
  expiry_date: string;
  days_left: number;
  quantity: number | null;
};
type AlertRecipientRow = { email: string | null; user_role: string | null };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
      },
    });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, function: "send-expiry-alerts" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "DocPad Pharmacy <onboarding@resend.dev>";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY is not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Supabase env missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const summary = {
    success: true as boolean,
    hospitalsProcessed: 0,
    emailsAttempted: 0,
    emailsOk: 0,
    errors: [] as string[],
  };

  try {
    const { data: orgs, error: orgErr } = await supabase.from("organizations").select("id, name");

    if (orgErr) {
      summary.success = false;
      summary.errors.push(`organizations: ${orgErr.message}`);
      return new Response(JSON.stringify(summary), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    for (const hospital of (orgs ?? []) as OrganizationRow[]) {
      const hospitalName = (hospital.name ?? "Hospital").trim() || "Hospital";

      const { data: expiringStock, error: expErr } = await supabase
        .from("pharmacy_expiring_stock")
        .select("brand_name, generic_name, batch_number, expiry_date, days_left, quantity")
        .eq("hospital_id", hospital.id)
        .order("days_left", { ascending: true });

      if (expErr) {
        summary.errors.push(`${hospital.id} expiring: ${expErr.message}`);
        continue;
      }

      const rows = (expiringStock ?? []) as ExpiringRow[];
      if (rows.length === 0) continue;

      summary.hospitalsProcessed += 1;

      const critical = rows.filter((i) => i.days_left <= 7);
      const warning = rows.filter((i) => i.days_left >= 8 && i.days_left <= 30);

      const { data: pharmacists, error: phErr } = await supabase
        .from("practitioners")
        .select("email, user_role")
        .eq("hospital_id", hospital.id)
        .in("user_role", ["pharmacist", "admin"])
        .not("email", "is", null);

      if (phErr) {
        summary.errors.push(`${hospital.id} practitioners: ${phErr.message}`);
        continue;
      }

      const emails = [
        ...new Set(
          (pharmacists ?? [])
            .map((p: AlertRecipientRow) => (p.email ?? "").trim().toLowerCase())
            .filter((e) => e.length > 0),
        ),
      ];
      if (emails.length === 0) continue;

      const itemLine = (i: ExpiringRow) => {
        const brand = escapeHtml((i.brand_name ?? "—").trim() || "—");
        const gen = (i.generic_name ?? "").trim()
          ? ` (${escapeHtml(i.generic_name.trim())})`
          : "";
        const batch = escapeHtml((i.batch_number ?? "—").trim() || "—");
        const qty = i.quantity != null ? ` · Qty ${escapeHtml(String(i.quantity))}` : "";
        return `<li>${brand}${gen} — Batch ${batch} — ${i.days_left} day(s) left${qty}</li>`;
      };

      const emailHtml = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1e293b;">
  <h2 style="margin-bottom: 0.5rem;">Expiring stock — ${escapeHtml(hospitalName)}</h2>
  <p style="color: #64748b; font-size: 14px;">Batches with expiry within the next 30 days (from DocPad Pharmacy).</p>
  ${
    critical.length > 0
      ? `
  <h3 style="color: #b91c1c; margin-top: 1.25rem;">Critical (≤7 days): ${critical.length} line(s)</h3>
  <ul>${critical.map(itemLine).join("")}</ul>`
      : ""
  }
  ${
    warning.length > 0
      ? `
  <h3 style="color: #b45309; margin-top: 1.25rem;">Warning (8–30 days): ${warning.length} line(s)</h3>
  <ul>${warning.map(itemLine).join("")}</ul>`
      : ""
  }
</body>
</html>`.trim();

      const subject =
        critical.length > 0
          ? `Expiring stock: ${critical.length} critical — ${hospitalName}`
          : `Expiring stock: ${warning.length} item(s) in 8–30 days — ${hospitalName}`;

      for (const to of emails) {
        summary.emailsAttempted += 1;
        const res = await fetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to,
            subject,
            html: emailHtml,
          }),
        });

        if (!res.ok) {
          const t = await res.text();
          summary.errors.push(`Resend ${to}: ${res.status} ${t}`);
        } else {
          summary.emailsOk += 1;
        }
      }
    }

    if (summary.errors.length > 0 && summary.emailsOk === 0 && summary.emailsAttempted > 0) {
      summary.success = false;
    }

    return new Response(JSON.stringify(summary), {
      status: summary.success ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
