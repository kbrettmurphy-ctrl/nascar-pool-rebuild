import { verifyAdminRequest } from "./_admin-auth";
import { privateJson, serviceHeaders, UUID_RE } from "./_buschgirls-admin";

function totalFrom(response) {
  return Number((response.headers.get("content-range") || "").split("/")[1] || 0);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 40) return privateJson({ ok: false, error: "Invalid limit" }, 400);
    const exclude = String(url.searchParams.get("exclude") || "").split(",").filter(Boolean);
    if (exclude.length > 50 || exclude.some(id => !UUID_RE.test(id))) return privateJson({ ok: false, error: "Invalid exclude list" }, 400);
    const exclusion = exclude.length ? `&id=not.in.(${exclude.join(",")})` : "";
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id,folder,filename,url,uploaded_at&or=(sha256.is.null,thumbnail_path.is.null)${exclusion}&order=uploaded_at.asc,id.asc`, {
      headers: serviceHeaders(env, { Prefer: "count=exact", Range: `0-${limit - 1}` })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || "Backfill query failed");
    return privateJson({ ok: true, photos: JSON.parse(text || "[]"), remaining: totalFrom(response) });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, 500);
  }
}
