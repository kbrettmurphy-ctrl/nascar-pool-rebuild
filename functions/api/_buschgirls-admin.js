export const BUSCH_FOLDERS = new Set(["soft", "old", "spicy", "spicier"]);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    ...extra
  };
}

export function privateJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

export async function supabaseRows(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...options,
    headers: serviceHeaders(env, options.headers)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : []; } catch { data = text; }
  if (!response.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return { data, response };
}

export async function signThumbnail(env, path, expiresIn = 300) {
  const response = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/sign/buschgirls-thumbnails/${path.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "POST",
      headers: serviceHeaders(env, { "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn })
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.signedURL) return null;
  return data.signedURL.startsWith("http") ? data.signedURL : `${env.SUPABASE_URL}/storage/v1${data.signedURL}`;
}

export function storageObjectUrl(env, bucket, path) {
  return `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
