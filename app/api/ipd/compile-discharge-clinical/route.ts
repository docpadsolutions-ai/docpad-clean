import { NextRequest, NextResponse } from "next/server";

type ProgressNote = Record<string, unknown>;
type InvRow = Record<string, unknown>;
type TreatmentRow = Record<string, unknown>;

type Body = {
  patientName: string;
  ageYears: string | number;
  sex: string;
  admittedDate: string;
  dischargeDate: string;
  losDays: number;
  admittingDiagnosis: string;
  specialty: string;
  progressNotes: ProgressNote[];
  investigations: InvRow[];
  treatments: TreatmentRow[];
};

const SYSTEM = `You are a senior hospital physician writing a clinical discharge summary. 
Write in concise, professional medical language. 
Focus on the clinical narrative — what happened, how the patient evolved, key findings, response to treatment.
For serial investigations (same test done multiple times), describe the TREND not just list values.
Flag any critical values and document clinical response to them.
Do not include administrative details. Output two sections only:
1. HOSPITAL COURSE (paragraph form, day-by-day narrative)
2. INVESTIGATIONS SUMMARY (trend-based, highlight abnormals and their clinical significance)
Return plain text, no markdown, no bullet points.`;

function buildUserContent(b: Body): string {
  const progressNotes = b.progressNotes ?? [];
  const investigations = b.investigations ?? [];
  const treatments = b.treatments ?? [];

  const dailyBlock = progressNotes
    .map((n) => {
      const day = n.hospital_day_number;
      const nd = n.note_date;
      return `Day ${day} (${nd}):
  Condition: ${n.condition_status ?? "-"} | Pain: ${n.pain_score ?? "-"}/10
  Vitals: HR ${n.heart_rate ?? "-"}, BP ${n.bp_systolic ?? "-"}/${n.bp_diastolic ?? "-"}, SpO2 ${n.spo2 ?? "-"}%, Temp ${n.temperature_c ?? "-"}°C
  Subjective: ${n.subjective_text ?? "-"}
  Assessment: ${n.assessment_text ?? "-"}
  Plan: ${n.plan_narrative ?? "-"}`;
    })
    .join("\n\n");

  const invBlock = investigations
    .map((i) => {
      const crit = i.is_critical ? " [CRITICAL]" : "";
      const val = i.result_value ?? i.result_text ?? "Pending";
      const unit = i.result_unit != null ? ` ${i.result_unit}` : "";
      return `${i.ordered_date} | ${i.test_name}: ${val}${unit}${crit}`;
    })
    .join("\n");

  const txBlock = treatments
    .map(
      (t) =>
        `${t.name} ${t.dose ?? ""} ${t.route ?? ""} ${t.frequency ?? ""} x${t.duration_days ?? "?"} days`,
    )
    .join("\n");

  return `Patient: ${b.patientName}, ${b.ageYears}Y ${b.sex}
Admitted: ${b.admittedDate} | Discharged: ${b.dischargeDate} | LOS: ${b.losDays} days
Admitting diagnosis: ${b.admittingDiagnosis || "Not recorded"}
Specialty: ${b.specialty || "General"}

DAILY CLINICAL DATA:
${dailyBlock || "(No daily notes)"}

INVESTIGATIONS ORDERED:
${invBlock || "(None)"}

TREATMENTS GIVEN:
${txBlock || "(None)"}

Write the discharge summary now.`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error("[ipd/compile-discharge-clinical] NEXT_PUBLIC_GEMINI_API_KEY is not set.");
    return NextResponse.json(
      { error: "Clinical summary service is not configured. Contact your admin." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.progressNotes)) {
    return NextResponse.json({ error: "progressNotes must be an array." }, { status: 400 });
  }

  const userContent = buildUserContent(body);
  const fullPrompt = `${SYSTEM.trim()}\n\n---\n\n${userContent}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
        }),
      },
    );

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string; status?: string };
    };

    if (!response.ok) {
      const msg = data.error?.message ?? `Gemini API error (${response.status})`;
      console.error("[ipd/compile-discharge-clinical]", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!text) {
      return NextResponse.json({ error: "Empty model response." }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (e) {
    console.error("[ipd/compile-discharge-clinical]", e);
    return NextResponse.json({ error: "Failed to reach clinical summary service." }, { status: 502 });
  }
}
