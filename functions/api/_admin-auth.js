const encoder = new TextEncoder();

function b64urlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToString(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function signPayload(payloadStr, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadStr));
  return b64urlEncode(new Uint8Array(sig));
}

function adminPayload(member, kind) {
  if (!member?.isAdmin || !member?.id || !member?.userId) {
    throw new Error("Verified admin member is required");
  }
  return {
    exp: Date.now() + (1000 * 60 * 45),
    role: "admin",
    kind,
    memberId: member.id,
    userId: member.userId
  };
}

export async function createAdminToken(env, member) {
  const exp = Date.now() + (1000 * 60 * 45); // 45 min
  const payload = JSON.stringify({ ...adminPayload(member, "bearer"), exp });
  const payloadB64 = b64urlEncode(encoder.encode(payload));
  const sig = await signPayload(payloadB64, env.ADMIN_SESSION_SECRET);
  return `${payloadB64}.${sig}`;
}

export const ADMIN_COOKIE_NAME = "nascar_pool_admin_session";

export async function createAdminCookie(env, member) {
  if (!env.ADMIN_SESSION_SECRET) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const payload = JSON.stringify(adminPayload(member, "cookie"));
  const payloadB64 = b64urlEncode(encoder.encode(payload));
  const sig = await signPayload(payloadB64, env.ADMIN_SESSION_SECRET);
  return `${ADMIN_COOKIE_NAME}=${payloadB64}.${sig}; Max-Age=2700; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function activeAdminMember(payload, env) {
  if (!payload?.memberId || !payload?.userId || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return false;
  const params = new URLSearchParams({
    select: "id",
    id: `eq.${payload.memberId}`,
    auth_user_id: `eq.${payload.userId}`,
    active: "eq.true",
    is_admin: "eq.true",
    limit: "1"
  });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/pool_members?${params}`, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
    }
  });
  if (!response.ok) return false;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) && rows.length === 1;
}

async function verifiedPayload(token, env, expectedKind) {
  if (!env.ADMIN_SESSION_SECRET) return null;
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = await signPayload(payloadB64, env.ADMIN_SESSION_SECRET);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(b64urlDecodeToString(payloadB64));
    if (payload?.role !== "admin" || payload?.kind !== expectedKind) return null;
    if (!Number.isFinite(Number(payload.exp)) || Date.now() > Number(payload.exp)) return null;
    return await activeAdminMember(payload, env) ? payload : null;
  } catch {
    return null;
  }
}

export async function verifyAdminCookie(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const cookies = request.headers.get("cookie") || "";
  const value = cookies.split(";").map(v => v.trim()).find(v => v.startsWith(`${ADMIN_COOKIE_NAME}=`));
  if (!value) return false;
  return Boolean(await verifiedPayload(value.slice(ADMIN_COOKIE_NAME.length + 1), env, "cookie"));
}

export async function getVerifiedAdminRequest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifiedPayload(m[1].trim(), env, "bearer");
}

export async function verifyAdminRequest(request, env) {
  return Boolean(await getVerifiedAdminRequest(request, env));
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
