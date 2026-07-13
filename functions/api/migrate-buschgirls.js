import { verifyAdminRequest, json } from "./_admin-auth";

// One-time-ish admin tool: move photos between folders in the
// buschgirls bucket and fix their DB rows (folder + url).
// POST { from, to, since, dryRun } - dryRun returns the hit list
// without touching anything.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const from = String(body?.from || "").trim().toLowerCase();
    const to = String(body?.to || "").trim().toLowerCase();
    const since = String(body?.since || "").trim();
    const dryRun = body?.dryRun !== false;

    const allowed = new Set(["soft", "old", "spicy", "spicier"]);
    if (!allowed.has(from) || !allowed.has(to) || from === to) {
      return json({ ok: false, error: "Bad from/to folder" }, 400);
    }
    if (!since || Number.isNaN(Date.parse(since))) {
      return json({ ok: false, error: "since must be a valid timestamp" }, 400);
    }

    const sb = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    const listRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?folder=eq.${from}` +
      `&uploaded_at=gte.${encodeURIComponent(since)}` +
      `&select=id,filename,url,uploaded_at&order=uploaded_at.asc`,
      { headers: sb }
    );
    const rows = await listRes.json().catch(() => []);
    if (!listRes.ok) return json({ ok: false, error: "List failed" }, 500);

    if (dryRun) {
      return json({
        ok: true,
        dryRun: true,
        count: rows.length,
        sample: rows.slice(0, 5).map(r => r.filename),
        oldest: rows[0]?.uploaded_at || null,
        newest: rows[rows.length - 1]?.uploaded_at || null,
      });
    }

    let moved = 0;
    const failed = [];

    for (const r of rows) {
      const filename = String(r.filename || "");
      try {
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
          failed.push({ filename, step: "storage", error: t.slice(0, 120) });
          continue;
        }

        const newUrl = String(r.url || "").replace(
          `/buschgirls/${from}/`,
          `/buschgirls/${to}/`
        );
        const up = await fetch(
          `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${encodeURIComponent(r.id)}`,
          {
            method: "PATCH",
            headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ folder: to, url: newUrl }),
          }
        );
        if (!up.ok) {
          const t = await up.text();
          failed.push({ filename, step: "db", error: t.slice(0, 120) });
          continue;
        }
        moved++;
      } catch (e) {
        failed.push({ filename, step: "exception", error: String(e).slice(0, 120) });
      }
    }

    return json({ ok: true, dryRun: false, moved, failedCount: failed.length, failed: failed.slice(0, 10) });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
