import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const form = await request.formData();
    const folder = String(form.get("folder") || "").trim().toLowerCase();
    const file = form.get("file");

    const allowedFolders = new Set(["soft", "old", "spicy", "spicier"]);

    if (!allowedFolders.has(folder)) {
      return json({ ok: false, error: "Invalid folder" }, 400);
    }

    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ ok: false, error: "File is required" }, 400);
    }

    const originalName = String(file.name || "upload.jpg").replace(/[^\w.\-]+/g, "_");
    const filename = originalName;
    const path = `${folder}/${filename}`;

    const bytes = await file.arrayBuffer();
    const contentType = file.type || "application/octet-stream";

    const uploadRes = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/buschgirls/${path}`,
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          "Content-Type": contentType,
          "x-upsert": "false"
        },
        body: bytes
      }
    );

    const uploadText = await uploadRes.text();

    if (!uploadRes.ok) {
      return json({ ok: false, error: uploadText || "Storage upload failed" }, 500);
    }

    const publicUrl =
      `${env.SUPABASE_URL}/storage/v1/object/public/buschgirls/${path}`;

    const insertRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
          Prefer: "return=representation"
        },
        body: JSON.stringify([{
          folder,
          filename,
          url: publicUrl,
          active: true,
          sort_order: null
        }])
      }
    );

    const insertText = await insertRes.text();

    if (!insertRes.ok) {
      return json({ ok: false, error: insertText || "Database insert failed" }, 500);
    }

    return json({
      ok: true,
      folder,
      filename,
      url: publicUrl
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
