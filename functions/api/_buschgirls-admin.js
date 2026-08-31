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

export async function signStoragePaths(env, bucket, paths, expiresIn = 900) {
  const cleanPaths = Array.from(new Set((paths || []).map(path => String(path || "").trim()).filter(Boolean)));
  if (!cleanPaths.length) return new Map();
  const signed = new Map();
  for (let offset = 0; offset < cleanPaths.length; offset += 100) {
    const batch = cleanPaths.slice(offset, offset + 100);
    const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: serviceHeaders(env, { "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn, paths: batch })
    });
    const data = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(data)) throw new Error("Private photo signing failed");
    data.forEach((item, index) => {
      const path = String(item?.path || batch[index] || "");
      const relative = String(item?.signedURL || item?.signedUrl || "");
      if (!path || !relative) return;
      signed.set(path, relative.startsWith("http") ? relative : `${env.SUPABASE_URL}/storage/v1${relative}`);
    });
  }
  return signed;
}

export function storageObjectUrl(env, bucket, path) {
  return `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
