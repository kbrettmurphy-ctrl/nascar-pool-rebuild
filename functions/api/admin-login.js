import { createAdminToken, json } from "./_admin-auth";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const pin = String(body?.pin || "").trim();

    if (!pin) {
      return json({ ok: false, error: "PIN is required" }, 400);
    }

    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/verify_admin_pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      },
      body: JSON.stringify({ input_pin: pin }),
    });

    const raw = await rpcRes.text();
    let valid = false;

    try {
      valid = JSON.parse(raw) === true;
    } catch {
      valid = raw === "true";
    }

    if (!rpcRes.ok || !valid) {
      return json({ ok: false, error: "Invalid PIN" }, 401);
    }

    const token = await createAdminToken(env);

    return json({
      ok: true,
      token,
      expiresInMinutes: 45
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
