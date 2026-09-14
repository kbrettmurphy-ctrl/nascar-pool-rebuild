import { verifyAdminRequest, json } from "./_admin-auth.js";
import { syncPlayerFinancialWinnings } from "./import-results.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const winningsSync = await syncPlayerFinancialWinnings(env);
    return json({ ok: true, winningsSync });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
