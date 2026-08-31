import { memberAuthResponse, memberJson, requirePoolMember } from "./_member-auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const member = await requirePoolMember(request, env);
    return memberJson({ ok: true, member });
  } catch (error) {
    return memberAuthResponse(error);
  }
}
