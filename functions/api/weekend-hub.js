// Weekend hub: current race weekend schedule + starting lineup,
// pulled from the same NASCAR feeds the import functions use.
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
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(text || "Supabase read failed");
      return data;
    }

    async function nascarJson(url) {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          Referer: "https://www.nascar.com/",
          "User-Agent": "Mozilla/5.0",
        },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(`NASCAR fetch failed: ${res.status}`);
      return data;
    }

    // Current race = first DB race without results (same rule as green flag)
    const [races, results] = await Promise.all([
      getJson(`/rest/v1/races?select=id,race_number,race_name,race_short,season_year&order=race_number.asc`),
      getJson(`/rest/v1/race_results?select=race_id`),
    ]);

    const completed = new Set((results || []).map(r => Number(r.race_id)));
    const race = (races || []).find(r => !completed.has(Number(r.id))) || null;

    if (!race) {
      return json({ ok: true, race: null, schedule: [], lineup: [] });
    }

    const raceListJson = await nascarJson(
      `https://cf.nascar.com/cacher/${race.season_year}/race_list_basic.json`
    );

    const cupPointsRaces = (Array.isArray(raceListJson?.series_1) ? raceListJson.series_1 : [])
      .slice()
      .sort((a, b) => {
        const da = Date.parse(a?.race_date ?? a?.date_scheduled ?? "") || 0;
        const db = Date.parse(b?.race_date ?? b?.date_scheduled ?? "") || 0;
        return da - db;
      })
      .filter(r => {
        const name = String(r?.race_name ?? "").toLowerCase();
        if (name.includes("clash") || name.includes("duel") ||
            name.includes("all-star") || name.includes("shootout") ||
            name.includes("exhibition")) return false;
        return true;
      });

    const targetRace = cupPointsRaces[Number(race.race_number) - 1];
    if (!targetRace?.race_id) {
      return json({ ok: true, race: raceInfo_(race, null), schedule: [], lineup: [] });
    }

    // Schedule: race_list entries carry the full weekend event schedule
    const schedule = (Array.isArray(targetRace.schedule) ? targetRace.schedule : [])
      .map(ev => ({
        name: String(ev?.event_name || ev?.notes || "").trim(),
        notes: String(ev?.notes || "").trim(),
        startUtc: String(ev?.start_time_utc || ev?.start_time || "").trim(),
      }))
      .filter(ev => ev.name && ev.startUtc)
      .sort((a, b) => (Date.parse(a.startUtc) || 0) - (Date.parse(b.startUtc) || 0));

    // Lineup: weekend feed race results rows carry starting_position pre-race
    let lineup = [];
    try {
      const weekendJson = await nascarJson(
        `https://cf.nascar.com/cacher/${race.season_year}/1/${targetRace.race_id}/weekend-feed.json`
      );

      const rows = Array.isArray(weekendJson?.weekend_race?.[0]?.results)
        ? weekendJson.weekend_race[0].results
        : [];

      lineup = rows
        .map(r => ({
          pos: Number(r?.starting_position ?? r?.start_pos ?? r?.StartPos),
          driver: String(r?.driver_fullname ?? r?.driver_name ?? r?.FullName ?? "").trim(),
          car: String(r?.car_number ?? r?.CarNo ?? "").trim(),
        }))
        .filter(r => Number.isFinite(r.pos) && r.pos > 0 && r.driver)
        .sort((a, b) => a.pos - b.pos);
    } catch {
      lineup = [];
    }

    return json({
      ok: true,
      race: raceInfo_(race, targetRace),
      schedule,
      lineup,
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

function raceInfo_(dbRace, nascarRace) {
  return {
    name: String(dbRace?.race_short || dbRace?.race_name || "").trim(),
    fullName: String(nascarRace?.race_name || dbRace?.race_name || "").trim(),
    track: String(nascarRace?.track_name || "").trim(),
    tv: String(nascarRace?.television_broadcaster || "").trim(),
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120",
    },
  });
}
