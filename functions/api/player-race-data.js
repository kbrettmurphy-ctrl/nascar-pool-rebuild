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

    // Tournament rounds + display race names
    const rounds = await getJson(
      `/rest/v1/tournament_rounds?select=id,tournament_id,round_number,race_id,tournaments(tournament_number),races(race_name,race_short)&order=tournament_id.asc,round_number.asc`
    );

    // All matchup rows already calculated by your backend
    const matchupRows = await getJson(
      `/rest/v1/swiss_matchup_results?select=tournament_id,round_number,race_id,match_number,player1_id,player1_name,player1_driver_1,player1_driver_2,player1_avg,player2_id,player2_name,player2_driver_1,player2_driver_2,player2_avg&order=tournament_id.asc,round_number.asc,match_number.asc`
    );

    // Pull qualifying-position numbers from the score view
    const scoreRows = await getJson(
      `/rest/v1/player_race_scores?select=race_id,player_id,driver_1_qualifying_position,driver_2_qualifying_position`
    );

    // Which races have results at all
    const raceResults = await getJson(
      `/rest/v1/race_results?select=race_id`
    );

    // Race winners (P1 only)
    const winners = await getJson(
      `/rest/v1/race_results?finishing_position=eq.1&select=race_id,drivers(name)`
    );

    const completedRaceIds = new Set((raceResults || []).map(r => Number(r.race_id)));

    const winnerByRaceId = new Map();
    for (const row of winners || []) {
      const driverName =
        row?.drivers?.name ||
        row?.drivers?.[0]?.name ||
        "";
      winnerByRaceId.set(Number(row.race_id), String(driverName || "").trim());
    }

    const scoreMap = new Map();
    for (const row of scoreRows || []) {
      scoreMap.set(
        `${row.race_id}||${row.player_id}`,
        {
          p1: row.driver_1_qualifying_position,
          p2: row.driver_2_qualifying_position,
        }
      );
    }

    const roundMeta = [];
    for (const r of rounds || []) {
      const tournament = Number(r?.tournaments?.tournament_number ?? r?.tournament_id);
      const round = Number(r?.round_number);
      const raceId = Number(r?.race_id);
      const race =
        String(r?.races?.race_short || "").trim() ||
        String(r?.races?.race_name || "").trim();

      roundMeta.push({
        tournament,
        tournamentId: Number(r.tournament_id),
        round,
        raceId,
        race,
      });
    }

    // Figure out "current" like your old context logic:
    // first incomplete race, otherwise last race in order
    let currentMeta = null;
    for (const r of roundMeta) {
      if (!completedRaceIds.has(r.raceId)) {
        currentMeta = r;
        break;
      }
    }
    if (!currentMeta && roundMeta.length) {
      currentMeta = roundMeta[roundMeta.length - 1];
    }

    const raceList = roundMeta.map(r => ({
      tournament: r.tournament,
      round: r.round,
      race: r.race,
    }));

    const races = {};

    for (const r of roundMeta) {
      const key = `${r.tournament}||${r.race}`;

      const rows = (matchupRows || []).filter(
        m =>
          Number(m.tournament_id) === r.tournamentId &&
          Number(m.round_number) === r.round
      );

      races[key] = {
        tournament: r.tournament,
        race: r.race,
        round: r.round,
        raceWinnerDriver: winnerByRaceId.get(r.raceId) || "",
        matchups: rows.map(m => {
          const p1Nums = scoreMap.get(`${r.raceId}||${m.player1_id}`) || {};
          const p2Nums = scoreMap.get(`${r.raceId}||${m.player2_id}`) || {};

          return {
            p1: m.player1_name || "",
            p2: m.player2_name || "",
            p1Drivers: [m.player1_driver_1 || "", m.player1_driver_2 || ""],
            p2Drivers: [m.player2_driver_1 || "", m.player2_driver_2 || ""],
            p1Nums: [p1Nums.p1 ?? "", p1Nums.p2 ?? ""],
            p2Nums: [p2Nums.p1 ?? "", p2Nums.p2 ?? ""],
          };
        }),
        eliminated: [],
      };
    }

    return json({
      ok: true,
      raceList,
      matchups: {
        current: currentMeta
          ? {
              tournament: currentMeta.tournament,
              race: currentMeta.race,
              round: currentMeta.round,
            }
          : null,
        races,
      },
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
