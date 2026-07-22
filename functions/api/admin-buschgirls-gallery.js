import { verifyAdminRequest } from "./_admin-auth";
import { BUSCH_FOLDERS, privateJson, serviceHeaders, signThumbnail } from "./_buschgirls-admin";

const SORTS = {
  newest: "uploaded_at.desc.nullslast,id.desc",
  oldest: "uploaded_at.asc.nullslast,id.asc",
  filename_asc: "filename.asc,id.asc",
  filename_desc: "filename.desc,id.desc"
};
const ACTIVE_STATES = new Set(["all", "active", "inactive"]);
const INDEXING_STATES = new Set(["all", "ready", "needs_indexing"]);
const DUPLICATE_STATES = new Set(["all", "exact"]);

function countFrom(response) {
  const match = (response.headers.get("content-range") || "").match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function exactCount(env, filters) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id${filters}`, {
    headers: serviceHeaders(env, { Prefer: "count=exact", Range: "0-0" })
  });
  if (!response.ok) throw new Error("Gallery count query failed");
  return countFrom(response);
}

async function duplicateHashes(env) {
  const hashes = new Map();
  for (let start = 0; ; start += 1000) {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=sha256&sha256=not.is.null&order=sha256.asc`,
      { headers: serviceHeaders(env, { Range: `${start}-${start + 999}` }) }
    );
    if (!response.ok) throw new Error("Duplicate hash query failed");
    const rows = await response.json().catch(() => []);
    for (const row of rows) hashes.set(row.sha256, (hashes.get(row.sha256) || 0) + 1);
    if (rows.length < 1000) break;
  }
  return Array.from(hashes, ([hash, count]) => count > 1 ? hash : null).filter(Boolean);
}

function buildBaseFilters({ folder, search, activeState, indexingState }) {
  let filters = folder === "all" ? "" : `&folder=eq.${encodeURIComponent(folder)}`;
  if (search) filters += `&filename=ilike.${encodeURIComponent(`*${search}*`)}`;
  if (activeState !== "all") filters += `&active=eq.${activeState === "active"}`;
  if (indexingState === "ready") filters += "&sha256=not.is.null&thumbnail_path=not.is.null";
  if (indexingState === "needs_indexing") filters += "&or=(sha256.is.null,thumbnail_path.is.null)";
  return filters;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") || 1);
    const pageSize = Number(params.get("pageSize") || 80);
    const folder = String(params.get("folder") || "all").toLowerCase();
    const search = String(params.get("search") || "").trim();
    const sort = String(params.get("sort") || "newest").toLowerCase();
    const activeState = String(params.get("activeState") || "all").toLowerCase();
    const indexingState = String(params.get("indexingState") || "all").toLowerCase();
    const duplicateState = String(params.get("duplicateState") || "all").toLowerCase();

    if (!Number.isInteger(page) || page < 1) return privateJson({ ok: false, error: "Invalid page" }, 400);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return privateJson({ ok: false, error: "Invalid pageSize" }, 400);
    if (folder !== "all" && !BUSCH_FOLDERS.has(folder)) return privateJson({ ok: false, error: "Invalid folder" }, 400);
    if (search.length > 100 || /[\u0000-\u001f]/.test(search)) return privateJson({ ok: false, error: "Invalid search" }, 400);
    if (!SORTS[sort]) return privateJson({ ok: false, error: "Invalid sort" }, 400);
    if (!ACTIVE_STATES.has(activeState)) return privateJson({ ok: false, error: "Invalid activeState" }, 400);
    if (!INDEXING_STATES.has(indexingState)) return privateJson({ ok: false, error: "Invalid indexingState" }, 400);
    if (!DUPLICATE_STATES.has(duplicateState)) return privateJson({ ok: false, error: "Invalid duplicateState" }, 400);

    const baseFilters = buildBaseFilters({ folder, search, activeState, indexingState });
    const [hashCount, unindexedCount, duplicates] = await Promise.all([
      exactCount(env, "&sha256=not.is.null"),
      exactCount(env, `${baseFilters}&or=(sha256.is.null,thumbnail_path.is.null)`),
      duplicateState === "exact" ? duplicateHashes(env) : Promise.resolve([])
    ]);
    let filters = baseFilters;
    if (duplicateState === "exact") {
      filters += duplicates.length ? `&sha256=in.(${duplicates.join(",")})` : "&sha256=eq.__no_duplicate_hash__";
    }

    const total = await exactCount(env, filters);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const rangeStart = (safePage - 1) * pageSize;
    const listResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id,folder,filename,url,uploaded_at,active,thumbnail_path${filters}&order=${SORTS[sort]}`,
      { headers: serviceHeaders(env, { Range: `${rangeStart}-${rangeStart + pageSize - 1}` }) }
    );
    if (!listResponse.ok) throw new Error("Gallery list query failed");
    const rows = await listResponse.json().catch(() => []);
    const photos = await Promise.all(rows.map(async row => {
      const signedThumbnail = row.thumbnail_path ? await signThumbnail(env, row.thumbnail_path) : null;
      return {
        id: row.id, folder: row.folder, filename: row.filename, url: row.url,
        uploaded_at: row.uploaded_at, active: row.active,
        thumbnailUrl: signedThumbnail || row.url,
        thumbnailReady: Boolean(signedThumbnail)
      };
    }));
    return privateJson({
      ok: true, photos, page: safePage, pageSize, total, totalPages,
      unindexedCount, hashCount, duplicateFilterAvailable: hashCount > 0
    });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || "Gallery request failed" }, 500);
  }
}
