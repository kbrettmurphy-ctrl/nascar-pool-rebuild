import { verifyAdminRequest, json } from "./_admin-auth";
import {
  sendAllNotifications,
  sendPlayerNotification
} from "./_push";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));

    const payload = {
      title: body?.title || "NASCAR Pool",
      body: body?.body || "Test push from NASCAR Pool.",
      url: body?.url || "/"
    };

    const playerName = String(body?.playerName || "").trim();

    const result = playerName
      ? await sendPlayerNotification(env, playerName, payload)
      : await sendAllNotifications(env, payload);

    return json({
      ok: true,
      ...result
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
