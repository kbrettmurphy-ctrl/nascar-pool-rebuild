import assert from "node:assert/strict";
import test from "node:test";

import { createAdminToken } from "../functions/api/_admin-auth.js";
import { onRequestPost as postAdminMembers } from "../functions/api/admin-members.js";

const env = {
  SUPABASE_URL: "https://project.example",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  ADMIN_SESSION_SECRET: "admin-session-secret-for-tests"
};
const admin = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: "11111111-1111-4111-8111-111111111111",
  isAdmin: true
};
const pendingMemberId = "33333333-3333-4333-8333-333333333333";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function adminRequest(body) {
  const token = await createAdminToken(env, admin);
  return new Request("https://pool.example/api/admin-members", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

test("pending member can receive a non-email setup link", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/rest/v1/pool_members?") && url.includes("is_admin=eq.true")) return json([{ id: admin.id }]);
    if (url.includes(`/rest/v1/pool_members?id=eq.${pendingMemberId}`)) {
      return json([{ id: pendingMemberId, email: "member@example.com" }]);
    }
    if (url.includes("/auth/v1/admin/generate_link")) {
      assert.equal(JSON.parse(options.body).type, "magiclink");
      return json({ action_link: "https://project.example/auth/v1/verify?token=test" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await postAdminMembers({
    request: await adminRequest({ action: "setup-link", memberId: pendingMemberId }),
    env
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.setupLink, /^https:\/\//);
});

test("email rate limit falls back to a setup link without losing the member", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let memberCreated = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/rest/v1/pool_members?") && url.includes("is_admin=eq.true")) return json([{ id: admin.id }]);
    if (url.includes("/rest/v1/pool_members?select=id,player_id")) return json([]);
    if (url.endsWith("/rest/v1/pool_members") && options.method === "POST") {
      memberCreated = true;
      return new Response(null, { status: 201 });
    }
    if (url.includes("/auth/v1/invite")) return json({ msg: "email rate limit exceeded" }, 429);
    if (url.includes("/auth/v1/admin/generate_link")) {
      return json({ action_link: "https://project.example/auth/v1/verify?token=fallback" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await postAdminMembers({
    request: await adminRequest({ action: "invite", playerId: 10, email: "new@example.com" }),
    env
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(memberCreated, true);
  assert.equal(body.invitationSent, false);
  assert.match(body.setupLink, /fallback/);
});

test("pending invitation can be canceled and its Auth user is deleted", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const pendingUserId = "44444444-4444-4444-8444-444444444444";
  let authUserDeleted = false;
  let memberDeleted = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/rest/v1/pool_members?") && url.includes("is_admin=eq.true")) return json([{ id: admin.id }]);
    if (url.includes(`/rest/v1/pool_members?id=eq.${pendingMemberId}`) && options.method !== "DELETE") {
      return json([{ id: pendingMemberId, email: "wrong@example.com", auth_user_id: null }]);
    }
    if (url.includes("/auth/v1/admin/users?page=1")) {
      return json({ users: [{ id: pendingUserId, email: "wrong@example.com", invited_at: "2026-08-31T00:00:00Z", last_sign_in_at: null }] });
    }
    if (url.endsWith(`/auth/v1/admin/users/${pendingUserId}`) && options.method === "DELETE") {
      authUserDeleted = true;
      return json({});
    }
    if (url.includes(`/rest/v1/pool_members?id=eq.${pendingMemberId}`) && options.method === "DELETE") {
      assert.equal(authUserDeleted, true, "Auth invitation should be invalidated before the roster row is removed");
      memberDeleted = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await postAdminMembers({
    request: await adminRequest({ action: "cancel-invite", memberId: pendingMemberId }),
    env
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(authUserDeleted, true);
  assert.equal(memberDeleted, true);
});

test("established member account cannot be canceled as an invitation", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/rest/v1/pool_members?") && url.includes("is_admin=eq.true")) return json([{ id: admin.id }]);
    if (url.includes(`/rest/v1/pool_members?id=eq.${pendingMemberId}`) && options.method !== "DELETE") {
      return json([{ id: pendingMemberId, email: "member@example.com", auth_user_id: "55555555-5555-4555-8555-555555555555" }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await postAdminMembers({
    request: await adminRequest({ action: "cancel-invite", memberId: pendingMemberId }),
    env
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.error, /Active member accounts/);
});
