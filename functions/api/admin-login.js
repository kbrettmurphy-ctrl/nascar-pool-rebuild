import { createAdminCookie, createAdminToken, json } from "./_admin-auth.js";
import { memberAuthResponse, requirePoolAdmin } from "./_member-auth.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const member = await requirePoolAdmin(request, env);
    const token = await createAdminToken(env, member);

    const response = json({
      ok: true,
      token,
      expiresInMinutes: 45
    });
    response.headers.set("Set-Cookie", await createAdminCookie(env, member));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err) {
    if (err?.name === "MemberAuthError") return memberAuthResponse(err);
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
