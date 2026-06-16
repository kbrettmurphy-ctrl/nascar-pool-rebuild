export async function sendPlayerNotification(env, playerName, payload) {
  const name = String(playerName || "").trim();
  if (!name) return { sent: 0, failed: 0, results: [] };

  return sendPushWhere(env, `player_name=eq.${encodeURIComponent(name)}`, payload);
}

export async function sendAllNotifications(env, payload) {
  return sendPushWhere(env, "", payload);
}

async function sendPushWhere(env, filter, payload) {
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
  };

  const qs = filter ? `&${filter}` : "";

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=id,subscription${qs}&paused=eq.false`,
    { headers }
  );

  const rows = await res.json().catch(() => []);

  if (!res.ok) {
    throw new Error("Failed to load push subscriptions");
  }

  const results = [];

  for (const row of rows || []) {
    const pushRes = await sendEncryptedWebPush(row.subscription, payload, env);

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

async function sendEncryptedWebPush(subscription, payload, env) {
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys || {};

  if (!endpoint || !keys.p256dh || !keys.auth) {
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

  const encryptedBody = await encryptPushPayload(
    JSON.stringify({
      title: payload?.title || "NASCAR Pool",
      body: payload?.body || "New update available.",
      url: payload?.url || "/"
    }),
    keys.p256dh,
    keys.auth
  );

  return fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Urgency: "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
    },
    body: encryptedBody
  });
}

async function encryptPushPayload(payloadText, p256dh, authSecret) {
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const serverPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeys.publicKey)
  );

  const clientPublicRaw = base64urlDecode(p256dh);
  const auth = base64urlDecode(authSecret);

  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    clientPublicRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPublicKey },
      serverKeys.privateKey,
      256
    )
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const prk = await hmacSign(auth, sharedSecret);

  const info = concatBytes(
    utf8("WebPush: info\0"),
    clientPublicRaw,
    serverPublicRaw
  );

  const ikm = await hkdfExpand(prk, info, 32);
  const contentPrk = await hmacSign(salt, ikm);

  const cek = await hkdfExpand(
    contentPrk,
    utf8("Content-Encoding: aes128gcm\0"),
    16
  );

  const nonce = await hkdfExpand(
    contentPrk,
    utf8("Content-Encoding: nonce\0"),
    12
  );

  const plaintext = concatBytes(
    utf8(payloadText),
    new Uint8Array([0x02])
  );

  const key = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      key,
      plaintext
    )
  );

  return concatBytes(
    salt,
    uint32(4096),
    new Uint8Array([serverPublicRaw.length]),
    serverPublicRaw,
    ciphertext
  );
}

async function hmacSign(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey(
    "raw",
    prk,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  let previous = new Uint8Array(0);
  let output = new Uint8Array(0);
  let counter = 1;

  while (output.length < length) {
    previous = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        concatBytes(previous, info, new Uint8Array([counter]))
      )
    );

    output = concatBytes(output, previous);
    counter++;
  }

  return output.slice(0, length);
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
    utf8(unsignedToken)
  );

  return `${unsignedToken}.${base64urlEncodeBytes(new Uint8Array(sig))}`;
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

function uint16(n) {
  return new Uint8Array([
    (n >>> 8) & 255,
    n & 255
  ]);
}

function uint32(n) {
  return new Uint8Array([
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255
  ]);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }

  return out;
}

function base64urlEncodeString(str) {
  return base64urlEncodeBytes(utf8(str));
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
