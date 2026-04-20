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

    const writeHeaders = {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Prefer: "resolution=merge-duplicates,return=representation"
    };

    const readHeaders = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
    };

    // --------------------------------------------------
    // 1) Validate and normalize incoming seed rows
    // --------------------------------------------------
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

    if (rows.length !== 16) {
      return json({ ok: false, error: "Round 1 requires exactly 16 seeded players" }, 400);
    }

    // --------------------------------------------------
    // 2) Save seeds to tournament_players
    // --------------------------------------------------
    const seedRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tournament_players?on_conflict=tournament_id,player_id`,
      {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify(rows)
      }
    );

    const seedText = await seedRes.text();
    const seedData = seedText ? JSON.parse(seedText) : null;

    if (!seedRes.ok) {
      return json(
        { ok: false, error: seedData?.message || seedText || "Failed saving round-one seeds" },
        500
      );
    }

    // --------------------------------------------------
    // 3) Find this tournament's Round 1 race via tournament_rounds
    //    We need raceId only for checking the VIEW.
    // --------------------------------------------------
    const roundRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tournament_rounds?select=tournament_id,round_number,race_id&tournament_id=eq.${tournamentId}&round_number=eq.1&limit=1`,
      { headers: readHeaders }
    );

    const roundText = await roundRes.text();
    const roundRows = roundText ? JSON.parse(roundText) : [];

    if (!roundRes.ok) {
      return json({ ok: false, error: roundText || "Failed to load tournament_rounds" }, 500);
    }

    const roundOne = Array.isArray(roundRows) && roundRows.length ? roundRows[0] : null;
    const raceId = Number(roundOne?.race_id);

    if (!raceId) {
      return json({ ok: false, error: "Round 1 race not found" }, 400);
    }

    // --------------------------------------------------
    // 4) Refuse overwrite if Round 1 already has scored data
    //    Read from swiss_matchup_results VIEW
    // --------------------------------------------------
    const existingViewRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/swiss_matchup_results?select=tournament_id,round_number,race_id,match_number,player1_avg,player2_avg,winner_id&tournament_id=eq.${tournamentId}&round_number=eq.1&race_id=eq.${raceId}&order=match_number.asc`,
      { headers: readHeaders }
    );

    const existingViewText = await existingViewRes.text();
    const existingViewRows = existingViewText ? JSON.parse(existingViewText) : [];

    if (!existingViewRes.ok) {
      return json({ ok: false, error: existingViewText || "Failed checking existing Round 1 matchups" }, 500);
    }

    const hasScoredRoundOne = (existingViewRows || []).some(r => {
      const a1 = Number(r?.player1_avg);
      const a2 = Number(r?.player2_avg);
      const winnerId = Number(r?.winner_id);

      return (
        (Number.isFinite(a1) && a1 > 0) ||
        (Number.isFinite(a2) && a2 > 0) ||
        (Number.isFinite(winnerId) && winnerId > 0)
      );
    });

    if (hasScoredRoundOne) {
      return json({
        ok: false,
        error: "Round 1 already has results. Refusing to overwrite scored matchups."
      }, 400);
    }

    // --------------------------------------------------
    // 5) Clear old unscored Round 1 pairings
    //    WRITE to swiss_pairings base table
    //    NOTE: no race_id column here
    // --------------------------------------------------
    const deleteRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/swiss_pairings?tournament_id=eq.${tournamentId}&round_number=eq.1`,
      {
        method: "DELETE",
        headers: readHeaders
      }
    );

    if (!deleteRes.ok) {
      const deleteText = await deleteRes.text();
      return json({ ok: false, error: deleteText || "Failed clearing old Round 1 pairings" }, 500);
    }

    // --------------------------------------------------
    // 6) Build actual Round 1 pairings from seeds
    // --------------------------------------------------
    const bySeed = new Map(rows.map(r => [Number(r.seed), Number(r.player_id)]));
    const seedPairs = [
      [1, 16],
      [2, 15],
      [3, 14],
      [4, 13],
      [5, 12],
      [6, 11],
      [7, 10],
      [8, 9]
    ];

    const pairingRows = seedPairs.map(([s1, s2], idx) => {
      const p1Id = bySeed.get(s1);
      const p2Id = bySeed.get(s2);

      if (!p1Id || !p2Id) {
        throw new Error(`Missing seeded player for pairing ${s1} vs ${s2}`);
      }

      return {
        tournament_id: tournamentId,
        round_number: 1,
        match_number: idx + 1,
        player1_id: p1Id,
        player2_id: p2Id
      };
    });

    // --------------------------------------------------
    // 7) Insert real Round 1 rows into swiss_pairings
    // --------------------------------------------------
    const insertRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/swiss_pairings`,
      {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify(pairingRows)
      }
    );

    const insertText = await insertRes.text();
    const insertData = insertText ? JSON.parse(insertText) : [];

    if (!insertRes.ok) {
      return json({ ok: false, error: insertText || "Failed creating Round 1 pairings" }, 500);
    }

    return json({
      ok: true,
      message: `Saved ${Array.isArray(seedData) ? seedData.length : rows.length} seeds and created ${Array.isArray(insertData) ? insertData.length : pairingRows.length} Round 1 pairings`,
      data: {
        tournamentId,
        roundNumber: 1,
        raceId,
        seedsSaved: Array.isArray(seedData) ? seedData.length : rows.length,
        roundOnePairingsCreated: Array.isArray(insertData) ? insertData.length : pairingRows.length,
        pairings: Array.isArray(insertData) ? insertData : pairingRows
      }
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
