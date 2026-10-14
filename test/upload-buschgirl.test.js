import assert from "node:assert/strict";
import test from "node:test";

import { createAdminToken } from "../functions/api/_admin-auth.js";
import { onRequestPost as postUpload } from "../functions/api/upload-buschgirl.js";

const env = {
  SUPABASE_URL: "https://project.example",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  ADMIN_SESSION_SECRET: "admin-session-secret-for-tests"
};
const admin = { id: "22222222-2222-4222-8222-222222222222", userId: "11111111-1111-4111-8111-111111111111", isAdmin: true };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function uploadRequest({ thumbnail = true, sourceSha256 } = {}) {
  const form = new FormData();
  form.append("folder", "soft");
  form.append("file", new File([JPEG], "photo.jpg", { type: "image/jpeg" }));
  if (thumbnail) form.append("thumbnail", new File([JPEG], "photo.jpg.jpg", { type: "image/jpeg" }));
  if (sourceSha256) form.append("sourceSha256", sourceSha256);
  return new Request("https://pool.example/api/upload-buschgirl", {
    method: "POST",
    headers: { Authorization: `Bearer ${await createAdminToken(env, admin)}` },
    body: form
  });
}

// Records every upstream call; storage and insert results can be overridden per test.
function supabaseFetch({ duplicate = null, originalStatus = 200, thumbStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    const method = options.method || "GET";
    calls.push({ url, method, headers: options.headers || {}, body: options.body });
    if (url.includes("/rest/v1/pool_members?")) return json([{ id: admin.id }]);
    if (url.includes("/rest/v1/buschgirls_photos?sha256=eq.")) return json(duplicate ? [duplicate] : []);
    if (url.includes("/storage/v1/object/buschgirls-thumbnails/")) return method === "DELETE" ? json({}) : json({}, thumbStatus);
    if (url.includes("/storage/v1/object/buschgirls/")) return method === "DELETE" ? json({}) : json({}, originalStatus);
    if (url.includes("/rest/v1/buschgirls_photos?folder=eq.")) return json([]);
    if (url.endsWith("/rest/v1/buschgirls_photos") && method === "POST") return json(JSON.parse(options.body), 201);
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
  return { calls, fetchImpl };
}

test("duplicate detection uses the browser's pre-shrink source hash", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const sourceSha256 = "a".repeat(64);
  const { calls, fetchImpl } = supabaseFetch({ duplicate: { id: "x", folder: "soft", filename: "old.jpg", uploaded_at: "2026-08-01T00:00:00Z" } });
  globalThis.fetch = fetchImpl;

  const response = await postUpload({ request: await uploadRequest({ sourceSha256 }), env });
  assert.equal(response.status, 409);
  assert.ok(calls.some(c => c.url.includes(`sha256=eq.${sourceSha256}`)));
  assert.ok(!calls.some(c => c.url.includes("/storage/v1/object/")), "nothing is uploaded for a duplicate");
});

test("upload without a thumbnail stores the original and leaves indexing to the backfill", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const { calls, fetchImpl } = supabaseFetch();
  globalThis.fetch = fetchImpl;

  const response = await postUpload({ request: await uploadRequest({ thumbnail: false }), env });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.thumbnailReady, false);
  const storageCalls = calls.filter(c => c.url.includes("/storage/v1/object/"));
  assert.deepEqual(storageCalls.map(c => c.url), ["https://project.example/storage/v1/object/buschgirls/soft/photo.jpg"]);
  assert.equal(storageCalls[0].headers["Cache-Control"], "public, max-age=31536000, immutable");
  const [row] = JSON.parse(calls.find(c => c.method === "POST" && c.url.endsWith("/rest/v1/buschgirls_photos")).body);
  assert.equal(row.thumbnail_path, null);
  assert.equal(row.indexed_at, null);
  assert.match(row.sha256, /^[0-9a-f]{64}$/);
});

test("a taken original path is never deleted; only the new thumbnail is cleaned up", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const { calls, fetchImpl } = supabaseFetch({ originalStatus: 409 });
  globalThis.fetch = fetchImpl;

  const response = await postUpload({ request: await uploadRequest(), env });
  assert.equal(response.status, 409);
  const deletes = calls.filter(c => c.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].url, /\/storage\/v1\/object\/buschgirls-thumbnails\/soft\/[0-9a-f-]{36}\.jpg$/);
});

test("a failed thumbnail upload removes the original this request created", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const { calls, fetchImpl } = supabaseFetch({ thumbStatus: 500 });
  globalThis.fetch = fetchImpl;

  const response = await postUpload({ request: await uploadRequest(), env });
  assert.equal(response.status, 500);
  const deletes = calls.filter(c => c.method === "DELETE");
  assert.deepEqual(deletes.map(c => c.url), ["https://project.example/storage/v1/object/buschgirls/soft/photo.jpg"]);
  assert.ok(!calls.some(c => c.method === "POST" && c.url.endsWith("/rest/v1/buschgirls_photos")), "no row is inserted");
});
