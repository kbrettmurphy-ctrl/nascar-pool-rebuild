import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json();
    const tournamentId = Number(body?.tournamentId);
    const seeds = Array.isArray(body?.seeds) ? body.seeds : [];

    if (!Number.isInteger(tournamentId)) {
      return json({ ok: false, error: "tournamentId is required" }, 400);
    }

    if (!seeds.length) {
      return json({ ok: false, error: "seeds array is required" }, 400);
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    for (const row of seeds) {
      const playerId = Number(row?.playerId);
      const seed = Number(row?.seed);

      if (!Number.isInteger(playerId) || !Number.isInteger(seed)) {
        return json({ ok: false, error: "Each seed row needs playerId and seed" }, 400);
      }

      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/tournament_players?tournament_id=eq.${tournamentId}&player_id=eq.${playerId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ seed })
        }
      );

      if (!res.ok) {
        const text = await res.text();
        return json({ ok: false, error: text || `Failed updating player ${playerId}` }, 500);
      }
    }

    return json({
      ok: true,
      message: `Saved ${seeds.length} round-one seeds`,
      data: { tournamentId, count: seeds.length }
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
