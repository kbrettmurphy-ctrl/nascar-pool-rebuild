export async function onRequestGet(context) {

  try {

    const { env } = context;

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
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

    /*
    STEP 1
    Find current race (first race without results)
    */

    const races = await getJson(
      `/rest/v1/races?select=id,race_number,race_name,season_year&order=race_number.asc`
    );

    const results = await getJson(
      `/rest/v1/race_results?select=race_id`
    );

    const completed = new Set(
      (results || []).map(r => Number(r.race_id))
    );

    const currentRace =
      (races || []).find(r => !completed.has(Number(r.id)));

    if (!currentRace) {
      return json({
        ok: false,
        error: "No current race found"
      }, 404);
    }

    /*
    STEP 2
    Pull NASCAR race list
    */

    const raceListUrl =
      `https://cf.nascar.com/cacher/${currentRace.season_year}/race_list_basic.json`;

    const raceListResp = await fetch(raceListUrl, {
      headers: {
        Accept: "application/json",
        Referer: "https://www.nascar.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const raceListJson = await raceListResp.json();

    const cupRaces =
      Array.isArray(raceListJson?.series_1)
        ? raceListJson.series_1
        : [];

    /*
    STEP 3
    Sort chronologically
    */

    const sorted = cupRaces
      .slice()
      .sort((a, b) => {

        const da = Date.parse(a?.race_date || "") || 0;
        const db = Date.parse(b?.race_date || "") || 0;

        return da - db;

      });

    /*
    STEP 4
    Remove exhibition races
    */

    const pointsRaces = sorted.filter(r => {

      const name = String(r?.race_name || "").toLowerCase();

      if (name.includes("clash")) return false;
      if (name.includes("duel")) return false;
      if (name.includes("all-star")) return false;

      return true;

    });

    /*
    STEP 5
    Resolve NASCAR race ID
    */

    const nascarRace =
      pointsRaces[currentRace.race_number - 1];

    if (!nascarRace) {
      return json({
        ok: false,
        error: "Could not resolve NASCAR race"
      }, 500);
    }

    const nascarRaceId = nascarRace.race_id;

    /*
    STEP 6
    Pull live NASCAR feed
    */

    const liveUrl =
      `https://cf.nascar.com/live/feeds/live-feed.json`;

    const liveResp = await fetch(liveUrl, {
      headers: {
        Accept: "application/json",
        Referer: "https://www.nascar.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const liveJson = await liveResp.json();

    /*
    STEP 7
    Extract running order
    */

    const vehicles =
      Array.isArray(liveJson?.vehicles)
        ? liveJson.vehicles
        : [];

    const driverPositions = {};

    for (const v of vehicles) {

      const name = v?.driver?.full_name || "";
      const position = Number(v?.running_position);

      if (!name || !Number.isFinite(position)) continue;

      driverPositions[normalizeName(name)] = {
        name: name.trim(),
        position,
        car: v?.vehicle_number ?? null
      };

    }

    /*
    STEP 8
    Pull matchup data from your existing API
    */

    const origin = new URL(context.request.url).origin;

    const raceDataResp =
      await fetch(`${origin}/api/player-race-data`);

    const raceData = await raceDataResp.json();

    const current = raceData?.matchups?.current;

    const raceKey =
      `${current.tournament}||${current.race}`;

    const raceBlob =
      raceData?.matchups?.races?.[raceKey];

    const matchups =
      Array.isArray(raceBlob?.matchups)
        ? raceBlob.matchups
        : [];

    /*
    STEP 9
    Calculate live matchup averages
    */

    const liveMatchups = [];
    
    for (const m of matchups) {
      
      const p1Drivers = (m.p1Drivers || [])
        .filter(d => d && d.trim() !== "")
        .map(d => {
          const key = normalizeName(d);
          const pos = driverPositions[key]?.position ?? null;
          return {
            name: d,
            position: pos
          };
      });

      const p2Drivers = (m.p2Drivers || [])
        .filter(d => d && d.trim() !== "")
        .map(d => {
          const key = normalizeName(d);
          const pos = driverPositions[key]?.position ?? null;
          return {
            name: d,
            position: pos
          };
      });

      function avg(list) {

        const nums =
          list.map(x => x.position)
          .filter(x => Number.isFinite(x));

        if (nums.length !== list.length) return null;

        return nums.reduce((a,b)=>a+b,0) / nums.length;

      }

      const p1Avg = avg(p1Drivers);
      const p2Avg = avg(p2Drivers);

      let leader = null;

      if (p1Avg !== null && p2Avg !== null) {
        if (p1Avg < p2Avg) {
          leader = m.p1;
        } else if (p2Avg < p1Avg) {
          leader = m.p2;
        } else {
          leader = "Tie";
        }
      }

      liveMatchups.push({

        p1: m.p1,
        p1Drivers,
        p1Avg,

        p2: m.p2,
        p2Drivers,
        p2Avg,

        leader

      });

    }

    /*
    FINAL RESPONSE
    */

    return json({

      ok: true,

      race: {
        name: currentRace.race_name,
        lap: liveJson?.lap_number ?? null,
        lapsToGo: liveJson?.laps_to_go ?? null,
        flag: liveJson?.flag_state ?? null
      },

      updated: new Date().toISOString(),

      matchups: liveMatchups

    });

  }

  catch (err) {

    return json({
      ok: false,
      error: err.message || String(err)
    }, 500);

  }

}

function json(data, status = 200) {

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });

}

function normalizeName(s) {

  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

}
