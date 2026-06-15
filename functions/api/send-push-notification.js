import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
    };

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint`,
      { headers }
    );

    const rows = await res.json();

    if (!res.ok) {
      return json({ ok: false, error: "Failed to load subscriptions" }, 500);
    }

    if (!rows.length) {
      return json({ ok: false, error: "No push subscriptions found" }, 400);
    }

    const results = [];

    for (const row of rows) {
      const pushRes = await sendEmptyPush_(row.endpoint, env);

      results.push({
        id: row.id,
        status: pushRes.status,
        ok: pushRes.ok
      });
    }

    return json({
      ok: true,
      sent: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

async function sendEmptyPush_(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const jwt = await makeVapidJwt_({
    aud,
    exp,
    sub: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  });

  return fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
    }
  });
}

async function makeVapidJwt_({ aud, exp, sub, publicKey, privateKey }) {
  const header = {
    typ: "JWT",
    alg: "ES256"
  };

  const payload = {
    aud,
    exp,
    sub
  };

  const encodedHeader = base64urlEncodeString_(JSON.stringify(header));
  const encodedPayload = base64urlEncodeString_(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const publicBytes = base64urlDecode_(publicKey);
  const privateBytes = base64urlDecode_(privateKey);

  if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error("Invalid VAPID public key");
  }

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64urlEncodeBytes_(publicBytes.slice(1, 33)),
    y: base64urlEncodeBytes_(publicBytes.slice(33, 65)),
    d: base64urlEncodeBytes_(privateBytes),
    ext: false
  };

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${base64urlEncodeBytes_(new Uint8Array(sig))}`;
}

function base64urlEncodeString_(str) {
  return base64urlEncodeBytes_(new TextEncoder().encode(str));
}

function base64urlEncodeBytes_(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode_(str) {
  const padded = String(str)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(str.length / 4) * 4, "=");

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}