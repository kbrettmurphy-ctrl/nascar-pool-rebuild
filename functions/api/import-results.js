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
      return json({ ok: false, error: `Weekend feed fetch failed` }, 502);
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

    // 8) Clear old race results
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/race_results?race_id=eq.${raceId}`,
      {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      }
    );

    // 9) Insert new rows
    await fetch(`${env.SUPABASE_URL}/rest/v1/race_results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify(inserts),
    });

    // 10) Update Swiss results
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/update_swiss_matchup_results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({
        p_tournament_id: tournamentId
      })
    });

    // 11) Generate Swiss rounds ONLY for rounds 2-4
    if (roundNumber > 1) {
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/rpc/generate_swiss_round_pairings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: env.SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          },
          body: JSON.stringify({
            p_tournament_id: tournamentId,
            p_round_number: roundNumber
          })
        }
      );
    }

    return json({
      ok: true,
      raceId,
      round: roundNumber
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

function getRaceResultsRows(weekendJson) {
  const runs = Array.isArray(weekendJson?.weekend_runs)
    ? weekendJson.weekend_runs
    : [];

  if (!runs.length) return [];

  const scoredRuns = runs.map((run) => {
    const name = String(run?.run_name || run?.name || "").toLowerCase();
    const results = Array.isArray(run?.results) ? run.results : [];
    const keys = results[0] ? Object.keys(results[0]) : [];

    const hasFinishPos =
      keys.includes("finishing_position") ||
      keys.includes("finish_position") ||
      keys.includes("FinishPos") ||
      keys.includes("FinPos");

    let score = 0;
    if (results.length >= 10) score += 5;
    if (hasFinishPos) score += 50;
    if (name.includes("race")) score += 20;
    if (name.includes("feature")) score += 10;
    if (name.includes("final")) score += 10;

    return { run, score };
  });

  scoredRuns.sort((a, b) => b.score - a.score);

  const chosenRun = scoredRuns[0]?.run;
  return Array.isArray(chosenRun?.results) ? chosenRun.results : [];
}