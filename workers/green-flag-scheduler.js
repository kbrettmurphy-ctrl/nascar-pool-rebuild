import { checkGreenFlagStartPush_ } from "../functions/api/_green-flag.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runGreenFlagSchedule_(event, env));
  },

  async fetch() {
    return new Response(JSON.stringify({
      ok: true,
      worker: "nascar-pool-green-flag-scheduler"
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });
  }
};

async function runGreenFlagSchedule_(event, env) {
  try {
    const result = await checkGreenFlagStartPush_({
      env,
      dryRun: false,
      source: `cron:${event?.cron || "unknown"}`
    });

    console.log("[green-flag-scheduler]", JSON.stringify({
      cron: event?.cron || "",
      scheduledTime: event?.scheduledTime || null,
      ok: result.ok,
      sent: result.sent,
      reason: result.reason,
      raceId: result.context?.dbRaceId ?? null,
      expectedNascarRaceId: result.context?.expectedNascarRaceId ?? null,
      liveNascarRaceId: result.context?.liveRaceId ?? null,
      flagState: result.context?.flagState ?? null,
      lapNumber: result.context?.lapNumber ?? null
    }));
  } catch (err) {
    console.log("[green-flag-scheduler:error]", err.message || String(err));
    throw err;
  }
}
