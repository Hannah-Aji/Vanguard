// supabase/functions/start-pass/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function addOneMonthISO(now = new Date()) {
  const d = new Date(now);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() < day) d.setDate(0);
  return d.toISOString();
}

serve(async (req) => {
  // 1) Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const { plan_code = "MONTH_PASS" } = await req.json();

    // Use the same env names you set via `supabase secrets set`
    const supabase = createClient(
      Deno.env.get("URL")!,               // or SUPABASE_URL if that’s what you stored
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: uErr } = await supabase.auth.getUser(jwt);
    if (uErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: plan, error: pErr } = await supabase
      .from("plans").select("*")
      .eq("code", plan_code).eq("active", true)
      .single();
    if (pErr || !plan) {
      return new Response(JSON.stringify({ error: "Plan not found or inactive" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nextISO = addOneMonthISO(new Date());

    const { data: rider, error: rErr } = await supabase
      .from("riders")
      .update({
        subscription_plan_code: plan.code,
        next_billing_at: nextISO
      })
      .eq("user_id", user.id)           
      .select("user_id, subscription_plan_code, next_billing_at")
      .single();

    if (rErr) {
      return new Response(JSON.stringify({ error: rErr.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, pass: rider }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
