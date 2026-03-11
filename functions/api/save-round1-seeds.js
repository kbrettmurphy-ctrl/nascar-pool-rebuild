import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json();
    const tournamentId = Number(body?.tournamentId);
    const seeds = Array.isArray(body?.seeds) ? body.seeds : [];

    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
      return json({ ok: false, error: "tournamentId is required" }, 400);
    }

    if (!seeds.length) {
      return json({ ok: false, error: "seeds array is required" }, 400);
    }

    const rows = seeds.map((row) => {
      const playerId = Number(row?.playerId);
      const seed = Number(row?.seed);

      if (!Number.isInteger(playerId) || playerId <= 0 || !Number.isInteger(seed) || seed <= 0) {
        throw new Error("Each seed row needs valid playerId and seed");
      }

      return {
        tournament_id: tournamentId,
        player_id: playerId,
        seed
      };
    });

    const uniquePlayers = new Set(rows.map(r => r.player_id));
    const uniqueSeeds = new Set(rows.map(r => r.seed));

    if (uniquePlayers.size !== rows.length) {
      return json({ ok: false, error: "Each player can only be used once" }, 400);
    }

    if (uniqueSeeds.size !== rows.length) {
      return json({ ok: false, error: "Each seed can only be used once" }, 400);
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Prefer: "resolution=merge-duplicates,return=representation"
    };

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tournament_players?on_conflict=tournament_id,player_id`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(rows)
      }
    );

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      return json(
        { ok: false, error: data?.message || text || "Failed saving round-one seeds" },
        500
      );
    }

    return json({
      ok: true,
      message: `Saved ${Array.isArray(data) ? data.length : 0} round-one seeds`,
      data: Array.isArray(data) ? data : []
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}