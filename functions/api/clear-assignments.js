import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json();
    const raceId = Number(body?.raceId);

    if (!Number.isInteger(raceId) || raceId <= 0) {
      return json({ ok: false, error: "raceId is required" }, 400);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/player_assignments?race_id=eq.${raceId}`,
      {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
        }
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return json({ ok: false, error: text || "Failed to clear assignments" }, 500);
    }

    return json({ ok: true, message: "Assignments cleared." });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
