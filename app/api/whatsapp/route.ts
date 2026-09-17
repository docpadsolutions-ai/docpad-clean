import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createSupabaseAdmin } from "@/app/lib/supabase/admin";
import { requireStaff } from "@/app/lib/supabase/server";

const MAX_TEXT_BLOCK = 3000;

/** Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX). Returns null if it does not look valid. */
function toE164(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return null;
}

function clip(text: unknown): string {
  const s = typeof text === "string" ? text.trim() : "";
  return s.length > MAX_TEXT_BLOCK ? `${s.slice(0, MAX_TEXT_BLOCK)}…` : s;
}

export async function POST(req: NextRequest) {
  // 1. Only signed-in, active hospital staff may send messages.
  const gate = await requireStaff();
  if (!gate.ok) return gate.response;
  const { hospitalId } = gate.staff;

  let body: {
    rxId?: string;
    /** Optional lab result lines (plain text / WhatsApp markdown) appended after the link. */
    labSummaryText?: string;
    /** Optional medication list (may include Hindi lines when client sends bilingual dosage). */
    medicationsText?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const encounterId = String(body.rxId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(encounterId)) {
    return NextResponse.json({ error: "Missing or invalid rxId." }, { status: 400 });
  }

  const accountSid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    return NextResponse.json({ error: "Twilio credentials are not configured." }, { status: 500 });
  }

  // 2. Recipient, names and hospital come from the database, never from the request body,
  //    and the encounter must belong to the caller's hospital.
  const admin = createSupabaseAdmin();
  const { data: enc } = await admin
    .from("opd_encounters")
    .select("id, hospital_id, patient_id, doctor_id")
    .eq("id", encounterId)
    .maybeSingle();
  const encounter = enc as { id: string; hospital_id: string | null; patient_id: string | null; doctor_id: string | null } | null;
  if (!encounter || encounter.hospital_id !== hospitalId || !encounter.patient_id) {
    return NextResponse.json({ error: "Prescription not found." }, { status: 404 });
  }

  const [{ data: pat }, { data: hosp }, { data: doc }] = await Promise.all([
    admin.from("patients").select("full_name, phone").eq("id", encounter.patient_id).maybeSingle(),
    admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle(),
    encounter.doctor_id
      ? admin
          .from("practitioners")
          .select("full_name")
          .or(`id.eq.${encounter.doctor_id},user_id.eq.${encounter.doctor_id}`)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const patient = pat as { full_name: string | null; phone: string | null } | null;
  const to = toE164(patient?.phone);
  if (!to) {
    return NextResponse.json({ error: "No valid phone number on file for this patient." }, { status: 400 });
  }

  const hospitalName = (hosp as { name: string | null } | null)?.name?.trim() || "DocPad";
  const doctorName = (doc as { full_name: string | null } | null)?.full_name?.trim();
  const patientName = patient?.full_name?.trim() || "there";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://docpad.in").replace(/\/$/, "");

  const meds = clip(body.medicationsText);
  const labs = clip(body.labSummaryText);

  const messageBody =
    `🏥 *${hospitalName}*\n` +
    `Hello ${patientName},\n` +
    `Your digital prescription${doctorName ? ` from Dr. ${doctorName}` : ""} is ready.\n` +
    `📄 View & Download here: ${appUrl}/rx/${encounter.id}` +
    (meds ? `\n\n*Medications*\n${meds}` : "") +
    (labs ? `\n\n*Lab summaries*\n${labs}` : "") +
    `\n\nWishing you a speedy recovery!`;

  try {
    const client = twilio(accountSid, authToken);
    const message = await client.messages.create({
      from: `whatsapp:${fromNumber}`,
      to: `whatsapp:${to}`,
      body: messageBody,
    });
    return NextResponse.json({ success: true, sid: message.sid });
  } catch (err: unknown) {
    console.error("[WhatsApp API] Twilio error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not send the WhatsApp message." }, { status: 502 });
  }
}
