import { verifyAdminRequest } from "./_admin-auth";
import { checkGreenFlagStartPush_ } from "./_green-flag";

export async function onRequestGet(context) {
  return handleAdminGreenFlagCheck_(context, true);
}

export async function onRequestPost(context) {
  const { request } = context;
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const send = body?.send === true || url.searchParams.get("send") === "1";

  return handleAdminGreenFlagCheck_(context, !send);
}

async function handleAdminGreenFlagCheck_(context, dryRun) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json_({ ok: false, error: "Unauthorized" }, 401);

    const result = await checkGreenFlagStartPush_({
      env,
      dryRun,
      source: dryRun ? "admin_diagnostic_dry_run" : "admin_diagnostic_send"
    });

    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) }, 500);
  }
}

function json_(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
