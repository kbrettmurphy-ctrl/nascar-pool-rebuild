import { verifyAdminRequest } from "./_admin-auth.js";
import { BUSCH_FOLDERS, privateJson, serviceHeaders, storageObjectUrl } from "./_buschgirls-admin.js";

// Same policy as the Oct 2026 in-place shrink. Photos are served through
// short-lived signed URLs, so this only helps repeat loads of the same URL.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

function isRecognizedImage(bytes, type) {
  const b = new Uint8Array(bytes);
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const gif = String.fromCharCode(...b.slice(0, 6)).startsWith("GIF8");
  const webp = String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  const brand = String.fromCharCode(...b.slice(8, 12));
  const heif = String.fromCharCode(...b.slice(4, 8)) === "ftyp" && new Set(["heic", "heix", "hevc", "mif1", "avif"]).has(brand);
  return type.startsWith("image/") && (jpeg || png || gif || webp || heif);
}

async function removeObject(env, bucket, path) {
  try {
    await fetch(storageObjectUrl(env, bucket, path), { method: "DELETE", headers: serviceHeaders(env) });
  } catch {}
}

export async function onRequestPost({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const form = await request.formData();
    const folder = String(form.get("folder") || "").trim().toLowerCase();
    const file = form.get("file");
    const thumbnail = form.get("thumbnail");
    if (!BUSCH_FOLDERS.has(folder)) return privateJson({ ok: false, error: "Invalid folder" }, 400);
    if (!file || typeof file.arrayBuffer !== "function") return privateJson({ ok: false, error: "File is required" }, 400);
    // The thumbnail is optional: when the browser can't decode a photo it uploads
    // the original untouched, and the gallery backfill makes the thumbnail later.
    // Accept WebP or JPEG: Safari's canvas can't encode WebP, so mobile/desktop
    // Safari clients send a JPEG thumbnail instead.
    const hasThumbnail = Boolean(thumbnail && typeof thumbnail.arrayBuffer === "function");
    const thumbType = String(thumbnail?.type || "");
    if (hasThumbnail && thumbType !== "image/webp" && thumbType !== "image/jpeg") {
      return privateJson({ ok: false, error: "Thumbnail must be WebP or JPEG" }, 400);
    }

    const bytes = await file.arrayBuffer();
    if (!isRecognizedImage(bytes, String(file.type || ""))) return privateJson({ ok: false, error: "Unsupported image file" }, 415);
    let thumbBytes = null;
    let isWebpThumb = false;
    if (hasThumbnail) {
      thumbBytes = await thumbnail.arrayBuffer();
      const tb = new Uint8Array(thumbBytes);
      isWebpThumb = String.fromCharCode(...tb.slice(0, 4)) === "RIFF" && String.fromCharCode(...tb.slice(8, 12)) === "WEBP";
      const isJpegThumb = tb[0] === 0xff && tb[1] === 0xd8 && tb[2] === 0xff;
      if (!isWebpThumb && !isJpegThumb) return privateJson({ ok: false, error: "Invalid thumbnail image" }, 415);
      if (thumbBytes.byteLength > 2_000_000) return privateJson({ ok: false, error: "Thumbnail is too large" }, 413);
    }
    // The browser shrinks photos before upload, so it sends the SHA-256 of the
    // file as picked. That keeps duplicate detection comparable with the hashes
    // stored for older photos, which were taken over their pre-shrink bytes.
    const sourceSha256 = String(form.get("sourceSha256") || "").trim().toLowerCase();
    let sha256 = sourceSha256;
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      sha256 = Array.from(hashBytes, b => b.toString(16).padStart(2, "0")).join("");
    }
    const duplicateRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?sha256=eq.${sha256}&select=id,folder,filename,uploaded_at&limit=1`,
      { headers: serviceHeaders(env) }
    );
    const duplicateText = await duplicateRes.text();
    if (!duplicateRes.ok) throw new Error(duplicateText || "Duplicate check failed");
    const duplicate = JSON.parse(duplicateText || "[]")[0];
    if (duplicate) return privateJson({ ok: false, error: "Exact duplicate", duplicate }, 409);

    const id = crypto.randomUUID();
    const filename = String(file.name || "upload.jpg").replace(/[^\w.\-]+/g, "_");
    const originalPath = `${folder}/${filename}`;
    const thumbnailPath = hasThumbnail ? `${folder}/${id}.${isWebpThumb ? "webp" : "jpg"}` : null;
    // Upload both in parallel. On failure, remove only what this request created:
    // a 409 on the original means a different photo already owns that path.
    const [originalUpload, thumbUpload] = await Promise.all([
      fetch(storageObjectUrl(env, "buschgirls", originalPath), {
        method: "POST",
        headers: serviceHeaders(env, { "Content-Type": file.type, "Cache-Control": CACHE_CONTROL, "x-upsert": "false" }),
        body: bytes
      }),
      hasThumbnail
        ? fetch(storageObjectUrl(env, "buschgirls-thumbnails", thumbnailPath), {
          method: "POST",
          headers: serviceHeaders(env, { "Content-Type": thumbType, "Cache-Control": CACHE_CONTROL, "x-upsert": "false" }),
          body: thumbBytes
        })
        : null
    ]);
    if (!originalUpload.ok) {
      if (thumbUpload?.ok) await removeObject(env, "buschgirls-thumbnails", thumbnailPath);
      return privateJson({ ok: false, error: await originalUpload.text() || "Original upload failed" }, 409);
    }
    if (thumbUpload && !thumbUpload.ok) {
      await removeObject(env, "buschgirls", originalPath);
      return privateJson({ ok: false, error: await thumbUpload.text() || "Thumbnail upload failed" }, 500);
    }

    const maxSortRes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?folder=eq.${folder}&select=sort_order&order=sort_order.desc.nullslast&limit=1`, { headers: serviceHeaders(env) });
    const maxRows = await maxSortRes.json().catch(() => []);
    const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/buschgirls/${originalPath.split("/").map(encodeURIComponent).join("/")}`;
    const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos`, {
      method: "POST",
      headers: serviceHeaders(env, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify([{ id, folder, filename, storage_path: originalPath, url: publicUrl, active: true, sort_order: Number(maxRows?.[0]?.sort_order || 0) + 1, sha256, thumbnail_path: thumbnailPath, indexed_at: hasThumbnail ? new Date().toISOString() : null }])
    });
    const insertText = await insertRes.text();
    if (!insertRes.ok) {
      await Promise.all([removeObject(env, "buschgirls", originalPath), thumbnailPath && removeObject(env, "buschgirls-thumbnails", thumbnailPath)]);
      return privateJson({ ok: false, error: insertText || "Database insert failed" }, 500);
    }
    return privateJson({ ok: true, id, folder, filename, sha256, thumbnailReady: hasThumbnail });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, 500);
  }
}
