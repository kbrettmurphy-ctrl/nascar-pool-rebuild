import { verifyAdminRequest, json } from "./_admin-auth";

// POST (admin): reassign one photo to a different folder.
// Moves the storage object server-side, then patches its canonical path.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const photoId = String(body?.photoId || "").trim();
    const to = String(body?.toFolder || "").trim().toLowerCase();

    const allowed = new Set(["soft", "old", "spicy", "spicier"]);
    if (!photoId || photoId.length > 64) {
      return json({ ok: false, error: "photoId is required" }, 400);
    }
    if (!allowed.has(to)) {
      return json({ ok: false, error: "Invalid folder" }, 400);
    }

    const sb = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    const readRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${encodeURIComponent(photoId)}&select=id,folder,filename,url,storage_path`,
      { headers: sb }
    );
    const rows = await readRes.json().catch(() => []);
    if (!readRes.ok || !Array.isArray(rows) || !rows.length) {
      return json({ ok: false, error: "Photo not found" }, 404);
    }

    const row = rows[0];
    const from = String(row.folder || "").trim().toLowerCase();
    if (from === to) return json({ ok: true, moved: false, to });

    const filename = String(row.filename || "");
    if (!filename) return json({ ok: false, error: "Row has no filename" }, 500);

    const mv = await fetch(`${env.SUPABASE_URL}/storage/v1/object/move`, {
      method: "POST",
      headers: { ...sb, "Content-Type": "application/json" },
      body: JSON.stringify({
        bucketId: "buschgirls",
        sourceKey: `${from}/${filename}`,
        destinationKey: `${to}/${filename}`,
      }),
    });
    if (!mv.ok) {
      const t = await mv.text();
      return json({ ok: false, error: (t || "Storage move failed").slice(0, 200) }, 500);
    }

    const newUrl = String(row.url || "").replace(
      `/buschgirls/${from}/`,
      `/buschgirls/${to}/`
    );

    const up = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${encodeURIComponent(photoId)}`,
      {
        method: "PATCH",
        headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ folder: to, storage_path: `${to}/${filename}`, url: newUrl }),
      }
    );
    if (!up.ok) {
      const t = await up.text();
      return json({ ok: false, error: (t || "DB update failed").slice(0, 200) }, 500);
    }

    return json({ ok: true, moved: true, from, to });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
