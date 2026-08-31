import { getPublishableKey, memberJson } from "./_member-auth.js";

export async function onRequestGet({ env }) {
  const url = String(env.SUPABASE_URL || "").trim();
  const publishableKey = getPublishableKey(env);
  if (!url || !publishableKey) {
    return memberJson({ ok: false, enabled: false, error: "Member authentication is not configured" }, 503);
  }
  return memberJson({ ok: true, enabled: true, url, publishableKey });
}
