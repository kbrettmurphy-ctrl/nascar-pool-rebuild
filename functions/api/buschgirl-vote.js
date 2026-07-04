import { verifyAdminRequest, json } from "./_admin-auth";

// POST: any player votes on a photo. { photoId, playerName, vote: 1 | -1 }
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const body = await request.json().catch(() => ({}));
    const photoId = String(body?.photoId || "").trim();
    const playerName = String(body?.playerName || "").trim();
    const vote = Number(body?.vote);

    if (!photoId || photoId.length > 64) {
      return json({ ok: false, error: "photoId is required" }, 400);
    }
    if (!playerName) {
      return json({ ok: false, error: "playerName is required" }, 400);
    }
    if (vote !== 1 && vote !== -1) {
      return json({ ok: false, error: "vote must be 1 or -1" }, 400);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirl_votes?on_conflict=photo_id,player_name`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify([{
          photo_id: photoId,
          player_name: playerName,
          vote
        }])
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return json({ ok: false, error: text || "Vote failed" }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

// GET (admin): photo popularity report, least popular first.
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
      const data = text ? JSON.parse(text) : [];
      if (!res.ok) throw new Error(text || "Supabase read failed");
      return data;
    }

    const [votes, photos] = await Promise.all([
      getJson(`/rest/v1/buschgirl_votes?select=photo_id,vote`),
      getJson(`/rest/v1/buschgirls_photos?select=id,folder,filename,url&active=eq.true`)
    ]);

    const tally = new Map();
    for (const v of votes || []) {
      const id = String(v.photo_id);
      if (!tally.has(id)) tally.set(id, { likes: 0, dislikes: 0 });
      const t = tally.get(id);
      if (Number(v.vote) === 1) t.likes++;
      else if (Number(v.vote) === -1) t.dislikes++;
    }

    const rows = (photos || []).map(p => {
      const t = tally.get(String(p.id)) || { likes: 0, dislikes: 0 };
      return {
        id: p.id,
        folder: p.folder,
        filename: p.filename,
        url: p.url,
        likes: t.likes,
        dislikes: t.dislikes,
        net: t.likes - t.dislikes
      };
    });

    // Least popular first so the cut list is on top.
    rows.sort((a, b) => a.net - b.net || b.dislikes - a.dislikes);

    return json({ ok: true, photos: rows, totalVotes: (votes || []).length });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
