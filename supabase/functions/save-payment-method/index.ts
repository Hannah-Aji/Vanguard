
//save-payment-method

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@16.6.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

serve(async (req) => {
  try {
    const { payment_method_id, billing_email } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return new Response("Unauthorized", { status: 401 });

    // Fetch PM details from Stripe to get brand/last4/exp
    const pm = await stripe.paymentMethods.retrieve(payment_method_id);
    if (pm.type !== "card" || !pm.card) {
      return new Response(JSON.stringify({ error: "Unsupported payment method" }), { status: 400 });
    }

    // Make this the default: flip older defaults off
    await supabase.from("user_payment_methods")
      .update({ is_default: false })
      .eq("user_id", user.id);

    const { data, error } = await supabase
      .from("user_payment_methods")
      .insert([{
        user_id: user.id,
        provider: "stripe",
        pm_id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
        billing_email: billing_email ?? user.email ?? null,
        is_default: true
      }])
      .select()
      .single();

    if (error) return new Response(JSON.stringify({ error }), { status: 400 });

    return new Response(JSON.stringify({ ok: true, payment_method: data }), {
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
