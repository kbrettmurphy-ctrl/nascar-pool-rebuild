const MEMBER_SELECT = "id,auth_user_id,email,player_id,active,is_admin";

export class MemberAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "MemberAuthError";
    this.status = status;
  }
}

export function memberJson(data, status = 200) {
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

export function getPublishableKey(env) {
  return String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "").trim();
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    ...extra
  };
}

async function serviceRows(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...options,
    headers: serviceHeaders(env, options.headers)
  });
  const text = await response.text();
  let data = [];
  try { data = text ? JSON.parse(text) : []; } catch { data = []; }
  if (!response.ok) {
    throw new MemberAuthError("Member access lookup failed", 503);
  }
  return Array.isArray(data) ? data : [];
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function getVerifiedAuthUser(request, env) {
  const token = bearerToken(request);
  const publishableKey = getPublishableKey(env);
  if (!token) throw new MemberAuthError("Sign in required", 401);
  if (!publishableKey) throw new MemberAuthError("Member authentication is not configured", 503);

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) throw new MemberAuthError("Session expired", 401);

  const user = await response.json().catch(() => null);
  if (!user?.id || !user?.email || !user?.email_confirmed_at) {
    throw new MemberAuthError("A confirmed member email is required", 401);
  }
  return user;
}

async function bindAllowlistedEmail(env, user) {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return null;

  const rows = await serviceRows(
    env,
    `/rest/v1/pool_members?select=${MEMBER_SELECT}&email=eq.${encodeURIComponent(email)}&auth_user_id=is.null&active=eq.true&limit=1`
  );
  const candidate = rows[0];
  if (!candidate?.id) return null;

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pool_members?id=eq.${encodeURIComponent(candidate.id)}&auth_user_id=is.null&select=${MEMBER_SELECT}`,
    {
      method: "PATCH",
      headers: serviceHeaders(env, {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify({ auth_user_id: user.id })
    }
  );
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new MemberAuthError("Member account link failed", 503);
  return Array.isArray(data) ? data[0] || null : null;
}

async function getMemberRow(env, user) {
  const linked = await serviceRows(
    env,
    `/rest/v1/pool_members?select=${MEMBER_SELECT}&auth_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`
  );
  return linked[0] || await bindAllowlistedEmail(env, user);
}

async function getPlayerName(env, playerId) {
  const rows = await serviceRows(
    env,
    `/rest/v1/players?select=name&id=eq.${encodeURIComponent(playerId)}&limit=1`
  );
  return String(rows[0]?.name || "").trim();
}

export async function requirePoolMember(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new MemberAuthError("Member authentication is not configured", 503);
  }

  const user = await getVerifiedAuthUser(request, env);
  const row = await getMemberRow(env, user);
  if (!row?.active || !row?.player_id) {
    throw new MemberAuthError("This account is not an active pool member", 403);
  }

  const playerName = await getPlayerName(env, row.player_id);
  if (!playerName) throw new MemberAuthError("Member player record is unavailable", 503);

  return {
    id: row.id,
    userId: user.id,
    email: String(user.email || row.email || "").trim().toLowerCase(),
    playerId: row.player_id,
    playerName,
    isAdmin: row.is_admin === true
  };
}

export async function requirePoolAdmin(request, env) {
  const member = await requirePoolMember(request, env);
  if (!member.isAdmin) throw new MemberAuthError("Admin access required", 403);
  return member;
}

export function memberAuthResponse(error) {
  if (error instanceof MemberAuthError) {
    return memberJson({ ok: false, error: error.message }, error.status);
  }
  return memberJson({ ok: false, error: "Member authentication failed" }, 500);
}
