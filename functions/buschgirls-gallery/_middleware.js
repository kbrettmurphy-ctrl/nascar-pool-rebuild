import { verifyAdminCookie } from "../api/_admin-auth";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow, noarchive"
};

export async function onRequest(context) {
  if (!(await verifyAdminCookie(context.request, context.env))) {
    return new Response("Not Found", { status: 404, headers: PRIVATE_HEADERS });
  }
  const response = await context.next();
  const guarded = new Response(response.body, response);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) guarded.headers.set(name, value);
  return guarded;
}
