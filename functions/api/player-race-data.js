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

    // All races in season order
    const races = await getJson(
      `/rest/v1/races?select=id,race_number,race_name,race_short&order=race_number.asc`
    );

    // Tournament round mapping
    const rounds = await getJson(
      `/rest/v1/tournament_rounds?select=id,tournament_id,round_number,race_id,tournaments(id,tournament_number),races(id,race_name,race_short,race_number)&order=tournament_id.asc,round_number.asc`
    );

    // Swiss matchup results with averages
    const matchupRows = await getJson(
      `/rest/v1/swiss_matchup_results?select=tournament_id,round_number,race_id,match_number,player1_id,player1_name,player1_driver_1,player1_driver_2,player1_avg,player2_id,player2_name,player2_driver_1,player2_driver_2,player2_avg,winner_id&order=tournament_id.asc,round_number.asc,match_number.asc`
    );

    // Qualifying-position numbers from score view
    const scoreRows = await getJson(
      `/rest/v1/player_race_scores?select=race_id,player_id,driver_1_qualifying_position,driver_2_qualifying_position`
    );

    // Any race that has results at all
    const raceResults = await getJson(
      `/rest/v1/race_results?select=race_id`
    );

    // Race winners
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
    const roundMetaByRaceId = new Map();

    for (const r of rounds || []) {
      const meta = {
        tournamentId: Number(r.tournament_id),
        tournament: Number(r?.tournaments?.tournament_number ?? r.tournament_id),
        round: Number(r.round_number),
        raceId: Number(r.race_id),
        raceNumber: Number(r?.races?.race_number ?? 0),
        race:
          String(r?.races?.race_short || "").trim() ||
          String(r?.races?.race_name || "").trim(),
      };

      roundMeta.push(meta);
      roundMetaByRaceId.set(meta.raceId, meta);
    }

    // Current race = first race in full schedule without results.
    // If all currently-known races have results, fallback to latest race in schedule.
    let currentRace = null;

    for (const r of races || []) {
      if (!completedRaceIds.has(Number(r.id))) {
        currentRace = r;
        break;
      }
    }

    if (!currentRace && races?.length) {
      currentRace = races[races.length - 1];
    }

    const currentMeta = currentRace
      ? (roundMetaByRaceId.get(Number(currentRace.id)) || null)
      : null;

    // Build visible race set:
    // - all tournament-mapped races (historical + current tournament)
    // - plus current season race if it is not already tournament-mapped
    const visibleRaceIds = new Set(roundMeta.map(r => Number(r.raceId)));

    if (currentRace) {
      visibleRaceIds.add(Number(currentRace.id));
    }

    const visibleRaces = (races || []).filter(r => visibleRaceIds.has(Number(r.id)));

    const raceList = visibleRaces.map(r => {
      const meta = roundMetaByRaceId.get(Number(r.id)) || null;
      return {
        tournament: meta ? meta.tournament : "",
        round: meta ? meta.round : "",
        race:
          String(r.race_short || "").trim() ||
          String(r.race_name || "").trim(),
      };
    });

    const racesBlob = {};

    for (const r of visibleRaces) {
      const raceId = Number(r.id);
      const meta = roundMetaByRaceId.get(raceId) || null;

      const displayRace =
        String(r.race_short || "").trim() ||
        String(r.race_name || "").trim();

      const tournament = meta ? meta.tournament : "";
      const round = meta ? meta.round : "";
      const key = `${tournament}||${displayRace}`;

      let rows = [];
      if (meta) {
        rows = (matchupRows || []).filter(
          m =>
            Number(m.tournament_id) === meta.tournamentId &&
            Number(m.round_number) === meta.round
        );
      }

      racesBlob[key] = {
        tournament,
        race: displayRace,
        round,
        raceWinnerDriver: winnerByRaceId.get(raceId) || "",
        matchups: rows.map(m => {
          const p1Nums = scoreMap.get(`${raceId}||${m.player1_id}`) || {};
          const p2Nums = scoreMap.get(`${raceId}||${m.player2_id}`) || {};

          return {
            p1: m.player1_name || "",
            p2: m.player2_name || "",
            p1Drivers: [m.player1_driver_1 || "", m.player1_driver_2 || ""],
            p2Drivers: [m.player2_driver_1 || "", m.player2_driver_2 || ""],
            p1Nums: [p1Nums.p1 ?? "", p1Nums.p2 ?? ""],
            p2Nums: [p2Nums.p1 ?? "", p2Nums.p2 ?? ""],
            a1: m.player1_avg ?? null,
            a2: m.player2_avg ?? null,
            winner:
              Number(m.winner_id) === Number(m.player1_id)
                ? (m.player1_name || "")
                : Number(m.winner_id) === Number(m.player2_id)
                  ? (m.player2_name || "")
                  : "",
          };
        }),
        eliminated: [],
      };
    }

    const currentRaceName =
      String(currentRace?.race_short || "").trim() ||
      String(currentRace?.race_name || "").trim() ||
      "";

    return json({
      ok: true,
      raceList,
      matchups: {
        current: {
          tournament: currentMeta ? currentMeta.tournament : "",
          race: currentMeta?.race || currentRaceName,
          round: currentMeta ? currentMeta.round : "",
        },
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