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
      return json({ ok: false, error: "tournamentId required" }, 400);
    }

    if (!seeds.length) {
      return json({ ok: false, error: "No seeds provided" }, 400);
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Prefer: "return=representation"
    };

    // -----------------------------
    // 1. Validate seeds
    // -----------------------------
    const clean = seeds.map(r => ({
      seed: Number(r.seed),
      player_id: Number(r.playerId)
    }));

    if (clean.some(r => !r.seed || !r.player_id)) {
      return json({ ok: false, error: "Invalid seed data" }, 400);
    }

    const uniquePlayers = new Set(clean.map(r => r.player_id));
    if (uniquePlayers.size !== clean.length) {
      return json({ ok: false, error: "Duplicate players in seeds" }, 400);
    }

    // -----------------------------
    // 2. Save seeds
    // -----------------------------
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/tournament_players?tournament_id=eq.${tournamentId}`,
      { method: "DELETE", headers }
    );

    const insertSeeds = clean.map(r => ({
      tournament_id: tournamentId,
      player_id: r.player_id,
      seed: r.seed
    }));

    const seedRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tournament_players`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(insertSeeds)
      }
    );

    if (!seedRes.ok) {
      const text = await seedRes.text();
      return json({ ok: false, error: text || "Failed to save seeds" }, 500);
    }

    // -----------------------------
    // 3. Get Round 1 race
    // -----------------------------
    const raceRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/races?tournament_id=eq.${tournamentId}&round_number=eq.1&select=id`,
      { headers }
    );

    const raceRows = await raceRes.json();
    const raceId = Number(raceRows?.[0]?.id);

    if (!raceId) {
      return json({ ok: false, error: "Round 1 race not found" }, 400);
    }

    // -----------------------------
    // 4. Check if already scored
    // -----------------------------
    const existingRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/swiss_matchup_results?tournament_id=eq.${tournamentId}&round_number=eq.1&race_id=eq.${raceId}`,
      { headers }
    );

    const existingRows = await existingRes.json();

    const alreadyScored = existingRows.some(r =>
      Number(r.player1_avg) > 0 ||
      Number(r.player2_avg) > 0 ||
      Number(r.winner_id) > 0
    );

    if (alreadyScored) {
      return json({
        ok: false,
        error: "Round 1 already has results. Not overwriting."
      }, 400);
    }

    // -----------------------------
    // 5. Clear old unscored rows
    // -----------------------------
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/swiss_matchup_results?tournament_id=eq.${tournamentId}&round_number=eq.1&race_id=eq.${raceId}`,
      { method: "DELETE", headers }
    );

    // -----------------------------
    // 6. Build 1v16 matchups
    // -----------------------------
    const seedMap = new Map(clean.map(r => [r.seed, r.player_id]));

    const pairs = [
      [1,16],[2,15],[3,14],[4,13],
      [5,12],[6,11],[7,10],[8,9]
    ];

    // Get player names
    const playersRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/players?select=id,name`,
      { headers }
    );

    const players = await playersRes.json();
    const nameMap = new Map(players.map(p => [p.id, p.name]));

    const inserts = pairs.map((pair, idx) => {
      const p1 = seedMap.get(pair[0]);
      const p2 = seedMap.get(pair[1]);

      return {
        tournament_id: tournamentId,
        round_number: 1,
        race_id: raceId,
        matchup_number: idx + 1,
        player1_id: p1,
        player1_name: nameMap.get(p1) || "",
        player2_id: p2,
        player2_name: nameMap.get(p2) || "",
        player1_avg: null,
        player2_avg: null,
        winner_id: null
      };
    });

    const insertRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/swiss_matchup_results`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(inserts)
      }
    );

    if (!insertRes.ok) {
      const text = await insertRes.text();
      return json({ ok: false, error: text || "Failed to create matchups" }, 500);
    }

    return json({
      ok: true,
      message: "Seeds saved + Round 1 matchups created.",
      data: inserts
    });

  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
