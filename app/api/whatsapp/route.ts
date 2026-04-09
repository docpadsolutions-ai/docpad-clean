import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(req: NextRequest) {
  const { phone, patientName, rxId, doctorName, labSummaryText } = await req.json() as {
    phone: string;
    patientName: string;
    rxId: string;
    doctorName: string;
    /** Optional lab result lines (plain text / WhatsApp markdown) appended after the link. */
    labSummaryText?: string;
  };

  if (!phone || !patientName || !rxId || !doctorName) {
    return NextResponse.json(
      { error: "Missing required fields: phone, patientName, rxId, doctorName." },
      { status: 400 }
    );
  }

  const accountSid = process.env.TWILIO_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return NextResponse.json(
      { error: "Twilio credentials are not configured." },
      { status: 500 }
    );
  }

  const client = twilio(accountSid, authToken);

  const labBlock =
    labSummaryText && String(labSummaryText).trim()
      ? `\n\n*Lab summaries*\n${String(labSummaryText).trim()}`
      : "";

  const messageBody =
    `🏥 *Rameshwar Dass Memorial Hospital*\n` +
    `Hello ${patientName},\n` +
    `Your digital prescription from Dr. ${doctorName} is ready.\n` +
    `📄 View & Download here: https://docpad.in/rx/${rxId}` +
    labBlock +
    `\n\nWishing you a speedy recovery!`;

  try {
    const message = await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to:   `whatsapp:${phone}`,
      body: messageBody,
    });

    return NextResponse.json({ success: true, sid: message.sid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown Twilio error";
    console.error("[WhatsApp API] Twilio error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
