import { getCurrentCupLiveContext_ } from "./_green-flag";

export async function onRequestGet(context) {
  try {
    const { env, request } = context;

    const liveContext = await getCurrentCupLiveContext_(env, {
      source: "live-matchups"
    });

    if (!liveContext.ok) {
      return json({
        ok: false,
        error: liveContext.reason || "Could not resolve NASCAR live context",
        debug: {
          greenFlag: {
            sideEffect: "disabled",
            ...liveContext.debug
          }
        }
      }, liveContext.reason === "no_current_db_race" ? 404 : 500);
    }

    const {
      currentRace,
      nascarRace,
      liveJson,
      liveSeriesId,
      liveRaceId,
      expectedNascarRaceId,
      liveRaceName,
      expectedRaceName,
      isCorrectCupRace,
      runType
    } = liveContext;

    // Practice and qualifying run on the SAME live feed with the same
    // race_id (see _green-flag.js). Only run_type 3 is the race - anything
    // else would paint practice running order as live matchup scoring.
    const isLiveRaceSession = isCorrectCupRace && Number(runType) === 3;

    const vehicles =
      isLiveRaceSession && Array.isArray(liveJson?.vehicles)
        ? liveJson.vehicles
        : [];

    const driverPositions = {};

    for (const v of vehicles) {
      const name = v?.driver?.full_name || "";
      const position = Number(v?.running_position);

      if (!name || !Number.isFinite(position)) continue;

      const info = {
        name: name.trim(),
        position,
        car: String(v?.vehicle_number ?? "").trim()
      };

      const keys = buildLookupKeys(name);
      for (const key of keys) {
        driverPositions[key] = info;
      }
    }

    const origin = new URL(request.url).origin;

    const raceDataResp = await fetch(`${origin}/api/player-race-data`, {
      cache: "no-store"
    });
    const raceData = await raceDataResp.json();

    const current = raceData?.matchups?.current;

    if (!current) {
      return json({
        ok: false,
        error: "Could not determine current race context"
      }, 500);
    }

    const raceKey = `${current.tournament}||${current.race}`;
    const raceBlob = raceData?.matchups?.races?.[raceKey];

    const matchups = Array.isArray(raceBlob?.matchups)
      ? raceBlob.matchups
      : [];

    const liveMatchups = [];
    const unresolvedDrivers = [];

    for (const m of matchups) {
      const p1Drivers = (m.p1Drivers || [])
        .filter(d => d && d.trim() !== "")
        .map(d => {
          const found = resolveDriverPosition(d, driverPositions);

          if (isLiveRaceSession && !found) {
            unresolvedDrivers.push({
              matchup: `${m.p1} vs ${m.p2}`,
              side: "p1",
              requested: d,
              tried: buildLookupKeys(d)
            });
          }

          return {
            name: d,
            position: found?.position ?? null
          };
        });

      const p2Drivers = (m.p2Drivers || [])
        .filter(d => d && d.trim() !== "")
        .map(d => {
          const found = resolveDriverPosition(d, driverPositions);

          if (isLiveRaceSession && !found) {
            unresolvedDrivers.push({
              matchup: `${m.p1} vs ${m.p2}`,
              side: "p2",
              requested: d,
              tried: buildLookupKeys(d)
            });
          }

          return {
            name: d,
            position: found?.position ?? null
          };
        });

      function avg(list) {
        const nums = list
          .map(x => x.position)
          .filter(x => Number.isFinite(x));

        if (nums.length !== list.length) return null;

        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }

      const p1Avg = avg(p1Drivers);
      const p2Avg = avg(p2Drivers);

      let leader = null;

      if (p1Avg !== null && p2Avg !== null) {
        if (p1Avg < p2Avg) leader = m.p1;
        else if (p2Avg < p1Avg) leader = m.p2;
        else leader = "Tie";
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

    return json({
      ok: true,

      race: {
        name: currentRace.race_name,

        lap: isLiveRaceSession
          ? liveJson?.lap_number ?? null
          : null,

        lapsToGo: isLiveRaceSession
          ? liveJson?.laps_to_go ?? null
          : null,

        flag: isLiveRaceSession
          ? liveJson?.flag_state ?? null
          : null,

        liveSeriesId,
        liveRaceId,
        expectedNascarRaceId,
        isCorrectCupRace,
        runType: Number.isFinite(Number(runType)) ? Number(runType) : null,
        isLiveRaceSession,

        startTime:
          nascarRace?.race_date ||
          nascarRace?.date_scheduled ||
          nascarRace?.start_time ||
          nascarRace?.start_date ||
          null,

        network: getTvNetwork_(nascarRace),
        radio: getRadioNetwork_(nascarRace)
      },

      updated: new Date().toISOString(),

      matchups: liveMatchups,

      debug: {
        unresolvedDrivers,
        liveRaceName,
        expectedRaceName,
        greenFlag: {
          sideEffect: "disabled",
          source: "scheduled_worker_only",
          dbRaceId: liveContext.debug?.dbRaceId ?? null,
          expectedNascarRaceId,
          liveRaceId,
          flagState: liveContext.debug?.flagState ?? null,
          lapNumber: liveContext.debug?.lapNumber ?? null,
          isCorrectCupRace
        }
      }
    });

  } catch (err) {
    return json({
      ok: false,
      error: err.message || String(err)
    }, 500);
  }
}

function getTvNetwork_(race) {
  const candidates = [
    race?.television_broadcaster,
    race?.television_network,
    race?.tv_broadcaster,
    race?.tv_network,
    race?.tvNetwork,
    race?.broadcast_network,
    race?.broadcastNetwork,
    race?.broadcast_provider,
    race?.broadcastProvider,
    race?.tv_provider,
    race?.tvProvider,
    race?.streaming_provider,
    race?.streamingProvider,
    race?.streaming_network,
    race?.streamingNetwork,
    race?.network,
    race?.channel
  ];

  const found = candidates
    .map(v => String(v || "").trim())
    .find(Boolean);

  return normalizeTvNetwork_(found);
}

function getRadioNetwork_(race) {
  return String(
    race?.radio_broadcaster ||
    race?.radio_network ||
    race?.radioNetwork ||
    ""
  ).trim();
}

function normalizeTvNetwork_(value) {
  const v = String(value || "").trim();
  if (!v) return "";

  const low = v.toLowerCase();

  if (low.includes("prime")) return "Prime";
  if (low.includes("amazon")) return "Prime";
  if (low.includes("fox")) return "FOX";
  if (low.includes("fs1")) return "FS1";
  if (low.includes("nbc")) return "NBC";
  if (low.includes("usa")) return "USA";
  if (low.includes("tnt")) return "TNT";
  if (low.includes("cw")) return "The CW";

  return v;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function normalizeName(s) {
  return String(s || "")
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAliasCandidates(name) {
  const n = normalizeName(name);

  const aliases = {
    "john h nemechek": ["john hunter nemechek"],
    "john hunter nemechek": ["john h nemechek"],

    "aj allmendinger": ["a j allmendinger"],
    "a j allmendinger": ["aj allmendinger"],

    "daniel suarez": ["daniel suarez"],

    "justin allgaier": ["alex bowman"],
    "alex bowman": ["justin allgaier"]
  };

  return aliases[n] || [];
}

function buildLookupKeys(name) {
  const out = new Set();

  const base = normalizeName(name);
  if (base) out.add(base);

  const aliases = getAliasCandidates(name);
  for (const alias of aliases) {
    const n = normalizeName(alias);
    if (n) out.add(n);
  }

  return [...out];
}

function resolveDriverPosition(name, driverPositions) {
  const keys = buildLookupKeys(name);

  for (const key of keys) {
    if (driverPositions[key]) {
      return driverPositions[key];
    }
  }

  return null;
}
