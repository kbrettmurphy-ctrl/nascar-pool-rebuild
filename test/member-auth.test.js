import assert from "node:assert/strict";
import test from "node:test";

import { requirePoolMember } from "../functions/api/_member-auth.js";
import { onRequestGet as getBuschGirls } from "../functions/api/buschgirls.js";
import { onRequestPost as postBuschVote } from "../functions/api/buschgirl-vote.js";
import { onRequestGet as getMemberAuthConfig } from "../functions/api/member-auth-config.js";

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
  active: true
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function request(path = "/api/member-session", options = {}) {
  return new Request(`https://pool.example${path}`, {
    ...options,
    headers: { Authorization: "Bearer valid-access-token", ...(options.headers || {}) }
  });
}

function membershipFetch(extraHandler) {
  return async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return json(authUser);
    if (url.includes("/rest/v1/pool_members?") && url.includes("auth_user_id=eq.")) return json([memberRow]);
    if (url.includes("/rest/v1/players?")) return json([{ name: "Brett" }]);
    if (extraHandler) return extraHandler(url, options);
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("member authentication rejects a request with no bearer token", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("fetch should not be called"); };
  await assert.rejects(
    requirePoolMember(new Request("https://pool.example/api/member-session"), env),
    error => error.status === 401 && error.message === "Sign in required"
  );
});

test("guest photo request returns no metadata and performs no upstream request", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error("fetch should not be called"); };
  const response = await getBuschGirls({
    request: new Request("https://pool.example/api/buschgirls"),
    env
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.deepEqual(Object.keys(body).sort(), ["error", "ok"]);
});

test("browser auth configuration never returns the server secret", async () => {
  const response = await getMemberAuthConfig({ env });
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(response.status, 200);
  assert.equal(body.publishableKey, env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(text.includes(env.SUPABASE_SECRET_KEY), false);
});

test("member authentication returns the server-linked player identity", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = membershipFetch();
  const member = await requirePoolMember(request(), env);
  assert.equal(member.playerName, "Brett");
  assert.equal(member.email, "member@example.com");
  assert.equal(member.playerId, memberRow.player_id);
});

test("private photo endpoint returns one bulk-signed member batch", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let signingCalls = 0;
  globalThis.fetch = membershipFetch(async (url, options) => {
    if (url.includes("/rest/v1/buschgirls_photos?")) {
      return json([
        { id: "44444444-4444-4444-8444-444444444444", folder: "soft", filename: "a.jpg", storage_path: "soft/a.jpg" },
        { id: "55555555-5555-4555-8555-555555555555", folder: "spicy", filename: "b.jpg", storage_path: "spicy/b.jpg" }
      ]);
    }
    if (url.includes("/storage/v1/object/sign/buschgirls")) {
      signingCalls++;
      const body = JSON.parse(options.body);
      return json(body.paths.map(path => ({ path, signedURL: `/object/sign/buschgirls/${path}?token=test` })));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const response = await getBuschGirls({ request: request("/api/buschgirls?warmup=1"), env });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.photos.length, 2);
  assert.equal(signingCalls, 1);
  assert.match(body.photos[0].url, /\/storage\/v1\/object\/sign\/buschgirls\//);
});

test("vote identity ignores a forged browser playerName", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let voteBody = null;
  globalThis.fetch = membershipFetch(async (url, options) => {
    if (url.includes("/rest/v1/buschgirl_votes?")) {
      voteBody = JSON.parse(options.body);
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const response = await postBuschVote({
    request: request("/api/buschgirl-vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photoId: "44444444-4444-4444-8444-444444444444",
        playerName: "Someone Else",
        vote: 1
      })
    }),
    env
  });
  assert.equal(response.status, 200);
  assert.equal(voteBody[0].player_name, "Brett");
});
