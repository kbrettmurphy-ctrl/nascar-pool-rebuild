// Weekend hub:
//  - weekend: this weekend's Truck / Xfinity / Cup sessions
//    (practice / qualifying / race times only), like nascar.com
//  - season: the full Cup season schedule with the next race flagged
//  - lineup: Cup starting grid once qualifying is in
// All from the same NASCAR feeds the import functions use.
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
    const seasonYear = Number(race?.season_year) || new Date().getFullYear();

    const raceListJson = await nascarJson(
      `https://cf.nascar.com/cacher/${seasonYear}/race_list_basic.json`
    );

    const isPoints = r => {
      const name = String(r?.race_name ?? "").toLowerCase();
      return !(name.includes("clash") || name.includes("duel") ||
        name.includes("all-star") || name.includes("shootout") ||
        name.includes("exhibition"));
    };
    const byDate = (a, b) =>
      (Date.parse(a?.race_date ?? a?.date_scheduled ?? "") || 0) -
      (Date.parse(b?.race_date ?? b?.date_scheduled ?? "") || 0);

    const cupPoints = (Array.isArray(raceListJson?.series_1) ? raceListJson.series_1 : [])
      .slice().sort(byDate).filter(isPoints);

    // ---- Full Cup season (what the pool runs on) ----
    const nextCup = cupPoints[Number(race?.race_number || 0) - 1] || null;
    const season = cupPoints.map((r, i) => ({
      round: i + 1,
      name: String(r?.race_name || "").trim(),
      track: String(r?.track_name || "").trim(),
      startUtc: fromEastern_(r?.race_date || r?.date_scheduled),
      isNext: nextCup ? Number(r?.race_id) === Number(nextCup.race_id) : false,
    })).filter(r => r.name);

    // ---- This weekend across the three national series ----
    const anchor = nextCup;
    const anchorMs = anchor ? Date.parse(anchor.race_date || anchor.date_scheduled || "") : NaN;
    const anchorTrack = Number(anchor?.track_id) || null;

    const seriesDefs = [
      { key: "series_3", label: "Craftsman Truck" },
      { key: "series_2", label: "Xfinity" },
      { key: "series_1", label: "Cup" },
    ];

    const weekend = [];
    if (anchor && Number.isFinite(anchorMs)) {
      for (const def of seriesDefs) {
        const list = Array.isArray(raceListJson?.[def.key]) ? raceListJson[def.key] : [];
        // same track, within a 4-day window of the Cup race
        const match = list
          .filter(r => Number(r?.track_id) === anchorTrack)
          .map(r => ({ r, ms: Date.parse(r?.race_date || r?.date_scheduled || "") }))
          .filter(x => Number.isFinite(x.ms) && Math.abs(x.ms - anchorMs) <= 4 * 86400000)
          .sort((a, b) => Math.abs(a.ms - anchorMs) - Math.abs(b.ms - anchorMs))[0]?.r;

        if (!match) continue;

        const sessions = [];
        for (const ev of (match.schedule || [])) {
          const rt = Number(ev?.run_type);
          const startUtc = fromUtcField_(ev?.start_time_utc || ev?.start_time);
          if (!startUtc) continue;
          if (rt === 1) sessions.push({ type: "Practice", startUtc });
          else if (rt === 2) sessions.push({ type: "Qualifying", startUtc });
          else if (rt === 3) sessions.push({ type: "Race", startUtc });
        }
        // one of each, earliest wins (skip the odd second practice)
        const seen = new Set();
        const clean = sessions
          .sort((a, b) => (Date.parse(a.startUtc) || 0) - (Date.parse(b.startUtc) || 0))
          .filter(s => (seen.has(s.type) ? false : seen.add(s.type)));

        if (clean.length) {
          weekend.push({
            series: def.label,
            raceName: String(match.race_name || "").trim(),
            sessions: clean,
          });
        }
      }
    }

    // ---- Cup starting lineup (once qualifying posts) ----
    let lineup = [];
    if (anchor?.race_id && race) {
      try {
        const weekendJson = await nascarJson(
          `https://cf.nascar.com/cacher/${seasonYear}/1/${anchor.race_id}/weekend-feed.json`
        );
        const rows = Array.isArray(weekendJson?.weekend_race?.[0]?.results)
          ? weekendJson.weekend_race[0].results : [];
        lineup = rows
          .map(r => ({
            pos: Number(r?.starting_position ?? r?.start_pos ?? r?.StartPos),
            driver: String(r?.driver_fullname ?? r?.driver_name ?? r?.FullName ?? "").trim(),
            car: String(r?.car_number ?? r?.CarNo ?? "").trim(),
          }))
          .filter(r => Number.isFinite(r.pos) && r.pos > 0 && r.driver)
          .sort((a, b) => a.pos - b.pos);
      } catch { lineup = []; }
    }

    return json({
      ok: true,
      race: raceInfo_(race, anchor),
      weekend,
      season,
      lineup,
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

// The feed mixes two conventions: schedule start_time_utc is genuine
// UTC; race_date / date_scheduled are US Eastern local. Tag each
// correctly so the client renders in the viewer's own zone.
function fromUtcField_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z";
}
function fromEastern_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "-04:00";
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
