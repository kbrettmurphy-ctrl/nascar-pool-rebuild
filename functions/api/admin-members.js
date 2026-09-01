import { getVerifiedAdminRequest, json } from "./_admin-auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    ...extra
  };
}

async function serviceJson(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...options,
    headers: serviceHeaders(env, options.headers)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || "Member administration failed";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function memberRoster(env) {
  const [members, players] = await Promise.all([
    serviceJson(env, "/rest/v1/pool_members?select=id,player_id,email,active,is_admin,auth_user_id,players(name)"),
    serviceJson(env, "/rest/v1/players?select=id,name&active=eq.true&order=name.asc")
  ]);
  const normalized = (members || []).map(row => ({
    id: row.id,
    playerId: Number(row.player_id),
    playerName: String(Array.isArray(row.players) ? row.players[0]?.name : row.players?.name || "").trim(),
    email: String(row.email || "").trim().toLowerCase(),
    active: row.active === true,
    isAdmin: row.is_admin === true,
    hasAccount: Boolean(row.auth_user_id)
  })).sort((a, b) => a.playerName.localeCompare(b.playerName));
  return {
    members: normalized,
    players: (players || []).map(row => ({ id: Number(row.id), name: String(row.name || "").trim() }))
  };
}

async function createSetupLink(env, email, redirectTo) {
  const data = await serviceJson(
    env,
    `/auth/v1/admin/generate_link?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email })
    }
  );
  const setupLink = String(data?.action_link || "");
  if (!setupLink.startsWith("https://")) {
    const error = new Error("Supabase did not return a setup link");
    error.status = 502;
    throw error;
  }
  return setupLink;
}

async function findPendingAuthUser(env, email) {
  const data = await serviceJson(env, "/auth/v1/admin/users?page=1&per_page=1000");
  const user = (data?.users || []).find(candidate =>
    String(candidate?.email || "").trim().toLowerCase() === email
  );
  if (!user?.id) return null;
  return user.invited_at && !user.last_sign_in_at ? user : null;
}

export async function onRequestGet({ request, env }) {
  try {
    const admin = await getVerifiedAdminRequest(request, env);
    if (!admin) return json({ ok: false, error: "Unauthorized" }, 401);
    return json({ ok: true, currentMemberId: admin.memberId, ...(await memberRoster(env)) });
  } catch (error) {
    return json({ ok: false, error: error.message || "Could not load members" }, error.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const admin = await getVerifiedAdminRequest(request, env);
    if (!admin) return json({ ok: false, error: "Unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "set-admin") {
      const memberId = String(body?.memberId || "");
      const isAdmin = body?.isAdmin;
      if (!UUID_RE.test(memberId) || typeof isAdmin !== "boolean") {
        return json({ ok: false, error: "Invalid administrator update" }, 400);
      }
      if (memberId === admin.memberId && !isAdmin) {
        return json({ ok: false, error: "You cannot remove your own administrator access" }, 400);
      }
      const rows = await serviceJson(env, `/rest/v1/pool_members?id=eq.${encodeURIComponent(memberId)}&select=id,is_admin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ is_admin: isAdmin, updated_at: new Date().toISOString() })
      });
      if (!Array.isArray(rows) || !rows.length) return json({ ok: false, error: "Member not found" }, 404);
      return json({ ok: true, memberId, isAdmin });
    }

    if (action === "setup-link") {
      const memberId = String(body?.memberId || "");
      if (!UUID_RE.test(memberId)) return json({ ok: false, error: "Invalid member" }, 400);
      const rows = await serviceJson(
        env,
        `/rest/v1/pool_members?id=eq.${encodeURIComponent(memberId)}&active=eq.true&select=id,email&limit=1`
      );
      const member = rows?.[0];
      if (!member?.email) return json({ ok: false, error: "Member not found" }, 404);
      const redirectTo = `${new URL(request.url).origin}/?memberAuth=recovery`;
      const setupLink = await createSetupLink(env, String(member.email).toLowerCase(), redirectTo);
      return json({
        ok: true,
        setupLink,
        message: `Setup link created for ${String(member.email).toLowerCase()}`
      });
    }

    if (action === "cancel-invite") {
      const memberId = String(body?.memberId || "");
      if (!UUID_RE.test(memberId)) return json({ ok: false, error: "Invalid member" }, 400);
      if (memberId === admin.memberId) {
        return json({ ok: false, error: "You cannot remove your own member account" }, 400);
      }
      const rows = await serviceJson(
        env,
        `/rest/v1/pool_members?id=eq.${encodeURIComponent(memberId)}&select=id,email,auth_user_id&limit=1`
      );
      const member = rows?.[0];
      if (!member?.email) return json({ ok: false, error: "Invitation not found" }, 404);
      if (member.auth_user_id) {
        return json({ ok: false, error: "Active member accounts cannot be removed as invitations" }, 409);
      }

      const email = String(member.email).trim().toLowerCase();
      const pendingUser = await findPendingAuthUser(env, email);
      if (pendingUser) {
        await serviceJson(env, `/auth/v1/admin/users/${encodeURIComponent(pendingUser.id)}`, {
          method: "DELETE"
        });
      }
      await serviceJson(env, `/rest/v1/pool_members?id=eq.${encodeURIComponent(memberId)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
      return json({ ok: true, message: `Invitation canceled for ${email}` });
    }

    if (action === "resend-invite") {
      const memberId = String(body?.memberId || "");
      if (!UUID_RE.test(memberId)) return json({ ok: false, error: "Invalid member" }, 400);
      const rows = await serviceJson(
        env,
        `/rest/v1/pool_members?id=eq.${encodeURIComponent(memberId)}&active=eq.true&select=id,email,auth_user_id&limit=1`
      );
      const member = rows?.[0];
      if (!member?.email) return json({ ok: false, error: "Invitation not found" }, 404);
      if (member.auth_user_id) {
        return json({ ok: false, error: "That member has already completed account setup" }, 409);
      }
      const email = String(member.email).trim().toLowerCase();
      const redirectTo = `${new URL(request.url).origin}/`;
      await serviceJson(env, `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      return json({ ok: true, message: `Invitation resent to ${email}` });
    }

    if (action === "invite") {
      const playerId = Number(body?.playerId);
      const email = String(body?.email || "").trim().toLowerCase();
      if (!Number.isInteger(playerId) || playerId < 1 || !EMAIL_RE.test(email) || email.length > 254) {
        return json({ ok: false, error: "Choose a player and enter a valid email" }, 400);
      }

      const existing = await serviceJson(
        env,
        `/rest/v1/pool_members?select=id,player_id,email,auth_user_id&or=(player_id.eq.${playerId},email.eq.${encodeURIComponent(email)})`
      );
      const emailMatch = (existing || []).find(row => String(row.email || "").toLowerCase() === email);
      const playerMatch = (existing || []).find(row => Number(row.player_id) === playerId);
      if (emailMatch && Number(emailMatch.player_id) !== playerId) {
        return json({ ok: false, error: "That email is already linked to another player" }, 409);
      }
      if (playerMatch && String(playerMatch.email || "").toLowerCase() !== email && playerMatch.auth_user_id) {
        return json({ ok: false, error: "That player already has a member account" }, 409);
      }

      const playerRow = playerMatch || emailMatch;
      if (playerRow?.auth_user_id) return json({ ok: false, error: "That member already has an account" }, 409);
      if (playerRow?.id) {
        await serviceJson(env, `/rest/v1/pool_members?id=eq.${encodeURIComponent(playerRow.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ player_id: playerId, email, active: true, updated_at: new Date().toISOString() })
        });
      } else {
        await serviceJson(env, "/rest/v1/pool_members", {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ player_id: playerId, email, active: true })
        });
      }

      const redirectTo = `${new URL(request.url).origin}/`;
      try {
        await serviceJson(env, `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
      } catch (error) {
        if (error.status !== 429 && !/email rate limit/i.test(error.message || "")) throw error;
        const setupLink = await createSetupLink(env, email, `${redirectTo}?memberAuth=recovery`);
        return json({
          ok: true,
          invitationSent: false,
          setupLink,
          message: `Supabase's email limit was reached. ${email} is saved—copy and send the setup link below.`
        });
      }
      return json({ ok: true, message: `Invitation sent to ${email}` });
    }

    return json({ ok: false, error: "Unknown member action" }, 400);
  } catch (error) {
    return json({ ok: false, error: error.message || "Member administration failed" }, error.status || 500);
  }
}
