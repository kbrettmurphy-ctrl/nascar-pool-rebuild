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

    // 1) All races for display/current-race logic
    const races = await getJson(
      `/rest/v1/races?select=id,race_number,race_name,race_short&order=race_number.asc`
    );

    // 2) Tournament round mapping
    const rounds = await getJson(
      `/rest/v1/tournament_rounds?select=id,tournament_id,round_number,race_id,tournaments(id,tournament_number),races(id,race_name,race_short,race_number)&order=tournament_id.asc,round_number.asc`
    );

    // 3) Matchup rows with averages already computed by the view
    const matchupRows = await getJson(
      `/rest/v1/swiss_matchup_results?select=tournament_id,round_number,race_id,match_number,player1_id,player1_name,player1_driver_1,player1_driver_2,player1_avg,player2_id,player2_name,player2_driver_1,player2_driver_2,player2_avg,winner_id,loser_id&order=tournament_id.asc,round_number.asc,match_number.asc`
    );

    // 4) Qualifying-position numbers from player_race_scores
    const scoreRows = await getJson(
      `/rest/v1/player_race_scores?select=race_id,player_id,driver_1_qualifying_position,driver_2_qualifying_position`
    );

    // 5) Which races have any results
    const raceResults = await getJson(
      `/rest/v1/race_results?select=race_id`
    );

    // 6) Race winners (finishing_position = 1)
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

    // Build tournament round metadata
    const roundMeta = [];
    for (const r of rounds || []) {
      const tournamentId = Number(r?.tournament_id);
      const tournament = Number(r?.tournaments?.tournament_number ?? tournamentId);
      const round = Number(r?.round_number);
      const raceId = Number(r?.race_id);

      const race =
        String(r?.races?.race_short || "").trim() ||
        String(r?.races?.race_name || "").trim();

      const raceNumber = Number(r?.races?.race_number ?? 0);

      roundMeta.push({
        tournamentId,
        tournament,
        round,
        raceId,
        race,
        raceNumber,
      });
    }

    // Build quick lookup by race_id for tournament/round context
    const roundByRaceId = new Map();
    for (const r of roundMeta) {
      roundByRaceId.set(r.raceId, r);
    }

    // CURRENT RACE LOGIC:
    // use the races table, not just tournament_rounds.
    // first race with no results; fallback to highest race_number.
    let currentRaceRow =
      (races || []).find(r => !completedRaceIds.has(Number(r.id))) ||
      ((races || []).length ? races[races.length - 1] : null);

    let currentMeta = null;

    if (currentRaceRow) {
      const raceId = Number(currentRaceRow.id);
      const mapped = roundByRaceId.get(raceId);

      if (mapped) {
        currentMeta = {
          tournament: mapped.tournament,
          race: mapped.race,
          round: mapped.round,
          raceId: mapped.raceId,
          raceNumber: mapped.raceNumber,
        };
      } else {
        currentMeta = {
          tournament: null,
          race:
            String(currentRaceRow.race_short || "").trim() ||
            String(currentRaceRow.race_name || "").trim(),
          round: null,
          raceId,
          raceNumber: Number(currentRaceRow.race_number ?? 0),
        };
      }
    }

    // Race dropdown should include only tournament races for now,
    // because that's how your current page expects the historical matchup set.
    const raceList = roundMeta.map(r => ({
      tournament: r.tournament,
      round: r.round,
      race: r.race,
    }));

    const racesBlob = {};

    for (const r of roundMeta) {
      const key = `${r.tournament}||${r.race}`;

      const rows = (matchupRows || []).filter(
        m =>
          Number(m.tournament_id) === r.tournamentId &&
          Number(m.round_number) === r.round
      );

      racesBlob[key] = {
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

            // THESE are what your old page wants for past-race display
            a1: m.player1_avg ?? null,
            a2: m.player2_avg ?? null,

            winner:
              Number(m.winner_id) === Number(m.player1_id)
                ? m.player1_name || ""
                : Number(m.winner_id) === Number(m.player2_id)
                  ? m.player2_name || ""
                  : ""
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
        races: racesBlob,
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
