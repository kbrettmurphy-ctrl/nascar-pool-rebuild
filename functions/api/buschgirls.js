export async function onRequestGet(context) {
  try {
    const { env } = context;

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    const allRows = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
      const to = from + pageSize - 1;

      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id,folder,filename,url,uploaded_at&active=eq.true&order=folder.asc,sort_order.asc,uploaded_at.asc`,
        {
          headers: {
            ...headers,
            Range: `${from}-${to}`,
          },
        }
      );

      const text = await res.text();
      const rows = text ? JSON.parse(text) : [];

      if (!res.ok) {
        return json({ ok: false, error: text || "Failed loading Busch girls" }, 500);
      }

      allRows.push(...rows);

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return json({
      ok: true,
      photos: allRows,
      count: allRows.length,
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
