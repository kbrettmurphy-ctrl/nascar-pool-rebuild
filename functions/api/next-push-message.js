export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    const playerName = String(url.searchParams.get("playerName") || "").trim();

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
    };

    const filters = playerName
      ? `or=(player_name.is.null,player_name.eq.${encodeURIComponent(playerName)})`
      : `player_name.is.null`;

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_messages?select=id,title,body,url,player_name,created_at&delivered=eq.false&${filters}&order=created_at.asc&limit=1`,
      { headers }
    );

    const text = await res.text();
    const rows = text ? JSON.parse(text) : [];

    if (!res.ok) {
      return json({ ok: false, error: text || "Failed loading push message" }, 500);
    }

    const msg = Array.isArray(rows) && rows.length ? rows[0] : null;

    if (!msg) {
      return json({
        ok: true,
        message: null
      });
    }

    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_messages?id=eq.${msg.id}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ delivered: true })
      }
    );

    if (!patchRes.ok) {
      const patchText = await patchRes.text();
      return json({ ok: false, error: patchText || "Failed marking push delivered" }, 500);
    }

    return json({
      ok: true,
      message: {
        title: msg.title || "NASCAR Pool",
        body: msg.body || "New update available.",
        url: msg.url || "/"
      }
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
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
