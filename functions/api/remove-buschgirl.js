import { verifyAdminRequest, json } from "./_admin-auth";

// POST (admin): soft-remove a photo by flagging it inactive.
// The gallery API only serves active=true, so it disappears everywhere.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const photoId = Number(body?.photoId);

    if (!Number.isInteger(photoId) || photoId <= 0) {
      return json({ ok: false, error: "photoId is required" }, 400);
    }

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${photoId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ active: false })
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return json({ ok: false, error: text || "Remove failed" }, 500);
    }

    return json({ ok: true, photoId });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
