import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // Simple admin protection
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

    // 3) Match DB race_number to NASCAR POINTS-race order
    const cupPointsRaces = allCupRaces
      .slice()
      .sort((a, b) => {
        const da = Date.parse(
          a?.race_date ?? a?.date_scheduled ?? a?.start_time ?? a?.start_date ?? ""
        ) || 0;
        const db = Date.parse(
          b?.race_date ?? b?.date_scheduled ?? b?.start_time ?? b?.start_date ?? ""
        ) || 0;
        return da - db;
      })
      .filter((r) => {
        const typeId = Number(r?.race_type_id ?? r?.RaceTypeId ?? r?.raceTypeId);
        const typeName = String(
          r?.race_type_name ?? r?.RaceTypeName ?? r?.raceTypeName ?? ""
        ).toLowerCase();
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
        if (name.includes("exhibition")) return false;

        return true;
      });

    const targetRace = cupPointsRaces[race.race_number - 1];
    if (!targetRace) {
      return json(
        { ok: false, error: `Could not map race_number ${race.race_number} to NASCAR points race list` },
        400
      );
    }

    const nascarYear = race.season_year;
    const nascarSeriesId = 1; // Cup
    const targetRaceId = targetRace.race_id;

    if (!targetRaceId) {
      return json({ ok: false, error: "Resolved NASCAR race is missing race_id" }, 502);
    }

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
      return json({ ok: false, error: `Weekend feed fetch failed: ${weekendResp.status}` }, 502);
    }

    const weekendJson = await weekendResp.json();
    const runs = Array.isArray(weekendJson?.weekend_runs) ? weekendJson.weekend_runs : [];

    if (!runs.length) {
      return json({ ok: false, error: "No weekend_runs found in NASCAR feed" }, 502);
    }

    // 5) Pick the best lineup run, mirroring GAS logic
    // Prefer StartPos/start_pos/starting_position, otherwise fallback to a qualifying run
    const scoredRuns = runs.map((run) => {
      const name = String(run?.run_name || run?.name || "").toLowerCase();
      const results = Array.isArray(run?.results) ? run.results : [];
      const keys = results[0] ? Object.keys(results[0]) : [];

      const hasStartPos =
        keys.includes("starting_position") ||
        keys.includes("start_pos") ||
        keys.includes("StartPos");

      let score = 0;
      if (results.length >= 10) score += 5;
      if (hasStartPos) score += 50;
      if (name.includes("starting")) score += 20;
      if (name.includes("qualifying")) score += 10;

      return { run, score, hasStartPos };
    });

    scoredRuns.sort((a, b) => b.score - a.score);
    const chosenRun = scoredRuns[0]?.run;
    const chosenResults = Array.isArray(chosenRun?.results) ? chosenRun.results : [];

    if (!chosenResults.length) {
      return json({ ok: false, error: "Chosen NASCAR run has no results" }, 502);
    }

    // 6) Normalize chosen run into qualifying_position + driver_name
    const normalized = chosenResults
      .map((row) => {
        const driverName =
          row?.driver_fullname ||
          row?.driver_full_name ||
          row?.DriverNameTag ||
          (row?.DriverFirstName && row?.DriverLastName
            ? `${row.DriverFirstName} ${row.DriverLastName}`
            : "") ||
          row?.driver_name ||
          row?.display_name ||
          row?.name ||
          "";

        const pos =
          row?.StartPos ??
          row?.start_pos ??
          row?.starting_position ??
          row?.finishing_position ??
          row?.FinishPos ??
          row?.FinPos;

        return {
          driver_name: String(driverName || "").trim(),
          qualifying_position: Number(pos),
        };
      })
      .filter(
        (x) =>
          x.driver_name &&
          Number.isFinite(x.qualifying_position) &&
          x.qualifying_position >= 1 &&
          x.qualifying_position <= 40
      )
      .sort((a, b) => a.qualifying_position - b.qualifying_position);

    if (!normalized.length) {
      return json({ ok: false, error: "No usable qualifying rows found" }, 502);
    }

    // 7) Load drivers from Supabase
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
      return json({ ok: false, error: "Could not load drivers from Supabase" }, 500);
    }

    const driverMap = new Map(
      drivers.map((d) => [normalizeName(d.name), { id: d.id, name: d.name }])
    );

    const inserts = [];
    const unmatched = [];

    for (const row of normalized) {
      const match = driverMap.get(normalizeName(row.driver_name));
      if (!match) {
        unmatched.push(row.driver_name);
        continue;
      }

      inserts.push({
        race_id: raceId,
        qualifying_position: row.qualifying_position,
        driver_id: match.id,
      });
    }

    if (!inserts.length) {
      return json({ ok: false, error: "No qualifying rows matched drivers table", unmatched }, 400);
    }

    // 8) Clear old qualifying results for this race
    const deleteResp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/qualifying_results?race_id=eq.${raceId}`,
      {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      }
    );

    if (!deleteResp.ok) {
      const t = await deleteResp.text();
      return json({ ok: false, error: `Failed clearing old qualifying rows: ${t}` }, 500);
    }

    // 9) Insert new rows
    const insertResp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/qualifying_results`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
        body: JSON.stringify(inserts),
      }
    );

    const inserted = await insertResp.json();

    if (!insertResp.ok) {
      return json({ ok: false, error: inserted }, 500);
    }

    return json({
      ok: true,
      raceId,
      raceName: race.race_name,
      rowsWritten: inserted.length,
      unmatched,
      chosenRunName: chosenRun?.run_name || chosenRun?.name || "",
      resolvedNascarRaceId: targetRaceId,
      resolvedNascarRaceName: targetRace?.race_name || targetRace?.name || "",
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
