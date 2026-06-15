import { verifyAdminRequest, json } from "./_admin-auth";
import { sendPlayerNotification } from "./_push";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json();
    const raceId = Number(body?.raceId);

    if (!Number.isInteger(raceId)) {
      return json({ ok: false, error: "raceId is required" }, 400);
    }

    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/generate_assignments_for_race`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
        body: JSON.stringify({ target_race_id: raceId }),
      }
    );

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      return json({ ok: false, error: text || "Failed to generate assignments" }, 500);
    }

    if (!Array.isArray(data) || data.length === 0) {
      return json({
        ok: false,
        error: `generate_assignments_for_race returned no rows for race ${raceId}`
      }, 500);
    }

    const pushResults = [];

    for (const row of data || []) {
      const playerName = String(row?.player_name || "").trim();
      const nums = Array.isArray(row?.assigned_numbers)
        ? row.assigned_numbers.join(" and ")
        : String(row?.assigned_numbers || "").trim();

      if (!playerName || !nums) continue;

      try {
        const raceName =
          String(body?.raceName || "").trim() ||
          String(row?.race_name || "").trim() ||
          `Race ${raceId}`;

        const push = await sendPlayerNotification(env, playerName, {
          title: "Assignments Posted",
          body: `${raceName} assignments are live. Your numbers: ${nums.replace(/,/g, " & ")}.`,
          url: "/"
        });

        pushResults.push({ playerName, ...push });
      } catch (err) {
        pushResults.push({
          playerName,
          sent: 0,
          failed: 1,
          error: err.message || String(err)
        });
      }
    }

    return json({
      ok: true,
      raceId,
      message: `Assignments generated for race ${raceId}`,
      data,
      pushResults
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
