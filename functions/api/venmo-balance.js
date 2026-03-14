import { verifyAdminRequest, json } from "./_admin-auth";

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const ok = await verifyAdminRequest(request, env);
    if (!ok) return json({ ok: false, error: "Unauthorized" }, 401);

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/player_financials?select=paid,paidout`,
      { headers }
    );

    const text = await res.text();

    let rows;
    try {
      rows = text ? JSON.parse(text) : [];
    } catch {
      rows = [];
    }

    if (!res.ok) {
      throw new Error(typeof rows === "string" ? rows : JSON.stringify(rows));
    }

    let totalPaid = 0;
    let totalPaidOut = 0;

    for (const row of rows || []) {
      totalPaid += Number(row?.paid) || 0;
      totalPaidOut += Number(row?.paidout) || 0;
    }

    const venmoBalance = totalPaid - totalPaidOut;

    return json({
      ok: true,
      venmoBalance,
      totalPaid,
      totalPaidOut
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}
