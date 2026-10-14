import { verifyAdminRequest, json } from "./_admin-auth";

// POST (admin): take a photo out of the member rotation by flagging it
// inactive, or put it back with { active: true }. Nothing is deleted.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const photoId = String(body?.photoId || "").trim();
    const active = body?.active === true;

    if (!photoId || photoId.length > 64) {
      return json({ ok: false, error: "photoId is required" }, 400);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${encodeURIComponent(photoId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ active })
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return json({ ok: false, error: text || "Remove failed" }, 500);
    }

    return json({ ok: true, photoId, active });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
