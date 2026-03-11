import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json();
    const playerId = Number(body?.playerId);
    const amount = Number(body?.amount);

    if (!Number.isInteger(playerId)) {
      return json({ ok: false, error: "playerId is required" }, 400);
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ ok: false, error: "amount must be greater than 0" }, 400);
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Prefer: "return=representation"
    };

    const existingRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/player_financials?player_id=eq.${playerId}&select=player_id,paid`,
      { headers }
    );
    const existingRows = await existingRes.json();

    const currentPaid = Number(existingRows?.[0]?.paid || 0);
    const nextPaid = currentPaid + amount;

    let res;
    if (existingRows?.length) {
      res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/player_financials?player_id=eq.${playerId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ paid: nextPaid })
        }
      );
    } else {
      res = await fetch(`${env.SUPABASE_URL}/rest/v1/player_financials`, {
        method: "POST",
        headers,
        body: JSON.stringify([{ player_id: playerId, paid: amount, winnings: 0 }])
      });
    }

    const text = await res.text();
    if (!res.ok) {
      return json({ ok: false, error: text || "Failed to add funds" }, 500);
    }

    return json({
      ok: true,
      message: `Added $${amount.toFixed(2)} to player ${playerId}`,
      data: { playerId, added: amount, paid: nextPaid }
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
