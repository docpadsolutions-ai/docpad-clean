import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DueReminder = {
  appointment_id: string;
  hospital_id: string;
  patient_id: string;
  appointment_date: string;
  scheduled_time: string | null;
  visit_type: string | null;
  booking_source: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_name: string | null;
  hospital_name: string | null;
};

/** Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX). Returns null if it does not look valid. */
function toE164(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return null;
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function buildMessage(r: DueReminder, kind: string): string {
  const when = kind === "same_day" ? `today` : `tomorrow, ${formatDate(r.appointment_date)}`;
  const at = r.scheduled_time ? ` at ${r.scheduled_time.slice(0, 5)}` : "";
  const withDoctor = r.doctor_name ? ` with ${r.doctor_name}` : "";
  const kindWord = r.visit_type === "follow_up" ? "follow-up" : "appointment";
  const from = r.hospital_name ? `\n\n— ${r.hospital_name}` : "";
  return (
    `Namaste ${r.patient_name ?? "there"}, this is a reminder of your ${kindWord}${withDoctor} ` +
    `${when}${at}.\n\nPlease reply or call the clinic if you need to reschedule.${from}`
  );
}

/**
 * POST /api/reminders/appointments?kind=day_before
 *
 * Sends WhatsApp reminders for booked appointments and scheduled follow-ups.
 * Runs unattended (Vercel Cron), so it is authorised by a shared secret rather
 * than a user session: `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends
 * that header automatically when CRON_SECRET is set on the project.
 *
 * Every attempt is recorded with record_appointment_reminder(), and
 * due_appointment_reminders() excludes anything already recorded, so a retry or
 * a double-fired cron cannot message a patient twice.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not permitted." }, { status: 401 });
  }

  const kind = req.nextUrl.searchParams.get("kind") === "same_day" ? "same_day" : "day_before";
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";

  const accountSid = process.env.TWILIO_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER?.trim();

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc("due_appointment_reminders", { p_kind: kind });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const due = (Array.isArray(data) ? data : []) as DueReminder[];
  if (due.length === 0) {
    return NextResponse.json({ kind, considered: 0, sent: 0, failed: 0, skipped: 0 });
  }
  if (dryRun) {
    return NextResponse.json({ kind, dryRun: true, considered: due.length });
  }
  if (!accountSid || !authToken || !fromNumber) {
    return NextResponse.json({ error: "WhatsApp sending is not configured." }, { status: 503 });
  }

  const client = twilio(accountSid, authToken);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of due) {
    const to = toE164(r.patient_phone);

    if (!to) {
      skipped += 1;
      await admin.rpc("record_appointment_reminder", {
        p_appointment_id: r.appointment_id,
        p_kind: kind,
        p_status: "skipped",
        p_recipient: null,
        p_provider_message_id: null,
        p_error: "No usable phone number on file.",
      });
      continue;
    }

    try {
      const msg = await client.messages.create({
        from: `whatsapp:${fromNumber}`,
        to: `whatsapp:${to}`,
        body: buildMessage(r, kind),
      });
      sent += 1;
      await admin.rpc("record_appointment_reminder", {
        p_appointment_id: r.appointment_id,
        p_kind: kind,
        p_status: "sent",
        p_recipient: to,
        p_provider_message_id: msg.sid,
        p_error: null,
      });
    } catch (e) {
      failed += 1;
      await admin.rpc("record_appointment_reminder", {
        p_appointment_id: r.appointment_id,
        p_kind: kind,
        p_status: "failed",
        p_recipient: to,
        p_provider_message_id: null,
        p_error: e instanceof Error ? e.message : "Send failed.",
      });
    }
  }

  return NextResponse.json({ kind, considered: due.length, sent, failed, skipped });
}

/** Vercel Cron issues GET; keep both so either scheduler style works. */
export async function GET(req: NextRequest) {
  return POST(req);
}
