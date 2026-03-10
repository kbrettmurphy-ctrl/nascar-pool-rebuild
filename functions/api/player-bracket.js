export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

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

    // Use the same current-race context your player page already uses
    const raceDataRes = await fetch(`${url.origin}/api/player-race-data`, {
      headers: { "Content-Type": "application/json" }
    });
    const raceData = await raceDataRes.json();

    if (!raceData?.ok) {
      throw new Error(raceData?.error || "player-race-data failed");
    }

    const current = raceData?.matchups?.current || {};
    const currentTournamentNumber = Number(current?.tournament || 0);

    if (!currentTournamentNumber) {
      return json({
        ok: true,
        data: {
          tournament: "",
          currentRace: current?.race || "",
          currentRound: current?.round || "",
          rounds: []
        }
      });
    }

    const tournaments = await getJson(
      `/rest/v1/tournaments?select=id,tournament_number,season_year&tournament_number=eq.${currentTournamentNumber}`
    );

    const tournament = Array.isArray(tournaments) && tournaments.length ? tournaments[0] : null;
    if (!tournament) {
      throw new Error(`Tournament ${currentTournamentNumber} not found`);
    }

    const tournamentId = Number(tournament.id);

    const tournamentPlayers = await getJson(
      `/rest/v1/tournament_players?select=player_id,seed&tournament_id=eq.${tournamentId}`
    );

    const seedMap = new Map(
      (tournamentPlayers || []).map(r => [Number(r.player_id), Number(r.seed)])
    );

    const rounds = await getJson(
      `/rest/v1/tournament_rounds?select=round_number,race_id,races(race_name,race_short,race_number)&tournament_id=eq.${tournamentId}&order=round_number.asc`
    );

    const matchupRows = await getJson(
      `/rest/v1/swiss_matchup_results?select=tournament_id,round_number,match_number,player1_id,player1_name,player1_driver_1,player1_driver_2,player1_avg,player2_id,player2_name,player2_driver_1,player2_driver_2,player2_avg,winner_id&tournament_id=eq.${tournamentId}&order=round_number.asc,match_number.asc`
    );

    const raceResults = await getJson(
      `/rest/v1/race_results?select=race_id,driver_id,finishing_position`
    );

    const raceWinnerRows = (raceResults || []).filter(r => Number(r.finishing_position) === 1);
    const raceWinnerDriverByRaceId = new Map();
    for (const row of raceWinnerRows) {
      raceWinnerDriverByRaceId.set(Number(row.race_id), Number(row.driver_id));
    }

    const scoreRows = await getJson(
      `/rest/v1/player_race_scores?select=race_id,player_id,driver_1_name,driver_2_name,driver_1_car_number,driver_2_car_number,driver_1_finish,driver_2_finish`
    );

    const scoreMap = new Map(
      (scoreRows || []).map(r => [`${r.race_id}||${r.player_id}`, r])
    );

    const drivers = await getJson(
      `/rest/v1/drivers?select=id,name`
    );

    const driverIdByName = new Map(
      (drivers || []).map(d => [normalizeName(d.name), Number(d.id)])
    );

    function isPlayerRaceWinner(raceId, scoreRow, sideIdx) {
      const winnerDriverId = raceWinnerDriverByRaceId.get(Number(raceId));
      if (!winnerDriverId || !scoreRow) return false;

      const driverName =
        sideIdx === 1
          ? String(scoreRow.driver_1_name || "").trim()
          : String(scoreRow.driver_2_name || "").trim();

      const driverId = driverIdByName.get(normalizeName(driverName));
      return Number(driverId) === Number(winnerDriverId);
    }

    const roundsOut = (rounds || []).map(rnd => {
      const roundNumber = Number(rnd.round_number);
      const raceId = Number(rnd.race_id);
      const raceLabel =
        String(rnd?.races?.race_short || "").trim() ||
        String(rnd?.races?.race_name || "").trim() ||
        `Race ${rnd?.races?.race_number ?? ""}`.trim();

      const rows = (matchupRows || []).filter(m => Number(m.round_number) === roundNumber);

      return {
        round: roundNumber,
        raceLabel,
        isCurrent: Number(current?.round || 0) === roundNumber,
        matchups: rows.map(m => {
          const p1Id = Number(m.player1_id);
          const p2Id = Number(m.player2_id);

          const p1Score = scoreMap.get(`${raceId}||${p1Id}`) || null;
          const p2Score = scoreMap.get(`${raceId}||${p2Id}`) || null;

          return {
            s1: seedMap.get(p1Id) ?? "—",
            s2: seedMap.get(p2Id) ?? "—",
            p1: m.player1_name || "",
            p2: m.player2_name || "",
            a1: m.player1_avg ?? null,
            a2: m.player2_avg ?? null,
            winner:
              Number(m.winner_id) === p1Id
                ? (m.player1_name || "")
                : Number(m.winner_id) === p2Id
                  ? (m.player2_name || "")
                  : "",
            p1RaceWinner: isPlayerRaceWinner(raceId, p1Score, 1) || isPlayerRaceWinner(raceId, p1Score, 2),
            p2RaceWinner: isPlayerRaceWinner(raceId, p2Score, 1) || isPlayerRaceWinner(raceId, p2Score, 2),
          };
        })
      };
    });

    return json({
      ok: true,
      data: {
        tournament: currentTournamentNumber,
        currentRace: current?.race || "",
        currentRound: current?.round || "",
        rounds: roundsOut
      }
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
