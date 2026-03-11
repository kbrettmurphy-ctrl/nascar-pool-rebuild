const encoder = new TextEncoder();

function b64urlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToString(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

async function signPayload(payloadStr, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadStr));
  return b64urlEncode(new Uint8Array(sig));
}

export async function createAdminToken(env) {
  const exp = Date.now() + (1000 * 60 * 45); // 45 min
  const payload = JSON.stringify({ exp, role: "admin" });
  const payloadB64 = b64urlEncode(encoder.encode(payload));
  const sig = await signPayload(payloadB64, env.ADMIN_SESSION_SECRET);
  return `${payloadB64}.${sig}`;
}

export async function verifyAdminRequest(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;

  const token = m[1].trim();
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [payloadB64, sig] = parts;
  const expectedSig = await signPayload(payloadB64, env.ADMIN_SESSION_SECRET);
  if (sig !== expectedSig) return false;

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(payloadB64));
  } catch {
    return false;
  }

  if (!payload || payload.role !== "admin") return false;
  if (!payload.exp || Date.now() > Number(payload.exp)) return false;

  return true;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
