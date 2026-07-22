import { verifyAdminRequest } from "./_admin-auth";
import { privateJson, serviceHeaders, storageObjectUrl, UUID_RE } from "./_buschgirls-admin";

async function storageDelete(env, bucket, path) {
  if (!path) return { ok: true };
  const response = await fetch(storageObjectUrl(env, bucket, path), { method: "DELETE", headers: serviceHeaders(env) });
  return { ok: response.ok || response.status === 404, status: response.status, detail: response.ok ? "" : await response.text() };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    if (request.headers.get("sec-fetch-site") === "cross-site") return privateJson({ ok: false, error: "Cross-site request rejected" }, 403);
    const body = await request.json().catch(() => ({}));
    const id = String(body.photoId || "").trim();
    if (!UUID_RE.test(id)) return privateJson({ ok: false, error: "Invalid photoId" }, 400);
    const lookup = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${id}&select=id,folder,filename,thumbnail_path,active&limit=1`, { headers: serviceHeaders(env) });
    const rows = await lookup.json().catch(() => []);
    if (!lookup.ok) throw new Error("Photo lookup failed");
    if (!rows[0]) return privateJson({ ok: true, photoId: id, alreadyDeleted: true });
    const photo = rows[0];

    const deactivate = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${id}`, {
      method: "PATCH", headers: serviceHeaders(env, { "Content-Type": "application/json" }), body: JSON.stringify({ active: false })
    });
    if (!deactivate.ok) throw new Error("Unable to deactivate photo before deletion");
    const [original, thumbnail] = await Promise.all([
      storageDelete(env, "buschgirls", `${photo.folder}/${photo.filename}`),
      storageDelete(env, "buschgirls-thumbnails", photo.thumbnail_path)
    ]);
    if (!original.ok || !thumbnail.ok) {
      return privateJson({ ok: false, partial: true, photoId: id, error: "Storage deletion was incomplete; the database row was left inactive for safe retry", original, thumbnail }, 502);
    }
    const votes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirl_votes?photo_id=eq.${id}`, { method: "DELETE", headers: serviceHeaders(env) });
    if (!votes.ok) return privateJson({ ok: false, partial: true, photoId: id, error: "Files deleted but vote cleanup failed; retry is safe" }, 502);
    const rowDelete = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${id}`, { method: "DELETE", headers: serviceHeaders(env) });
    if (!rowDelete.ok) return privateJson({ ok: false, partial: true, photoId: id, error: "Files and votes deleted but database row cleanup failed; retry is safe" }, 502);
    return privateJson({ ok: true, photoId: id, path: `${photo.folder}/${photo.filename}` });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, 500);
  }
}
