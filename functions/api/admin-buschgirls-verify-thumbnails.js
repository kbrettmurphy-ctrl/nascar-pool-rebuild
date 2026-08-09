import { verifyAdminRequest } from "./_admin-auth";
import { BUSCH_FOLDERS, privateJson, serviceHeaders } from "./_buschgirls-admin";

// Rows can claim a thumbnail that isn't actually in storage (a failed
// backfill pass, a deleted object). The regular backfill only looks for
// NULL sha256/thumbnail_path, so those rows are invisible to it and it
// reports "complete 0/0" while tiles render broken.
// GET  -> report which indexed rows have no thumbnail file
// POST -> clear their index fields so the normal backfill rebuilds them
const PAGE = 1000;
const MAX_LIST_CALLS = 40; // stay well under the Workers subrequest cap

class UpstreamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function indexedRows(env) {
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id,folder,filename,thumbnail_path&thumbnail_path=not.is.null&order=id.asc`,
      { headers: serviceHeaders(env, { Range: `${start}-${start + PAGE - 1}` }) }
    );
    if (!res.ok) throw new UpstreamError(res.status, "Indexed row query failed");
    const batch = await res.json().catch(() => []);
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function existingThumbnails(env) {
  const paths = new Set();
  let calls = 0;
  for (const folder of BUSCH_FOLDERS) {
    for (let offset = 0; ; offset += PAGE) {
      if (++calls > MAX_LIST_CALLS) return { paths, truncated: true };
      const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/buschgirls-thumbnails`, {
        method: "POST",
        headers: serviceHeaders(env, { "Content-Type": "application/json" }),
        body: JSON.stringify({ prefix: `${folder}/`, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } })
      });
      if (!res.ok) throw new UpstreamError(res.status, "Thumbnail listing failed");
      const items = await res.json().catch(() => []);
      for (const item of items) if (item?.name) paths.add(`${folder}/${item.name}`);
      if (items.length < PAGE) break;
    }
  }
  return { paths, truncated: false };
}

async function unindexedCount(env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id&or=(sha256.is.null,thumbnail_path.is.null)`,
    { headers: serviceHeaders(env, { Prefer: "count=exact", Range: "0-0" }) }
  );
  return Number((res.headers.get("content-range") || "").split("/")[1] || 0);
}

async function findMissing(env) {
  const [rows, listing, unindexed] = await Promise.all([
    indexedRows(env), existingThumbnails(env), unindexedCount(env)
  ]);
  const missing = rows.filter(r => !listing.paths.has(String(r.thumbnail_path || "")));
  return { rows, missing, unindexed, truncated: listing.truncated };
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const { rows, missing, unindexed, truncated } = await findMissing(env);
    return privateJson({
      ok: true,
      indexed: rows.length,
      missing: missing.length,
      unindexed,
      truncated,
      sample: missing.slice(0, 8).map(r => `${r.folder}/${r.filename}`)
    });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, error.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== true) return privateJson({ ok: false, error: "confirm:true required" }, 400);

    const { missing, truncated } = await findMissing(env);
    let requeued = 0;

    for (let i = 0; i < missing.length; i += 50) {
      const ids = missing.slice(i, i + 50).map(r => r.id);
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=in.(${ids.join(",")})`,
        {
          method: "PATCH",
          headers: serviceHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
          body: JSON.stringify({ sha256: null, thumbnail_path: null, indexed_at: null })
        }
      );
      if (!res.ok) throw new UpstreamError(res.status, "Re-queue update failed");
      requeued += ids.length;
    }

    return privateJson({ ok: true, requeued, truncated });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, error.status || 500);
  }
}
