import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    async function getJson(path) {
      const res = await fetch(`${env.SUPABASE_URL}${path}`, { headers });
      const text = await res.text();

      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!res.ok) {
        throw new Error(typeof data === "string" ? data : JSON.stringify(data));
      }

      return data;
    }

    const rows = await getJson(
      `/rest/v1/player_financials?select=player_id,paid,winnings,paidout,players(name)&order=player_id.asc`
    );

    const seasonTotal = 180;
    const owed = [];

    for (const row of rows || []) {
      const name =
        String(row?.players?.name || row?.players?.[0]?.name || "").trim();

      if (!name) continue;

      const paid = Number(row?.paid) || 0;
      const winnings = Number(row?.winnings) || 0;
      const paidout = Number(row?.paidout) || 0;
      const balance = seasonTotal - winnings - paid;

      if (balance < 0) {
        owed.push({
          playerId: Number(row.player_id),
          name,
          paid,
          winnings,
          paidout,
          balance,
          owedAmount: Math.abs(balance),
          remainingToPayout: Math.max(0, Math.abs(balance) - paidout)
        });
      }
    }

    owed.sort((a, b) => b.owedAmount - a.owedAmount || a.name.localeCompare(b.name));

    return json({
      ok: true,
      data: owed
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
