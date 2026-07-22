import { verifyAdminRequest } from "./_admin-auth";
import { privateJson, serviceHeaders } from "./_buschgirls-admin";

export async function onRequestGet({ request, env }) {
  try {
    if (!(await verifyAdminRequest(request, env))) return privateJson({ ok: false, error: "Unauthorized" }, 401);
    const allRows = [];
    for (let start = 0; ; start += 1000) {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id,sha256,folder,filename,uploaded_at,active&sha256=not.is.null&order=sha256.asc,uploaded_at.asc`, { headers: serviceHeaders(env, { Range: `${start}-${start + 999}` }) });
      const text = await response.text();
      if (!response.ok) throw new Error(text || "Duplicate query failed");
      const rows = JSON.parse(text || "[]");
      allRows.push(...rows);
      if (rows.length < 1000) break;
    }
    const grouped = new Map();
    for (const row of allRows) {
      if (!grouped.has(row.sha256)) grouped.set(row.sha256, []);
      grouped.get(row.sha256).push(row);
    }
    const groups = Array.from(grouped, ([sha256, photos]) => ({ sha256, photos })).filter(group => group.photos.length > 1);
    return privateJson({ ok: true, groups, totalGroups: groups.length });
  } catch (error) {
    return privateJson({ ok: false, error: error.message || String(error) }, 500);
  }
}
