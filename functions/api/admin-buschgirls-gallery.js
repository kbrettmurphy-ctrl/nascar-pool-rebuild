import { verifyAdminRequest } from "./_admin-auth";
import { BUSCH_FOLDERS, privateJson, serviceHeaders, signThumbnail } from "./_buschgirls-admin";

function countFrom(response) {
  const match = (response.headers.get("content-range") || "").match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function exactCount(env, filters) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id${filters}`,
    { headers: serviceHeaders(env, { Prefer: "count=exact", Range: "0-0" }) }
  );
  if (!response.ok) throw new Error(await response.text() || "Count failed");
  return countFrom(response);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 80);
    const folder = String(url.searchParams.get("folder") || "all").toLowerCase();
    if (!Number.isInteger(page) || page < 1) return privateJson({ ok: false, error: "Invalid page" }, 400);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return privateJson({ ok: false, error: "Invalid pageSize" }, 400);
    if (folder !== "all" && !BUSCH_FOLDERS.has(folder)) return privateJson({ ok: false, error: "Invalid folder" }, 400);

    const filter = folder === "all" ? "" : `&folder=eq.${encodeURIComponent(folder)}`;
    const rangeStart = (page - 1) * pageSize;
    const [listResponse, total, unindexedCount] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id,folder,filename,url,uploaded_at,active,thumbnail_path${filter}&order=uploaded_at.desc.nullslast,id.desc`, {
        headers: serviceHeaders(env, { Range: `${rangeStart}-${rangeStart + pageSize - 1}` })
      }),
      exactCount(env, filter),
      exactCount(env, `${filter}&or=(sha256.is.null,thumbnail_path.is.null)`)
    ]);
    const text = await listResponse.text();
    if (!listResponse.ok) throw new Error(text || "Gallery query failed");
    const rows = text ? JSON.parse(text) : [];
    const photos = await Promise.all(rows.map(async row => ({
      id: row.id,
      folder: row.folder,
      filename: row.filename,
      url: row.url,
      uploaded_at: row.uploaded_at,
      active: row.active,
      thumbnailUrl: row.thumbnail_path ? await signThumbnail(env, row.thumbnail_path) : null,
      thumbnailReady: Boolean(row.thumbnail_path)
    })));
    return privateJson({ ok: true, photos, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), unindexedCount });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, 500);
  }
}
