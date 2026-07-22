import { verifyAdminRequest } from "./_admin-auth";
import { privateJson, serviceHeaders, storageObjectUrl, UUID_RE } from "./_buschgirls-admin";

export async function onRequestPost({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const form = await request.formData();
    const id = String(form.get("photoId") || "").trim();
    const sha256 = String(form.get("sha256") || "").trim().toLowerCase();
    const thumbnail = form.get("thumbnail");
    if (!UUID_RE.test(id) || !/^[0-9a-f]{64}$/.test(sha256)) return privateJson({ ok: false, error: "Invalid indexing data" }, 400);
    if (!thumbnail || thumbnail.type !== "image/webp" || typeof thumbnail.arrayBuffer !== "function") return privateJson({ ok: false, error: "WebP thumbnail is required" }, 400);
    const rowRes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${id}&select=id,folder,filename&limit=1`, { headers: serviceHeaders(env) });
    const rows = await rowRes.json().catch(() => []);
    if (!rowRes.ok) throw new Error("Photo lookup failed");
    if (!rows[0]) return privateJson({ ok: false, error: "Photo not found" }, 404);
    const thumbnailPath = `${rows[0].folder}/${id}.webp`;
    const bytes = await thumbnail.arrayBuffer();
    if (bytes.byteLength > 2_000_000) return privateJson({ ok: false, error: "Thumbnail is too large" }, 413);
    const signature = new Uint8Array(bytes);
    if (String.fromCharCode(...signature.slice(0, 4)) !== "RIFF" || String.fromCharCode(...signature.slice(8, 12)) !== "WEBP") return privateJson({ ok: false, error: "Invalid WebP thumbnail" }, 415);
    const upload = await fetch(storageObjectUrl(env, "buschgirls-thumbnails", thumbnailPath), {
      method: "POST", headers: serviceHeaders(env, { "Content-Type": "image/webp", "x-upsert": "true" }), body: bytes
    });
    if (!upload.ok) throw new Error(await upload.text() || "Thumbnail upload failed");
    const update = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${id}`, {
      method: "PATCH",
      headers: serviceHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ sha256, thumbnail_path: thumbnailPath, indexed_at: new Date().toISOString() })
    });
    if (!update.ok) throw new Error(await update.text() || "Index update failed");
    const dupRes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?sha256=eq.${sha256}&select=id`, { headers: serviceHeaders(env) });
    const matches = await dupRes.json().catch(() => []);
    return privateJson({ ok: true, id, duplicateGroup: matches.length > 1, duplicateCount: matches.length });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, 500);
  }
}
