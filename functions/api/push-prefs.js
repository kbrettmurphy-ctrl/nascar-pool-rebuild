import { verifyAdminRequest, json } from "./_admin-auth";

// GET ?endpoint=<url>
//   Device asks about its own subscription: { found, paused, playerName }
// GET ?all=1 (admin)
//   Roster view: every player's device count + active state
export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    if (url.searchParams.get("all") === "1") {
      const isAdmin = await verifyAdminRequest(request, env);
      if (!isAdmin) return json({ ok: false, error: "Unauthorized" }, 401);

      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=player_name,paused`,
        {
          headers: {
            apikey: env.SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          },
        }
      );

      const rows = await res.json().catch(() => []);
      if (!res.ok) return json({ ok: false, error: "Lookup failed" }, 500);

      const byName = new Map();
      for (const r of rows || []) {
        const n = String(r.player_name || "").trim() || "(no name)";
        if (!byName.has(n)) byName.set(n, { playerName: n, devices: 0, active: false });
        const p = byName.get(n);
        p.devices++;
        if (!r.paused) p.active = true;
      }

      return json({
        ok: true,
        players: [...byName.values()].sort((a, b) =>
          a.playerName.localeCompare(b.playerName)),
      });
    }

    const endpoint = String(url.searchParams.get("endpoint") || "").trim();

    if (!endpoint) {
      return json({ ok: false, error: "endpoint is required" }, 400);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&select=paused,player_name`,
      {
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      }
    );

    const rows = await res.json().catch(() => []);
    if (!res.ok) {
      return json({ ok: false, error: "Lookup failed" }, 500);
    }

    return json({
      ok: true,
      found: Array.isArray(rows) && rows.length > 0,
      paused: !!rows?.[0]?.paused,
      playerName: rows?.[0]?.player_name || "",
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

// POST { endpoint, paused }          - device pauses/resumes itself
// POST { playerName, paused }        - admin pauses/resumes a player
//                                      (all their devices; needs token)
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));

    const paused = body?.paused;
    if (typeof paused !== "boolean") {
      return json({ ok: false, error: "paused must be true or false" }, 400);
    }

    const endpoint = String(body?.endpoint || "").trim();
    const playerName = String(body?.playerName || "").trim();

    let filter;
    if (playerName) {
      const isAdmin = await verifyAdminRequest(request, env);
      if (!isAdmin) return json({ ok: false, error: "Unauthorized" }, 401);
      filter = `player_name=eq.${encodeURIComponent(playerName)}`;
    } else if (endpoint) {
      filter = `endpoint=eq.${encodeURIComponent(endpoint)}`;
    } else {
      return json({ ok: false, error: "endpoint or playerName is required" }, 400);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?${filter}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({ paused }),
      }
    );

    const rows = await res.json().catch(() => []);
    if (!res.ok) {
      return json({ ok: false, error: "Update failed" }, 500);
    }

    return json({ ok: true, paused, updated: Array.isArray(rows) ? rows.length : 0 });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
