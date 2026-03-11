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

    const rows = await getJson(
      `/rest/v1/player_financials?select=player_id,paid,winnings,players(name)&order=player_id.asc`
    );

    const completedRows = await getJson(
      `/rest/v1/race_results?select=race_id,races(race_number)`
    );

    const completedRaceIds = new Set();
    for (const row of completedRows || []) {
      const raceNumber =
        Number(row?.races?.race_number) ||
        Number(row?.races?.[0]?.race_number) ||
        0;

      if (raceNumber >= 1 && raceNumber <= 36) {
        completedRaceIds.add(Number(row.race_id));
      }
    }

    const completedRaceCount = completedRaceIds.size;
    const duesPerRace = 5;
    const seasonTotal = 180;
    const requiredSoFar = completedRaceCount * duesPerRace;

    const out = {};

    for (const row of rows || []) {
      const name =
        String(row?.players?.name || row?.players?.[0]?.name || "").trim();

      if (!name) continue;

      const paid = Number(row.paid) || 0;
      const winnings = Number(row.winnings) || 0;

      const balance = seasonTotal - paid - winnings; // matches old sheet
      const currentBehind = Math.max(0, requiredSoFar - paid - winnings); // for nag logic

      out[name] = {
        name,
        paid,
        winnings,
        balance,
        currentBehind
      };
    }

    return json({
      ok: true,
      data: out
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
