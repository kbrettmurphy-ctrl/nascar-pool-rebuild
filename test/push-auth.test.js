import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost as savePushSubscription } from "../functions/api/save-push-subscription.js";
import { onRequestGet as getPushPrefs, onRequestPost as updatePushPrefs } from "../functions/api/push-prefs.js";

const env = {
  SUPABASE_URL: "https://project.example",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test"
};

const authUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "member@example.com",
  email_confirmed_at: "2026-08-31T20:00:00.000Z"
};

const memberRow = {
  id: "22222222-2222-4222-8222-222222222222",
  auth_user_id: authUser.id,
  email: authUser.email,
  player_id: "33333333-3333-4333-8333-333333333333",
  active: true,
  is_admin: false
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function memberRequest(path, options = {}) {
  return new Request(`https://pool.example${path}`, {
    ...options,
    headers: {
      Authorization: "Bearer valid-access-token",
      ...(options.headers || {})
    }
  });
}

function membershipResponse(url) {
  if (url.endsWith("/auth/v1/user")) return json(authUser);
  if (url.includes("/rest/v1/pool_members?") && url.includes("auth_user_id=eq.")) return json([memberRow]);
  if (url.includes("/rest/v1/players?")) return json([{ name: "Brett" }]);
  return null;
}

test("guest cannot register a push subscription", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("fetch should not be called"); };

  const response = await savePushSubscription({
    request: new Request("https://pool.example/api/save-push-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: { endpoint: "https://push.example/device" } })
    }),
    env
  });

  assert.equal(response.status, 401);
});

test("push registration derives player identity from the member session", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let savedRow = null;

  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    const membership = membershipResponse(url);
    if (membership) return membership;
    if (url.includes("/rest/v1/push_subscriptions?on_conflict=endpoint")) {
      savedRow = JSON.parse(options.body);
      return json([savedRow], 201);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await savePushSubscription({
    request: memberRequest("/api/save-push-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerName: "Someone Else",
        subscription: { endpoint: "https://push.example/device" }
      })
    }),
    env
  });

  assert.equal(response.status, 200);
  assert.equal(savedRow.player_name, "Brett");
});

test("members can only read their own device preference", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let preferenceUrl = "";

  globalThis.fetch = async input => {
    const url = String(input);
    const membership = membershipResponse(url);
    if (membership) return membership;
    if (url.includes("/rest/v1/push_subscriptions?endpoint=")) {
      preferenceUrl = url;
      return json([{ paused: false, player_name: "Brett" }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await getPushPrefs({
    request: memberRequest("/api/push-prefs?endpoint=https%3A%2F%2Fpush.example%2Fdevice"),
    env
  });

  assert.equal(response.status, 200);
  assert.match(preferenceUrl, /player_name=eq\.Brett/);
});

test("members can only update a device registered to their identity", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let preferenceUrl = "";

  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    const membership = membershipResponse(url);
    if (membership) return membership;
    if (url.includes("/rest/v1/push_subscriptions?endpoint=") && options.method === "PATCH") {
      preferenceUrl = url;
      return json([{ paused: true }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await updatePushPrefs({
    request: memberRequest("/api/push-prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example/device", paused: true })
    }),
    env
  });

  assert.equal(response.status, 200);
  assert.match(preferenceUrl, /player_name=eq\.Brett/);
});
