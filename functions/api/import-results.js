import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json();
    const raceId = Number(body?.raceId);

    if (!Number.isInteger(raceId)) {
      return json({ ok: false, error: "raceId is required" }, 400);
    }

    // 1) Load race metadata from Supabase
    const raceRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/races?id=eq.${raceId}&select=id,season_year,race_number,race_name`,
      {
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      }
    );

    const raceRows = await raceRes.json();
    if (!raceRes.ok || !Array.isArray(raceRows) || !raceRows.length) {
      return json({ ok: false, error: "Race not found" }, 404);
    }

    const race = raceRows[0];

    const roundRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tournament_rounds?race_id=eq.${raceId}&select=tournament_id,round_number&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      }
    );

    const roundRows = await roundRes.json();
    if (!roundRes.ok || !Array.isArray(roundRows) || !roundRows.length) {
      return json({ ok: false, error: `No tournament_rounds row found for race ${raceId}` }, 404);
    }

    const tournamentId = Number(roundRows[0].tournament_id);
    const roundNumber = Number(roundRows[0].round_number);

    // 2) Fetch NASCAR race list
    const raceListUrl = `https://cf.nascar.com/cacher/${race.season_year}/race_list_basic.json`;
    const raceListResp = await fetch(raceListUrl, {
      headers: {
        Accept: "application/json",
        Referer: "https://www.nascar.com/",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!raceListResp.ok) {
      return json({ ok: false, error: `Race list fetch failed: ${raceListResp.status}` }, 502);
    }

    const raceListJson = await raceListResp.json();
    const allCupRaces = Array.isArray(raceListJson?.series_1) ? raceListJson.series_1 : [];

    if (!allCupRaces.length) {
      return json({ ok: false, error: "No Cup races found in NASCAR race list" }, 502);
    }

    // 3) Match DB race_number to NASCAR points race order
    const cupPointsRaces = allCupRaces
      .slice()
      .sort((a, b) => {
        const da = Date.parse(a?.race_date ?? a?.date_scheduled ?? a?.start_time ?? a?.start_date ?? "") || 0;
        const db = Date.parse(b?.race_date ?? b?.date_scheduled ?? b?.start_time ?? b?.start_date ?? "") || 0;
        return da - db;
      })
      .filter((r) => {
        const typeId = Number(r?.race_type_id ?? r?.RaceTypeId ?? r?.raceTypeId);
        const typeName = String(r?.race_type_name ?? r?.RaceTypeName ?? r?.raceTypeName ?? "").toLowerCase();
        const name = String(r?.race_name ?? r?.name ?? "").toLowerCase();

        if (Number.isFinite(typeId)) {
          if (typeId === 1) return true;
          if (!name) return false;
        }

        if (typeName.includes("exhibition")) return false;
        if (name.includes("clash")) return false;
        if (name.includes("duel")) return false;
        if (name.includes("all-star")) return false;
        if (name.includes("shootout")) return false;

        return true;
      });

    const targetRace = cupPointsRaces[race.race_number - 1];
    if (!targetRace) {
      return json({ ok: false, error: `Could not map race_number ${race.race_number}` }, 400);
    }

    const nascarYear = race.season_year;
    const nascarSeriesId = 1;
    const targetRaceId = targetRace.race_id;

    const weekendUrl = `https://cf.nascar.com/cacher/${nascarYear}/${nascarSeriesId}/${targetRaceId}/weekend-feed.json`;

    // 4) Fetch weekend feed
    const weekendResp = await fetch(weekendUrl, {
      headers: {
        Accept: "application/json",
        Referer: "https://www.nascar.com/",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!weekendResp.ok) {
      return json({ ok: false, error: "Weekend feed fetch failed" }, 502);
    }

    const weekendJson = await weekendResp.json();

    // 5) Pick best results rows
    const resultRows = getRaceResultsRows(weekendJson);
    if (!resultRows.length) {
      return json({ ok: false, error: "No race results found" }, 502);
    }

    // 6) Normalize rows
    const normalized = resultRows
      .map((row) => {
        const driverName =
          row?.driver_fullname ||
          row?.DriverNameTag ||
          (row?.DriverFirstName && row?.DriverLastName
            ? `${row.DriverFirstName} ${row.DriverLastName}`
            : "") ||
          row?.driver_name ||
          row?.name ||
          "";

        const pos =
          row?.finishing_position ??
          row?.finish_position ??
          row?.FinishPos ??
          row?.FinPos;

        return {
          driver_name: String(driverName || "").trim(),
          finishing_position: Number(pos),
        };
      })
      .filter(
        (x) =>
          x.driver_name &&
          Number.isFinite(x.finishing_position) &&
          x.finishing_position >= 1
      )
      .sort((a, b) => a.finishing_position - b.finishing_position);

    // 7) Load drivers
    const driversRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/drivers?select=id,name`,
      {
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      }
    );

    const drivers = await driversRes.json();
    if (!driversRes.ok || !Array.isArray(drivers)) {
      return json({ ok: false, error: "Failed to load drivers" }, 500);
    }

    const driverMap = new Map(
      drivers.map((d) => [normalizeName(d.name), { id: d.id, name: d.name }])
    );

    const inserts = [];

    for (const row of normalized) {
      const match = driverMap.get(normalizeName(row.driver_name));
      if (!match) continue;

      inserts.push({
        race_id: raceId,
        finishing_position: row.finishing_position,
        driver_id: match.id,
      });
    }

    if (!inserts.length) {
      return json({
        ok: false,
        error: "No race results matched known drivers",
      }, 500);
    }

    // 8) Clear old race results
    const deleteRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/race_results?race_id=eq.${raceId}`,
      {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      }
    );

    if (!deleteRes.ok) {
      const deleteText = await deleteRes.text();
      return json({
        ok: false,
        error: "Failed to clear old race results",
        details: deleteText,
      }, 500);
    }

    // 9) Insert new rows
    const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/race_results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify(inserts),
    });

    if (!insertRes.ok) {
      const insertText = await insertRes.text();
      return json({
        ok: false,
        error: "Failed to insert race results",
        details: insertText,
      }, 500);
    }

    // 10) Update Swiss results
    const swissUpdateRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/update_swiss_matchup_results`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          p_tournament_id: tournamentId,
        }),
      }
    );

    const swissUpdateRaw = await swissUpdateRes.text();

    let swissUpdateParsed = null;
    try {
      swissUpdateParsed = swissUpdateRaw ? JSON.parse(swissUpdateRaw) : null;
    } catch {
      swissUpdateParsed = swissUpdateRaw;
    }

    if (!swissUpdateRes.ok) {
      return json({
        ok: false,
        error: "update_swiss_matchup_results failed",
        status: swissUpdateRes.status,
        statusText: swissUpdateRes.statusText,
        details: swissUpdateParsed,
      }, 500);
    }

    // 11) Generate NEXT Swiss round after current round completes
    const nextRoundNumber = roundNumber + 1;
    let pairingsResult = null;

    if (nextRoundNumber <= 4) {
      const pairingsRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/rpc/generate_swiss_round_pairings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: env.SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
            Accept: "application/json",
          },
          body: JSON.stringify({
            p_tournament_id: tournamentId,
            p_round_number: nextRoundNumber,
          }),
        }
      );

      const pairingsRaw = await pairingsRes.text();

      try {
        pairingsResult = pairingsRaw ? JSON.parse(pairingsRaw) : null;
      } catch {
        pairingsResult = pairingsRaw;
      }

      if (!pairingsRes.ok) {
        return json({
          ok: false,
          error: "generate_swiss_round_pairings failed",
          status: pairingsRes.status,
          statusText: pairingsRes.statusText,
          details: pairingsResult,
        }, 500);
      }
    }

    // 12) Recalculate and sync player_financials.winnings
    const winningsSync = await syncPlayerFinancialWinnings(env);

    return json({
      ok: true,
      raceId,
      tournamentId,
      round: roundNumber,
      generatedRound: nextRoundNumber <= 4 ? nextRoundNumber : null,
      insertedResults: inserts.length,
      swissUpdate: swissUpdateParsed,
      pairings: pairingsResult,
      winningsSync,
    });

  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

async function syncPlayerFinancialWinnings(env) {
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  };

  const writeHeaders = {
    "Content-Type": "application/json",
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    Prefer: "return=representation",
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

  function isCompletedMatch(row) {
    const a1 = Number(row.player1_avg);
    const a2 = Number(row.player2_avg);
    const winnerId = Number(row.winner_id);

    return (
      Number.isFinite(a1) &&
      Number.isFinite(a2) &&
      a1 > 0 &&
      a2 > 0 &&
      Number.isFinite(winnerId) &&
      winnerId > 0
    );
  }

  function buildTournamentStats(rows, scoreMap) {
    const statsMap = new Map();

    function getPlayerRow(playerId, playerName) {
      const key = String(playerId);
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          player_id: Number(playerId),
          player: String(playerName || "").trim(),
          W: 0,
          L: 0,
          avg_sum: 0,
          match_count: 0,
          min_finish: 99999,
        });
      }
      return statsMap.get(key);
    }

    function updateMinFinish(playerRow, scoreRow) {
      if (!scoreRow) return;

      const f1 = Number(scoreRow.driver_1_finish);
      const f2 = Number(scoreRow.driver_2_finish);

      if (Number.isFinite(f1) && f1 > 0) {
        playerRow.min_finish = Math.min(playerRow.min_finish, f1);
      }
      if (Number.isFinite(f2) && f2 > 0) {
        playerRow.min_finish = Math.min(playerRow.min_finish, f2);
      }
    }

    for (const row of rows || []) {
      if (!isCompletedMatch(row)) continue;

      const p1Id = Number(row.player1_id);
      const p2Id = Number(row.player2_id);
      const raceId = Number(row.race_id);

      const p1 = getPlayerRow(p1Id, row.player1_name);
      const p2 = getPlayerRow(p2Id, row.player2_name);

      const a1 = Number(row.player1_avg);
      const a2 = Number(row.player2_avg);
      const winnerId = Number(row.winner_id);

      p1.match_count += 1;
      p2.match_count += 1;

      p1.avg_sum += a1;
      p2.avg_sum += a2;

      if (winnerId === p1Id) {
        p1.W += 1;
        p2.L += 1;
      } else if (winnerId === p2Id) {
        p2.W += 1;
        p1.L += 1;
      }

      updateMinFinish(p1, scoreMap.get(`${raceId}||${p1Id}`) || null);
      updateMinFinish(p2, scoreMap.get(`${raceId}||${p2Id}`) || null);
    }

    const out = Array.from(statsMap.values()).map((r) => {
      const rawAvg = r.match_count > 0 ? (r.avg_sum / r.match_count) : 0;
      const rawWinPct = r.match_count > 0 ? (r.W / r.match_count) : 0;

      return {
        rank: 0,
        player_id: r.player_id,
        player: r.player,
        W: r.W,
        L: r.L,
        __rawWinPct: rawWinPct,
        __rawAvg: rawAvg,
        __minFinish: r.min_finish,
      };
    });

    out.sort((a, b) => {
      if (b.__rawWinPct !== a.__rawWinPct) return b.__rawWinPct - a.__rawWinPct;
      if (a.__rawAvg !== b.__rawAvg) return a.__rawAvg - b.__rawAvg;
      if (a.__minFinish !== b.__minFinish) return a.__minFinish - b.__minFinish;
      return String(a.player).localeCompare(String(b.player));
    });

    out.forEach((row, idx) => {
      row.rank = idx + 1;
    });

    return out;
  }

  const [
    players,
    financialRows,
    drivers,
    raceResults,
    scoreRows,
    tournaments,
    matchupRows,
  ] = await Promise.all([
    getJson(`/rest/v1/players?select=id,name&order=id.asc`),
    getJson(`/rest/v1/player_financials?select=player_id,paid,winnings,paidout`),
    getJson(`/rest/v1/drivers?select=id,name`),
    getJson(`/rest/v1/race_results?select=race_id,driver_id,finishing_position`),
    getJson(`/rest/v1/player_race_scores?select=race_id,player_id,driver_1_name,driver_2_name,driver_1_finish,driver_2_finish`),
    getJson(`/rest/v1/tournaments?select=id,tournament_number&order=tournament_number.asc`),
    getJson(`/rest/v1/swiss_matchup_results?select=tournament_id,round_number,race_id,player1_id,player1_name,player1_avg,player2_id,player2_name,player2_avg,winner_id&order=tournament_id.asc,round_number.asc`),
  ]);

  const winningsByPlayerId = new Map();
  for (const p of players || []) {
    winningsByPlayerId.set(Number(p.id), 0);
  }

  // $25 if player has the winning driver of the race
  const driverIdByName = new Map(
    (drivers || []).map((d) => [normalizeName(d.name), Number(d.id)])
  );

  const raceWinnerDriverByRaceId = new Map();
  for (const row of raceResults || []) {
    if (Number(row.finishing_position) === 1) {
      raceWinnerDriverByRaceId.set(Number(row.race_id), Number(row.driver_id));
    }
  }

  for (const row of scoreRows || []) {
    const playerId = Number(row.player_id);
    const raceId = Number(row.race_id);
    const winningDriverId = raceWinnerDriverByRaceId.get(raceId);

    if (!playerId || !winningDriverId) continue;

    const d1 = driverIdByName.get(normalizeName(row.driver_1_name || ""));
    const d2 = driverIdByName.get(normalizeName(row.driver_2_name || ""));

    if (Number(d1) === winningDriverId || Number(d2) === winningDriverId) {
      winningsByPlayerId.set(
        playerId,
        (winningsByPlayerId.get(playerId) || 0) + 25
      );
    }
  }

  // Tournament payouts only after tournament is complete
  const scoreMap = new Map(
    (scoreRows || []).map((r) => [`${r.race_id}||${r.player_id}`, r])
  );

  const payoutByRank = {
    1: 100,
    2: 60,
    3: 40,
    4: 20,
  };

  for (const t of tournaments || []) {
    const tournamentId = Number(t.id);

    const rows = (matchupRows || []).filter(
      (r) => Number(r.tournament_id) === tournamentId
    );

    const built = buildTournamentStats(rows, scoreMap);
    const tournamentComplete =
      built.length === 16 &&
      built.every((x) => (Number(x.W) + Number(x.L)) >= 4);

    if (!tournamentComplete) continue;

    for (const row of built) {
      const payout = payoutByRank[Number(row.rank)] || 0;
      if (!payout) continue;

      winningsByPlayerId.set(
        Number(row.player_id),
        (winningsByPlayerId.get(Number(row.player_id)) || 0) + payout
      );
    }
  }

  const existingByPlayerId = new Map(
    (financialRows || []).map((r) => [Number(r.player_id), r])
  );

  let updatedCount = 0;
  let createdCount = 0;

  for (const p of players || []) {
    const playerId = Number(p.id);
    const winnings = Number(winningsByPlayerId.get(playerId) || 0);
    const existing = existingByPlayerId.get(playerId);

    if (existing) {
      const currentWinnings = Number(existing.winnings || 0);
      if (currentWinnings === winnings) continue;

      const patchRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/player_financials?player_id=eq.${playerId}`,
        {
          method: "PATCH",
          headers: writeHeaders,
          body: JSON.stringify({ winnings }),
        }
      );

      const patchText = await patchRes.text();
      if (!patchRes.ok) {
        throw new Error(`Failed to update winnings for player ${playerId}: ${patchText}`);
      }

      updatedCount += 1;
    } else if (winnings > 0) {
      const postRes = await fetch(`${env.SUPABASE_URL}/rest/v1/player_financials`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify([{
          player_id: playerId,
          paid: 0,
          winnings,
          paidout: 0,
        }]),
      });

      const postText = await postRes.text();
      if (!postRes.ok) {
        throw new Error(`Failed to create winnings row for player ${playerId}: ${postText}`);
      }

      createdCount += 1;
    }
  }

  const totalWinnings = Array.from(winningsByPlayerId.values()).reduce(
    (sum, n) => sum + Number(n || 0),
    0
  );

  return {
    updatedCount,
    createdCount,
    totalWinnings,
  };
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRaceResultsRows(feed) {
  const wrRes = Array.isArray(feed?.weekend_race?.[0]?.results)
    ? feed.weekend_race[0].results
    : [];

  if (
    wrRes.length &&
    wrRes.some((r) =>
      Number.isFinite(
        Number(
          r?.finishing_position ??
          r?.finish_position ??
          r?.FinishPos ??
          r?.FinPos
        )
      )
    )
  ) {
    return wrRes;
  }

  const runs = Array.isArray(feed?.weekend_runs) ? feed.weekend_runs : [];
  if (runs.length) {
    const scored = runs
      .map((run) => {
        const name = String(run?.run_name || run?.name || "").toLowerCase();
        const rows = Array.isArray(run?.results) ? run.results : [];

        const finishCount = rows.reduce((c, r) => {
          const p = Number(
            r?.finishing_position ??
            r?.finish_position ??
            r?.FinishPos ??
            r?.FinPos
          );
          return c + (Number.isFinite(p) ? 1 : 0);
        }, 0);

        const maxLaps = rows.reduce((m, r) => {
          const n = Number(
            r?.laps_completed ??
            r?.LapsCompleted ??
            r?.laps ??
            0
          );
          return Number.isFinite(n) ? Math.max(m, n) : m;
        }, 0);

        let score = 0;
        score += finishCount * 10;

        if (name.includes("race")) score += 200;
        if (name.includes("results")) score += 120;
        if (name.includes("starting")) score -= 500;
        if (name.includes("lineup")) score -= 500;
        if (name.includes("qual")) score -= 800;
        if (name.includes("practice")) score -= 800;
        if (name.includes("stage")) score -= 200;

        if (maxLaps >= 10) score += 80;
        if (maxLaps >= 50) score += 200;
        if (maxLaps >= 150) score += 300;

        score += Math.min(rows.length, 60);

        return { score, rows };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.rows || [];
    if (
      best.length &&
      best.some((r) =>
        Number.isFinite(
          Number(
            r?.finishing_position ??
            r?.finish_position ??
            r?.FinishPos ??
            r?.FinPos
          )
        )
      )
    ) {
      return best;
    }
  }

  return [];
}
