import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight for browser requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { patient_history } = await req.json();
    const geminiKey = Deno.env.get("GEMINI_API_KEY")?.trim();

    if (!patient_history) {
      return new Response(JSON.stringify({ success: false, error: "Missing patient history" }), { 
        status: 400, headers: corsHeaders 
      });
    }

    // The Master Clinical Prompt
    const prompt = `You are an expert orthopaedic clinical assistant. 
    Your job is to read the following patient history (past encounters, prescriptions, notes) and write a concise, 3-to-4 sentence clinical summary. 
    Focus strictly on:
    1. Chronic conditions (e.g., Osteoarthritis).
    2. Past treatments and their timelines.
    3. Adverse reactions or failed medications.
    Do not use conversational filler. Be highly professional and use standard medical terminology.

    PATIENT HISTORY:
    ${patient_history}`;

    // Call the fast, generative Flash model
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2, // Low temperature for high factual accuracy
          }
        })
      }
    );

    const data = await res.json();

    if (!res.ok) {
       console.error("[generate-summary] Gemini API Error:", data);
       return new Response(JSON.stringify({ success: false, error: "gemini_api_error" }), { 
         status: 500, headers: corsHeaders 
       });
    }

    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate summary.";

    return new Response(JSON.stringify({ success: true, summary: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[generate-summary] unhandled", e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), { 
      status: 500, headers: corsHeaders 
    });
  }
});
