import { verifyAdminRequest } from "./_admin-auth";
import { BUSCH_FOLDERS, privateJson, serviceHeaders, storageObjectUrl } from "./_buschgirls-admin";

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
    if (!thumbnail || typeof thumbnail.arrayBuffer !== "function" || thumbnail.type !== "image/webp") {
      return privateJson({ ok: false, error: "WebP thumbnail is required" }, 400);
    }

    const bytes = await file.arrayBuffer();
    const thumbBytes = await thumbnail.arrayBuffer();
    if (!isRecognizedImage(bytes, String(file.type || ""))) return privateJson({ ok: false, error: "Unsupported image file" }, 415);
    const tb = new Uint8Array(thumbBytes);
    if (String.fromCharCode(...tb.slice(0, 4)) !== "RIFF" || String.fromCharCode(...tb.slice(8, 12)) !== "WEBP") return privateJson({ ok: false, error: "Invalid WebP thumbnail" }, 415);
    if (thumbBytes.byteLength > 2_000_000) return privateJson({ ok: false, error: "Thumbnail is too large" }, 413);
    const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(hashBytes, b => b.toString(16).padStart(2, "0")).join("");
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
    const thumbnailPath = `${folder}/${id}.webp`;
    const originalUpload = await fetch(storageObjectUrl(env, "buschgirls", originalPath), {
      method: "POST",
      headers: serviceHeaders(env, { "Content-Type": file.type, "x-upsert": "false" }),
      body: bytes
    });
    if (!originalUpload.ok) return privateJson({ ok: false, error: await originalUpload.text() || "Original upload failed" }, 409);

    const thumbUpload = await fetch(storageObjectUrl(env, "buschgirls-thumbnails", thumbnailPath), {
      method: "POST",
      headers: serviceHeaders(env, { "Content-Type": "image/webp", "x-upsert": "false" }),
      body: thumbBytes
    });
    if (!thumbUpload.ok) {
      await removeObject(env, "buschgirls", originalPath);
      return privateJson({ ok: false, error: await thumbUpload.text() || "Thumbnail upload failed" }, 500);
    }

    const maxSortRes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?folder=eq.${folder}&select=sort_order&order=sort_order.desc.nullslast&limit=1`, { headers: serviceHeaders(env) });
    const maxRows = await maxSortRes.json().catch(() => []);
    const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/buschgirls/${originalPath.split("/").map(encodeURIComponent).join("/")}`;
    const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos`, {
      method: "POST",
      headers: serviceHeaders(env, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify([{ id, folder, filename, url: publicUrl, active: true, sort_order: Number(maxRows?.[0]?.sort_order || 0) + 1, sha256, thumbnail_path: thumbnailPath, indexed_at: new Date().toISOString() }])
    });
    const insertText = await insertRes.text();
    if (!insertRes.ok) {
      await Promise.all([removeObject(env, "buschgirls", originalPath), removeObject(env, "buschgirls-thumbnails", thumbnailPath)]);
      return privateJson({ ok: false, error: insertText || "Database insert failed" }, 500);
    }
    return privateJson({ ok: true, id, folder, filename, url: publicUrl, sha256, thumbnailReady: true });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, 500);
  }
}
