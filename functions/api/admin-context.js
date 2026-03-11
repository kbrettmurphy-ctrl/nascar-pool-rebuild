import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    async function getJson(path) {
      const res = await fetch(`${env.SUPABASE_URL}${path}`, { headers });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
      return data;
    }

    const [races, rounds, players] = await Promise.all([
      getJson(`/rest/v1/races?select=id,race_number,race_name,race_short&order=race_number.asc`),
      getJson(`/rest/v1/tournament_rounds?select=tournament_id,round_number,race_id,tournaments(tournament_number)&order=tournament_id.asc,round_number.asc`),
      getJson(`/rest/v1/players?select=id,name&order=name.asc`)
    ]);

    const raceResults = await getJson(`/rest/v1/race_results?select=race_id`);
    const completedRaceIds = new Set((raceResults || []).map(r => Number(r.race_id)));

    let currentRace = null;
    for (const r of races || []) {
      if (!completedRaceIds.has(Number(r.id))) {
        currentRace = r;
        break;
      }
    }
    if (!currentRace && races?.length) currentRace = races[races.length - 1];

    const roundByRaceId = new Map();
    const tournamentSet = new Map();

    for (const row of rounds || []) {
      const tNum = Number(row?.tournaments?.tournament_number ?? row.tournament_id);
      roundByRaceId.set(Number(row.race_id), {
        tournamentId: Number(row.tournament_id),
        tournamentNumber: tNum,
        roundNumber: Number(row.round_number),
      });
      tournamentSet.set(Number(row.tournament_id), {
        id: Number(row.tournament_id),
        label: `Tournament ${tNum}`
      });
    }

    const raceOptions = (races || []).map(r => {
      const meta = roundByRaceId.get(Number(r.id));
      const shortName = String(r.race_short || r.race_name || "").trim();
      return {
        id: Number(r.id),
        raceNumber: Number(r.race_number),
        label: `Race ${r.race_number} · ${shortName}`,
        tournamentId: meta?.tournamentId ?? 0,
        tournamentNumber: meta?.tournamentNumber ?? "",
        roundNumber: meta?.roundNumber ?? "",
        name: shortName
      };
    });

    return json({
      ok: true,
      data: {
        currentRaceId: Number(currentRace?.id || 0),
        tournamentId: meta?.tournamentId ?? 0,
        tournaments: [...tournamentSet.values()].sort((a, b) => a.id - b.id),
        races: raceOptions,
        players: (players || []).map(p => ({
          id: Number(p.id),
          name: String(p.name || "").trim()
        }))
      }
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
