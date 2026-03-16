
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
    Find the first race with no results yet
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
    Pull NASCAR season race list
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
    Sort races chronologically
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
    Remove non-points races
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
    Probe NASCAR live feed
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

    const liveText = await liveResp.text();

    let liveJson;

    try {
      liveJson = JSON.parse(liveText);
    } catch {
      liveJson = liveText;
    }

    /*
    DEBUG RESPONSE
    */

    /*
STEP 7
Extract running order
*/

const vehicles =
  Array.isArray(liveJson?.vehicles)
    ? liveJson.vehicles
    : [];
const vehicleSample = vehicles.length ? vehicles[0] : null;

const driverPositions = {};

for (const v of vehicles) {

  const name =
    v?.driver_name ||
    v?.driver_fullname ||
    v?.name ||
    "";

  const position =
    Number(v?.running_position) ||
    Number(v?.position) ||
    Number(v?.pos);

  if (!name || !Number.isFinite(position)) continue;

  driverPositions[normalizeName(name)] = {
    name: name.trim(),
    position
  };

}

/*
RETURN CLEAN PAYLOAD
*/

return json({

  ok: true,

  race: {
    dbRaceNumber: currentRace.race_number,
    dbRaceName: currentRace.race_name,
    nascarRaceId
  },

  liveRace: {
    lap: liveJson?.lap_number ?? null,
    lapsToGo: liveJson?.laps_to_go ?? null,
    flag: liveJson?.flag_state ?? null
  },

  vehicleCount: vehicles.length,

  vehicleSample

});
  } catch (err) {

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
