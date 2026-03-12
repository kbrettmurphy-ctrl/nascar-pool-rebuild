import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json();
    const tournamentId = Number(body?.tournamentId);

    if (!Number.isInteger(tournamentId)) {
      return json({ ok: false, error: "tournamentId is required" }, 400);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tournament_players?tournament_id=eq.${tournamentId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Prefer: "return=representation"
        },
        body: JSON.stringify({ seed: null })
      }
    );

    const text = await res.text();
    const data = text ? JSON.parse(text) : [];

    if (!res.ok) {
      return json({ ok: false, error: text || "Failed to clear seeds" }, 500);
    }

    return json({
      ok: true,
      message: `Cleared seeds for tournament ${tournamentId}`,
      data
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}