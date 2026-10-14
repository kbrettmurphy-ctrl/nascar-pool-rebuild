import { json } from "./_admin-auth.js";
import { memberAuthResponse, requirePoolMember } from "./_member-auth.js";

// POST: an authenticated member votes. Player identity is server-derived.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const member = await requirePoolMember(request, env);

    const body = await request.json().catch(() => ({}));
    const photoId = String(body?.photoId || "").trim();
    const playerName = member.playerName;
    const vote = Number(body?.vote);

    if (!photoId || photoId.length > 64) {
      return json({ ok: false, error: "photoId is required" }, 400);
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
    if (err?.name === "MemberAuthError") return memberAuthResponse(err);
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
