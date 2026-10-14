import assert from "node:assert/strict";
import test from "node:test";

import { createAdminToken } from "../functions/api/_admin-auth.js";
import { onRequestGet as getGallery } from "../functions/api/admin-buschgirls-gallery.js";

const env = {
  SUPABASE_URL: "https://project.example",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  ADMIN_SESSION_SECRET: "admin-session-secret-for-tests"
};
const admin = { id: "22222222-2222-4222-8222-222222222222", userId: "11111111-1111-4111-8111-111111111111", isAdmin: true };
const photo = id => ({ id, folder: "soft", filename: `${id}.jpg`, storage_path: `soft/${id}.jpg`, uploaded_at: "2026-10-01T00:00:00Z", active: true, thumbnail_path: `soft/${id}.jpg` });

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}

// Votes: a +2, b -2, c 0 (1 up 1 down), d unvoted. e is voted but filtered out.
function galleryFetch({ voteRows, idRows }) {
  return async (input, options = {}) => {
    const url = String(input);
    if (url.includes("/rest/v1/pool_members?")) return json([{ id: admin.id }]);
    if (url.includes("/rest/v1/buschgirl_votes?")) {
      const [start] = (options.headers?.Range || "0-999").split("-").map(Number);
      return json(voteRows.slice(start, start + 1000));
    }
    if (url.includes("select=id&")) {
      if (options.headers?.Prefer === "count=exact") return json([], 200, { "content-range": "0-0/4" });
      const [start] = (options.headers?.Range || "0-999").split("-").map(Number);
      return json(idRows.slice(start, start + 1000).map(id => ({ id })));
    }
    if (url.includes("&id=in.(")) {
      const ids = decodeURIComponent(url.split("&id=in.(")[1]).replace(/\).*$/, "").split(",");
      return json(ids.reverse().map(photo)); // any order; the API must restore rank order
    }
    if (url.includes("/storage/v1/object/sign/")) {
      const { paths } = JSON.parse(options.body);
      return json(paths.map(path => ({ path, signedURL: `/object/sign/x/${path}?token=t` })));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

async function request(query) {
  return new Request(`https://pool.example/api/admin-buschgirls-gallery?${query}`, {
    headers: { Authorization: `Bearer ${await createAdminToken(env, admin)}` }
  });
}

const baseVotes = [
  { photo_id: "a", player_name: "Alex", vote: 1 }, { photo_id: "a", player_name: "Blake", vote: 1 },
  { photo_id: "b", player_name: "Alex", vote: -1 }, { photo_id: "b", player_name: "Blake", vote: -1 },
  { photo_id: "c", player_name: "Alex", vote: 1 }, { photo_id: "c", player_name: "Blake", vote: -1 },
  { photo_id: "e", player_name: "Alex", vote: -1 }
];

test("least liked lists only voted, filtered photos in ascending net order with voters", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = galleryFetch({ voteRows: baseVotes, idRows: ["a", "b", "c", "d"] });
  const res = await getGallery({ request: await request("sort=least_liked&pageSize=10"), env });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.photos.map(p => p.id), ["b", "c", "a"]);
  assert.equal(data.total, 3);
  assert.deepEqual(data.photos[0].votes, { likes: 0, dislikes: 2, likedBy: [], dislikedBy: ["Alex", "Blake"] });
});

test("most liked reverses the ranking", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = galleryFetch({ voteRows: baseVotes, idRows: ["a", "b", "c", "d"] });
  const data = await (await getGallery({ request: await request("sort=most_liked&pageSize=10"), env })).json();
  assert.deepEqual(data.photos.map(p => p.id), ["a", "c", "b"]);
});

test("votes past the 1000-row page are counted", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const filler = Array.from({ length: 1000 }, (_, i) => ({ photo_id: "z", player_name: `P${i}`, vote: 1 }));
  globalThis.fetch = galleryFetch({ voteRows: [...filler, { photo_id: "a", player_name: "Late", vote: -1 }], idRows: ["a"] });
  const data = await (await getGallery({ request: await request("sort=least_liked&pageSize=10"), env })).json();
  assert.deepEqual(data.photos.map(p => p.id), ["a"]);
  assert.equal(data.photos[0].votes.dislikes, 1);
});
