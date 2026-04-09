import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Update these headers to be very explicit for local development
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle the browser's "pre-flight" security check
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // MOCK SUCCESS RESPONSE
    return new Response(
      JSON.stringify({ 
        message: "Success (Mock): OTP sent.", 
        status: "SUCCESS", 
        txnId: crypto.randomUUID() 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
