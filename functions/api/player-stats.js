export async function onRequestGet(context) {
  try {
    const { env } = context;

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

    const matchupRows = await getJson(
      `/rest/v1/swiss_matchup_results?select=tournament_id,round_number,race_id,player1_id,player1_name,player1_avg,player2_id,player2_name,player2_avg,winner_id&order=tournament_id.asc,round_number.asc`
    );

    const scoreRows = await getJson(
      `/rest/v1/player_race_scores?select=race_id,player_id,driver_1_name,driver_2_name,driver_1_finish,driver_2_finish`
    );

    const raceResults = await getJson(
      `/rest/v1/race_results?select=race_id,driver_id,finishing_position`
    );

    const tournaments = await getJson(
      `/rest/v1/tournaments?select=id,tournament_number&order=tournament_number.asc`
    );

    const scoreMap = new Map(
      (scoreRows || []).map(r => [`${r.race_id}||${r.player_id}`, r])
    );

    const raceWinnerDriverByRaceId = new Map();
    for (const row of raceResults || []) {
      if (Number(row.finishing_position) === 1) {
        raceWinnerDriverByRaceId.set(Number(row.race_id), Number(row.driver_id));
      }
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

    function buildStatsMap(rows) {
      const statsMap = new Map();

      function getPlayerRow(playerId, playerName) {
        const key = String(playerId);
        if (!statsMap.has(key)) {
          statsMap.set(key, {
            player_id: Number(playerId),
            Name: String(playerName || "").trim(),
            W: 0,
            L: 0,
            avg_sum: 0,
            match_count: 0,
            min_finish: 99999
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
        const p1Id = Number(row.player1_id);
        const p2Id = Number(row.player2_id);
        const raceId = Number(row.race_id);

        const p1 = getPlayerRow(p1Id, row.player1_name);
        const p2 = getPlayerRow(p2Id, row.player2_name);

        const a1 = Number(row.player1_avg);
        const a2 = Number(row.player2_avg);
        const winnerId = Number(row.winner_id);

        if (!isCompletedMatch(row)) {
          continue;
        }

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

      const out = Array.from(statsMap.values()).map(r => {
        const rawAvg = r.match_count > 0 ? (r.avg_sum / r.match_count) : 0;
        const rawWinPct = r.match_count > 0 ? (r.W / r.match_count) : 0;

        let winPctDisplay = rawWinPct.toFixed(3);
        if (winPctDisplay.startsWith("0")) {
          winPctDisplay = winPctDisplay.slice(1);
        }

        return {
          rank: 0,
          player: r.Name,
          player_id: r.player_id,
          W: r.W,
          L: r.L,
          Avg: rawAvg.toFixed(2),
          "W%": winPctDisplay,
          __rawWinPct: rawWinPct,
          __rawAvg: rawAvg,
          __minFinish: r.min_finish
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

    // OVERALL
    const overallRaw = buildStatsMap(matchupRows || []);
    const overall = overallRaw.map(r => ({
      Rank: r.rank,
      Name: r.player,
      W: r.W,
      L: r.L,
      Avg: r.Avg,
      "W%": r["W%"]
    }));

    // TOURNAMENT RANKS
    const tournamentHeaders = [];
    const tournamentsOut = {};

    for (const t of tournaments || []) {
      const tournamentId = Number(t.id);
      const tournamentNumber = Number(t.tournament_number);
      const label = `Tournament ${tournamentNumber}`;

      const rows = (matchupRows || []).filter(
        r => Number(r.tournament_id) === tournamentId
      );

      const built = buildStatsMap(rows).map(r => ({
        rank: r.rank,
        player: r.player,
        W: r.W,
        L: r.L,
        Avg: r.Avg
      }));

      tournamentHeaders.push(label);
      tournamentsOut[label] = built;
    }

    // WINS
    const winsMap = new Map();

    function getWinsRow(playerId, playerName) {
      const key = String(playerId);
      if (!winsMap.has(key)) {
        winsMap.set(key, {
          player: String(playerName || "").trim(),
          raceWins: 0,
          bracketWins: 0,
          tourneyWins: 0
        });
      }
      return winsMap.get(key);
    }

    for (const row of matchupRows || []) {
      if (!isCompletedMatch(row)) continue;

      const winnerId = Number(row.winner_id);
      if (!winnerId) continue;

      let winnerName = "";
      if (winnerId === Number(row.player1_id)) winnerName = row.player1_name || "";
      if (winnerId === Number(row.player2_id)) winnerName = row.player2_name || "";

      const w = getWinsRow(winnerId, winnerName);
      w.bracketWins += 1;
    }

    const drivers = await getJson(
      `/rest/v1/drivers?select=id,name`
    );

    const driverIdByName = new Map(
      (drivers || []).map(d => [normalizeName(d.name), Number(d.id)])
    );

    for (const row of scoreRows || []) {
      const raceId = Number(row.race_id);
      const playerId = Number(row.player_id);
      const winningDriverId = raceWinnerDriverByRaceId.get(raceId);
      if (!winningDriverId) continue;

      const d1 = driverIdByName.get(normalizeName(row.driver_1_name || ""));
      const d2 = driverIdByName.get(normalizeName(row.driver_2_name || ""));

      if (Number(d1) === Number(winningDriverId) || Number(d2) === Number(winningDriverId)) {
        const playerName =
          overallRaw.find(x => Number(x.player_id) === playerId)?.player || "";
        const w = getWinsRow(playerId, playerName);
        w.raceWins += 1;
      }
    }

    for (const t of tournaments || []) {
      const label = `Tournament ${Number(t.tournament_number)}`;
      const rows = tournamentsOut[label] || [];
      const winner = rows.find(r => Number(r.rank) === 1);
      if (winner) {
        const found = overallRaw.find(x => String(x.player) === String(winner.player));
        if (found) {
          const w = getWinsRow(Number(found.player_id), found.player);
          w.tourneyWins += 1;
        }
      }
    }

    const wins = {};
    for (const row of overallRaw) {
      const found = winsMap.get(String(row.player_id)) || {
        player: row.player,
        raceWins: 0,
        bracketWins: 0,
        tourneyWins: 0
      };

      wins[row.player] = {
        raceWins: found.raceWins,
        bracketWins: found.bracketWins,
        tourneyWins: found.tourneyWins
      };
    }

    // DRIVER USAGE
    const driversByPlayer = {};

    for (const row of scoreRows || []) {
      const playerName =
        overallRaw.find(x => Number(x.player_id) === Number(row.player_id))?.player || "";

      if (!playerName) continue;

      if (!driversByPlayer[playerName]) {
        driversByPlayer[playerName] = {};
      }

      const d1 = String(row.driver_1_name || "").trim();
      const d2 = String(row.driver_2_name || "").trim();

      if (d1) {
        driversByPlayer[playerName][d1] = (driversByPlayer[playerName][d1] || 0) + 1;
      }
      if (d2) {
        driversByPlayer[playerName][d2] = (driversByPlayer[playerName][d2] || 0) + 1;
      }
    }

    const driversOut = {};
    for (const [playerName, driverCounts] of Object.entries(driversByPlayer)) {
      driversOut[playerName] = Object.entries(driverCounts)
        .map(([driver, count]) => ({ driver, count }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return String(a.driver).localeCompare(String(b.driver));
        });
    }

    // H2H
    const h2hBuckets = new Map();

    function getH2HRow(playerName, opponentName) {
      const key = `${playerName}||${opponentName}`;
      if (!h2hBuckets.has(key)) {
        h2hBuckets.set(key, {
          player: playerName,
          opponent: opponentName,
          wins: 0,
          losses: 0
        });
      }
      return h2hBuckets.get(key);
    }

    for (const row of matchupRows || []) {
      if (!isCompletedMatch(row)) continue;

      const p1Id = Number(row.player1_id);
      const p2Id = Number(row.player2_id);
      const p1Name = String(row.player1_name || "").trim();
      const p2Name = String(row.player2_name || "").trim();
      const winnerId = Number(row.winner_id);

      if (!p1Name || !p2Name) continue;

      const p1vsP2 = getH2HRow(p1Name, p2Name);
      const p2vsP1 = getH2HRow(p2Name, p1Name);

      if (winnerId === p1Id) {
        p1vsP2.wins += 1;
        p2vsP1.losses += 1;
      } else if (winnerId === p2Id) {
        p2vsP1.wins += 1;
        p1vsP2.losses += 1;
      }
    }

    const h2h = {};
    for (const row of overallRaw) {
      const playerName = row.player;
      const rows = Array.from(h2hBuckets.values())
        .filter(x => x.player === playerName)
        .map(x => ({
          opponent: x.opponent,
          wins: x.wins,
          losses: x.losses,
          record: `(${x.wins}-${x.losses})`
        }))
        .sort((a, b) => {
          const aMatches = a.wins + a.losses;
          const bMatches = b.wins + b.losses;
          if (bMatches !== aMatches) return bMatches - aMatches;
          return String(a.opponent).localeCompare(String(b.opponent));
        });

      h2h[playerName] = rows;
    }

    return json({
      ok: true,
      data: {
        overallHeaders: ["Rank", "Name", "W", "L", "Avg", "W%"],
        overall,
        tournamentHeaders,
        tournaments: tournamentsOut,
        wins,
        drivers: driversOut,
        h2h
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
