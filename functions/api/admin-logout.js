import { clearAdminCookie, json } from "./_admin-auth";

export async function onRequestPost() {
  const response = json({ ok: true });
  response.headers.set("Set-Cookie", clearAdminCookie());
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
