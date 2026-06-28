import { sendAllNotifications } from "./_push";

export const GREEN_FLAG_EVENT_TYPE = "green_flag_start";
const GREEN_FLAG_MAX_START_LAP = 5;

const NASCAR_FETCH_HEADERS = {
  Accept: "application/json",
  Referer: "https://www.nascar.com/",
  "User-Agent": "Mozilla/5.0"
};

export function supabaseHeaders_(env) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Cache-Control": "no-store"
  };
}

async function getSupabaseJson_(env, path, headers = supabaseHeaders_(env)) {
  const res = await fetch(`${env.SUPABASE_URL}${path}`, {
    headers,
    cf: { cacheTtl: 0 }
  });
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

async function fetchNascarJson_(url) {
  const res = await fetch(url, {
    headers: NASCAR_FETCH_HEADERS,
    cf: { cacheTtl: 0 }
  });
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

export function normalizeRaceName_(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/nascar/g, " ")
    .replace(/cup series/g, " ")
    .replace(/craftsman truck series/g, " ")
    .replace(/xfinity series/g, " ")
    .replace(/presented by .*/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPointsRace_(race) {
  const name = String(race?.race_name || "").toLowerCase();
  if (name.includes("clash")) return false;
  if (name.includes("duel")) return false;
  if (name.includes("all-star")) return false;
  return true;
}

async function resolveCurrentDbRace_(env, headers) {
  const [races, results] = await Promise.all([
    getSupabaseJson_(
      env,
      `/rest/v1/races?select=id,race_number,race_name,season_year&order=race_number.asc`,
      headers
    ),
    getSupabaseJson_(env, `/rest/v1/race_results?select=race_id`, headers)
  ]);

  const completed = new Set((results || []).map(r => Number(r.race_id)));
  return (races || []).find(r => !completed.has(Number(r.id))) || null;
}

async function resolveNascarCupRace_(currentRace) {
  if (!currentRace) return null;

  const raceListUrl =
    `https://cf.nascar.com/cacher/${currentRace.season_year}/race_list_basic.json`;
  const raceListJson = await fetchNascarJson_(raceListUrl);

  const cupRaces = Array.isArray(raceListJson?.series_1)
    ? raceListJson.series_1
    : [];

  const sorted = cupRaces.slice().sort((a, b) => {
    const da = Date.parse(a?.race_date || a?.date_scheduled || "") || 0;
    const db = Date.parse(b?.race_date || b?.date_scheduled || "") || 0;
    return da - db;
  });

  const pointsRaces = sorted.filter(isPointsRace_);
  return pointsRaces[Number(currentRace.race_number) - 1] || null;
}

function liveRaceMatchesExpected_(liveJson, currentRace, nascarRace) {
  const liveSeriesId = Number(liveJson?.series_id ?? 0);
  const liveRaceId = Number(liveJson?.race_id ?? 0);
  const expectedNascarRaceId = Number(nascarRace?.race_id ?? 0);

  const liveRaceName = normalizeRaceName_(
    liveJson?.race_name ||
    liveJson?.race_title ||
    ""
  );

  const expectedRaceName = normalizeRaceName_(
    currentRace?.race_name ||
    nascarRace?.race_name ||
    ""
  );

  const isCorrectCupRace =
    liveSeriesId === 1 &&
    (
      (liveRaceId && expectedNascarRaceId && liveRaceId === expectedNascarRaceId) ||
      (
        liveRaceName &&
        expectedRaceName &&
        (
          liveRaceName.includes(expectedRaceName) ||
          expectedRaceName.includes(liveRaceName)
        )
      )
    );

  return {
    liveSeriesId,
    liveRaceId,
    expectedNascarRaceId,
    liveRaceName,
    expectedRaceName,
    isCorrectCupRace
  };
}

export async function getCurrentCupLiveContext_(env, options = {}) {
  const headers = options.headers || supabaseHeaders_(env);
  const debug = {
    source: options.source || "unknown",
    checkedAt: new Date().toISOString()
  };

  const currentRace = await resolveCurrentDbRace_(env, headers);
  if (!currentRace) {
    return {
      ok: false,
      reason: "no_current_db_race",
      debug
    };
  }

  debug.dbRaceId = Number(currentRace.id);
  debug.dbRaceName = currentRace.race_name || "";
  debug.dbRaceNumber = Number(currentRace.race_number);
  debug.dbSeasonYear = Number(currentRace.season_year);

  const nascarRace = await resolveNascarCupRace_(currentRace);
  if (!nascarRace) {
    return {
      ok: false,
      reason: "could_not_resolve_nascar_race",
      currentRace,
      debug
    };
  }

  debug.expectedNascarRaceId = Number(nascarRace?.race_id ?? 0);
  debug.expectedNascarRaceName = nascarRace?.race_name || "";

  const liveJson = await fetchNascarJson_(
    `https://cf.nascar.com/live/feeds/live-feed.json`
  );

  const liveMatch = liveRaceMatchesExpected_(liveJson, currentRace, nascarRace);
  const flagState = Number(liveJson?.flag_state ?? NaN);
  const lapNumber = Number(liveJson?.lap_number ?? NaN);
  const lapsToGo = Number(liveJson?.laps_to_go ?? NaN);

  Object.assign(debug, {
    liveSeriesId: liveMatch.liveSeriesId,
    liveRaceId: liveMatch.liveRaceId,
    liveRaceName: liveMatch.liveRaceName,
    expectedRaceName: liveMatch.expectedRaceName,
    isCorrectCupRace: liveMatch.isCorrectCupRace,
    flagState: Number.isFinite(flagState) ? flagState : null,
    lapNumber: Number.isFinite(lapNumber) ? lapNumber : null,
    lapsToGo: Number.isFinite(lapsToGo) ? lapsToGo : null
  });

  return {
    ok: true,
    currentRace,
    nascarRace,
    liveJson,
    flagState,
    lapNumber,
    lapsToGo,
    ...liveMatch,
    debug
  };
}

function evaluateGreenFlagStart_(context) {
  if (!context?.ok) {
    return {
      shouldSend: false,
      reason: context?.reason || "live_context_failed"
    };
  }

  if (!context.isCorrectCupRace) {
    return {
      shouldSend: false,
      reason: "wrong_live_race"
    };
  }

  if (Number(context.flagState) !== 1) {
    return {
      shouldSend: false,
      reason: "flag_not_green"
    };
  }

  if (!Number.isFinite(context.lapNumber)) {
    return {
      shouldSend: false,
      reason: "missing_lap_number"
    };
  }

  if (Number(context.lapNumber) < 1) {
    return {
      shouldSend: false,
      reason: "race_not_started"
    };
  }

  if (Number(context.lapNumber) > GREEN_FLAG_MAX_START_LAP) {
    return {
      shouldSend: false,
      reason: "too_late_for_initial_green"
    };
  }

  return {
    shouldSend: true,
    reason: "initial_green_window"
  };
}

async function getExistingGreenFlagEvent_(env, headers, raceId) {
  if (!raceId) return { exists: false };

  const rows = await getSupabaseJson_(
    env,
    `/rest/v1/push_event_log?select=race_id,event_type&race_id=eq.${Number(raceId)}&event_type=eq.${encodeURIComponent(GREEN_FLAG_EVENT_TYPE)}&limit=1`,
    headers
  );

  return {
    exists: Array.isArray(rows) && rows.length > 0
  };
}

async function insertGreenFlagEvent_(env, headers, raceId) {
  const insertRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/push_event_log`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        race_id: Number(raceId),
        event_type: GREEN_FLAG_EVENT_TYPE
      })
    }
  );

  if (insertRes.status === 409) {
    return {
      ok: false,
      alreadySent: true,
      details: "unique_guard_conflict"
    };
  }

  const text = await insertRes.text();

  if (!insertRes.ok) {
    return {
      ok: false,
      alreadySent: false,
      status: insertRes.status,
      details: text || "insert_failed"
    };
  }

  return {
    ok: true
  };
}

function summarizeContext_(context) {
  const debug = context?.debug || {};
  return {
    dbRaceId: debug.dbRaceId ?? null,
    dbRaceName: debug.dbRaceName ?? "",
    dbRaceNumber: debug.dbRaceNumber ?? null,
    dbSeasonYear: debug.dbSeasonYear ?? null,
    expectedNascarRaceId: debug.expectedNascarRaceId ?? null,
    expectedNascarRaceName: debug.expectedNascarRaceName ?? "",
    liveSeriesId: debug.liveSeriesId ?? null,
    liveRaceId: debug.liveRaceId ?? null,
    liveRaceName: debug.liveRaceName ?? "",
    expectedRaceName: debug.expectedRaceName ?? "",
    isCorrectCupRace: debug.isCorrectCupRace ?? false,
    flagState: debug.flagState ?? null,
    lapNumber: debug.lapNumber ?? null,
    lapsToGo: debug.lapsToGo ?? null
  };
}

function logGreenFlagCheck_(result) {
  const summary = result?.context || {};
  console.log("[green-flag-check]", JSON.stringify({
    source: result?.source || "unknown",
    dryRun: Boolean(result?.dryRun),
    raceId: summary.dbRaceId ?? null,
    currentDbRace: summary.dbRaceName || "",
    expectedNascarRaceId: summary.expectedNascarRaceId ?? null,
    liveNascarRaceId: summary.liveRaceId ?? null,
    flagState: summary.flagState ?? null,
    lapNumber: summary.lapNumber ?? null,
    isCorrectCupRace: Boolean(summary.isCorrectCupRace),
    sent: Boolean(result?.sent),
    wouldSend: Boolean(result?.wouldSend),
    reason: result?.reason || ""
  }));
}

export async function checkGreenFlagStartPush_(options = {}) {
  const {
    env,
    dryRun = false,
    source = "scheduled"
  } = options;

  const headers = supabaseHeaders_(env);
  const context = await getCurrentCupLiveContext_(env, { headers, source });
  const decision = evaluateGreenFlagStart_(context);
  const raceId = Number(context?.currentRace?.id || 0);
  const existing = await getExistingGreenFlagEvent_(env, headers, raceId).catch(err => ({
    exists: false,
    error: err.message || String(err)
  }));

  const result = {
    ok: true,
    source,
    dryRun,
    eventType: GREEN_FLAG_EVENT_TYPE,
    sent: false,
    wouldSend: false,
    reason: decision.reason,
    decision,
    existing,
    context: summarizeContext_(context)
  };

  if (existing.exists) {
    result.reason = "already_sent";
    result.decision = {
      ...decision,
      shouldSend: false,
      reason: "already_sent"
    };
    logGreenFlagCheck_(result);
    return result;
  }

  if (!decision.shouldSend) {
    logGreenFlagCheck_(result);
    return result;
  }

  result.wouldSend = true;

  if (dryRun) {
    logGreenFlagCheck_(result);
    return result;
  }

  const insert = await insertGreenFlagEvent_(env, headers, raceId);
  if (insert.alreadySent) {
    result.wouldSend = false;
    result.reason = "already_sent";
    result.decision = {
      ...decision,
      shouldSend: false,
      reason: "already_sent"
    };
    logGreenFlagCheck_(result);
    return result;
  }

  if (!insert.ok) {
    result.ok = false;
    result.wouldSend = false;
    result.reason = "log_insert_failed";
    result.logInsert = insert;
    logGreenFlagCheck_(result);
    return result;
  }

  try {
    result.push = await sendAllNotifications(env, {
      title: "GREEN FLAG!!!",
      body: "BOOGITY,BOOGITY,BOOGITY! Let's go racin boys!",
      url: "/"
    });
    result.sent = true;
    result.reason = "sent";
  } catch (err) {
    result.ok = false;
    result.sent = false;
    result.reason = "push_send_failed_after_log_insert";
    result.error = err.message || String(err);
  }

  logGreenFlagCheck_(result);
  return result;
}
