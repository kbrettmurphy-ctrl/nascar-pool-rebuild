import { memberAuthResponse, requirePoolMember } from "./_member-auth.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    let member;
    try {
      member = await requirePoolMember(request, env);
    } catch (error) {
      return memberAuthResponse(error);
    }

    const body = await request.json();

    const subscription = body?.subscription || null;
    const userAgent = request.headers.get("user-agent") || "";

    if (!subscription?.endpoint) {
      return json({ ok: false, error: "Missing push subscription endpoint" }, 400);
    }

    const row = {
      player_name: member.playerName,
      endpoint: subscription.endpoint,
      subscription,
      user_agent: userAgent,
      paused: false, // (re)subscribing always turns notifications on
      updated_at: new Date().toISOString()
    };

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(row)
      }
    );

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      return json({ ok: false, error: text || "Failed saving subscription" }, 500);
    }

    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
