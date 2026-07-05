// NASCAR.com headlines. nascar.com/feed sits behind a Cloudflare bot
// wall (403s server-side fetches), so we read the same headlines via
// Google News RSS filtered to nascar.com.
export async function onRequestGet() {
  try {
    const res = await fetch(
      "https://news.google.com/rss/search?q=site:nascar.com&hl=en-US&gl=US&ceid=US:en",
      {
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "Mozilla/5.0",
        },
        cf: { cacheTtl: 600, cacheEverything: true },
      }
    );

    if (!res.ok) {
      return json({ ok: false, error: `Feed fetch failed: ${res.status}` }, 502);
    }

    const xml = await res.text();

    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;

    while ((m = itemRe.exec(xml)) && items.length < 12) {
      const block = m[1];
      const title = decode_(pick_(block, "title"))
        .replace(/\s+-\s+NASCAR(\.com)?\s*$/i, "");
      const link = pick_(block, "link");
      const pubDate = pick_(block, "pubDate");
      if (title && link) {
        items.push({ title, link, pubDate });
      }
    }

    return json({ ok: true, items });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

function pick_(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  let v = m ? m[1].trim() : "";
  v = v.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
  return v;
}

function decode_(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
