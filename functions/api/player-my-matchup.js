export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const name = String(url.searchParams.get("name") || "").trim();

    if (!name) {
      return json({ ok: false, error: "name is required" }, 400);
    }

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

    function enc(s) {
      return encodeURIComponent(String(s || "").trim());
    }

    // Find player row
    const players = await getJson(
      `/rest/v1/players?select=id,name&name=eq.${enc(name)}`
    );

    const player = Array.isArray(players) && players.length ? players[0] : null;
    if (!player) {
      return json({ ok: false, error: "Player not found" }, 404);
    }

    // Reuse current race/matchup source
    const raceDataRes = await fetch(`${url.origin}/api/player-race-data`, {
      headers: { "Content-Type": "application/json" }
    });
    const raceData = await raceDataRes.json();

    if (!raceData?.ok || !raceData?.matchups?.current) {
      return json({ ok: false, error: "Could not determine current race context" }, 500);
    }

    const current = raceData.matchups.current;
    const currentKey = `${current.tournament}||${current.race}`;
    const currentRaceBlob = raceData.matchups.races?.[currentKey];

    // Current race exists conceptually, but no matchup blob yet
    if (!currentRaceBlob) {
      return json({
        ok: true,
        data: {
          status: "not_started",
          you: player.name,
          opponent: "",
          tournament: current.tournament ?? "",
          round: current.round ?? "",
          race: current.race ?? "",
          youDrivers: [],
          youNums: [],
          oppDrivers: [],
          oppNums: []
        }
      });
    }

    const playerNameNorm = player.name.trim().toLowerCase();

    const matchup = (currentRaceBlob.matchups || []).find(
      m =>
        String(m.p1 || "").trim().toLowerCase() === playerNameNorm ||
        String(m.p2 || "").trim().toLowerCase() === playerNameNorm
    );

    // In Swiss, no elimination. If no matchup yet, it just hasn't been generated/published.
    if (!matchup) {
      return json({
        ok: true,
        data: {
          status: "not_started",
          you: player.name,
          opponent: "",
          tournament: currentRaceBlob.tournament ?? current.tournament ?? "",
          round: currentRaceBlob.round ?? current.round ?? "",
          race: currentRaceBlob.race ?? current.race ?? "",
          youDrivers: [],
          youNums: [],
          oppDrivers: [],
          oppNums: []
        }
      });
    }

    const youAreP1 =
      String(matchup.p1 || "").trim().toLowerCase() === playerNameNorm;

    return json({
      ok: true,
      data: {
        status: "active",
        you: player.name,
        opponent: youAreP1 ? (matchup.p2 || "") : (matchup.p1 || ""),
        tournament: currentRaceBlob.tournament,
        round: currentRaceBlob.round,
        race: currentRaceBlob.race,
        youDrivers: youAreP1 ? (matchup.p1Drivers || []) : (matchup.p2Drivers || []),
        youNums: youAreP1 ? (matchup.p1Nums || []) : (matchup.p2Nums || []),
        oppDrivers: youAreP1 ? (matchup.p2Drivers || []) : (matchup.p1Drivers || []),
        oppNums: youAreP1 ? (matchup.p2Nums || []) : (matchup.p1Nums || [])
      }
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
