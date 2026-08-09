import { verifyAdminRequest } from "./_admin-auth";
import { privateJson, serviceHeaders, storageObjectUrl, UUID_RE } from "./_buschgirls-admin";

class UpstreamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function requireUpstream(response, fallback) {
  const text = await response.text();
  if (!response.ok) throw new UpstreamError(response.status, text || fallback);
  return text;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const form = await request.formData();
    const id = String(form.get("photoId") || "").trim();
    const sha256 = String(form.get("sha256") || "").trim().toLowerCase();
    const thumbnail = form.get("thumbnail");
    if (!UUID_RE.test(id) || !/^[0-9a-f]{64}$/.test(sha256)) return privateJson({ ok: false, error: "Invalid indexing data" }, 400);
    // Accept WebP or JPEG: Safari's canvas can't encode WebP and sends JPEG.
    const thumbType = String(thumbnail?.type || "");
    if (!thumbnail || typeof thumbnail.arrayBuffer !== "function" || (thumbType !== "image/webp" && thumbType !== "image/jpeg")) return privateJson({ ok: false, error: "WebP or JPEG thumbnail is required" }, 400);
    const rowRes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${id}&select=id,folder,filename&limit=1`, { headers: serviceHeaders(env) });
    const rowText = await requireUpstream(rowRes, "Photo lookup failed");
    const rows = JSON.parse(rowText || "[]");
    if (!rows[0]) return privateJson({ ok: false, error: "Photo not found" }, 404);
    const bytes = await thumbnail.arrayBuffer();
    if (bytes.byteLength > 2_000_000) return privateJson({ ok: false, error: "Thumbnail is too large" }, 413);
    const signature = new Uint8Array(bytes);
    const isWebpThumb = String.fromCharCode(...signature.slice(0, 4)) === "RIFF" && String.fromCharCode(...signature.slice(8, 12)) === "WEBP";
    const isJpegThumb = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
    if (!isWebpThumb && !isJpegThumb) return privateJson({ ok: false, error: "Invalid thumbnail image" }, 415);
    const thumbnailPath = `${rows[0].folder}/${id}.${isWebpThumb ? "webp" : "jpg"}`;
    const upload = await fetch(storageObjectUrl(env, "buschgirls-thumbnails", thumbnailPath), {
      method: "POST", headers: serviceHeaders(env, { "Content-Type": thumbType, "x-upsert": "true" }), body: bytes
    });
    await requireUpstream(upload, "Thumbnail upload failed");
    const update = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?id=eq.${id}`, {
      method: "PATCH",
      headers: serviceHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ sha256, thumbnail_path: thumbnailPath, indexed_at: new Date().toISOString() })
    });
    await requireUpstream(update, "Index update failed");
    return privateJson({ ok: true, id });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, error.status || 500);
  }
}
