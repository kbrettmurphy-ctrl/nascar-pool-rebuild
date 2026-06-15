export async function sendPlayerNotification(env, playerName, payload) {
  const name = String(playerName || "").trim();
  if (!name) return { sent: 0, failed: 0, results: [] };

  await queuePushMessage(env, name, payload);
  return sendBlankPushWhere(env, `player_name=eq.${encodeURIComponent(name)}`);
}

export async function sendAllNotifications(env, payload) {
  await queuePushMessage(env, null, payload);
  return sendBlankPushWhere(env, "");
}

async function queuePushMessage(env, playerName, payload) {
  const row = {
    player_name: playerName || null,
    title: payload?.title || "NASCAR Pool",
    body: payload?.body || "New update available.",
    url: payload?.url || "/",
    delivered: false
  };

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/push_messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
    },
    body: JSON.stringify(row)
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(text || "Failed to queue push message");
  }
}

async function sendBlankPushWhere(env, filter) {
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
  };

  const qs = filter ? `&${filter}` : "";

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=id,endpoint,subscription${qs}`,
    { headers }
  );

  const rows = await res.json().catch(() => []);

  if (!res.ok) {
    throw new Error("Failed to load push subscriptions");
  }

  const results = [];

  for (const row of rows || []) {
    const pushRes = await sendBlankWebPush(row.subscription, env);

    results.push({
      id: row.id,
      status: pushRes.status,
      ok: pushRes.ok
    });

    if (pushRes.status === 404 || pushRes.status === 410) {
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${row.id}`,
        {
          method: "DELETE",
          headers
        }
      );
    }
  }

  return {
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results
  };
}

async function sendBlankWebPush(subscription, env) {
  const endpoint = subscription?.endpoint;

  if (!endpoint) {
    return new Response("Invalid subscription", { status: 400 });
  }

  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const jwt = await makeVapidJwt({
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

async function makeVapidJwt({ aud, exp, sub, publicKey, privateKey }) {
  const header = {
    typ: "JWT",
    alg: "ES256"
  };

  const payload = {
    aud,
    exp,
    sub
  };

  const encodedHeader = base64urlEncodeString(JSON.stringify(header));
  const encodedPayload = base64urlEncodeString(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const publicBytes = base64urlDecode(publicKey);
  const privateBytes = base64urlDecode(privateKey);

  if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error("Invalid VAPID public key");
  }

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64urlEncodeBytes(publicBytes.slice(1, 33)),
    y: base64urlEncodeBytes(publicBytes.slice(33, 65)),
    d: base64urlEncodeBytes(privateBytes),
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

  return `${unsignedToken}.${base64urlEncodeBytes(new Uint8Array(sig))}`;
}

function base64urlEncodeString(str) {
  return base64urlEncodeBytes(new TextEncoder().encode(str));
}

function base64urlEncodeBytes(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(str) {
  const s = String(str || "");
  const padded = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
