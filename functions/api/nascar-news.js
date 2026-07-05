// NASCAR Cup headlines with thumbnails.
// Primary: motorsport.com RSS (fetchable from Workers, includes images).
// Fallback: Google News RSS scoped to nascar.com (no images).
// nascar.com's own feed 403s server-side fetches behind its bot wall.
export async function onRequestGet() {
  try {
    let items = await fromMotorsport_();
    if (!items.length) items = await fromGoogleNews_();
    return json({ ok: true, items });
  } catch (err) {
    try {
      const items = await fromGoogleNews_();
      if (items.length) return json({ ok: true, items });
    } catch {}
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

async function fromMotorsport_() {
  const xml = await fetchText_("https://www.motorsport.com/rss/nascar-cup/news/");
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;

  while ((m = itemRe.exec(xml)) && items.length < 15) {
    const block = m[1];
    const title = decode_(pick_(block, "title"));
    const link = decode_(pick_(block, "link"));
    const pubDate = pick_(block, "pubDate");
    const img = decode_(block.match(/<enclosure[^>]*url="([^"]+)"/)?.[1] || "");
    if (title && link) {
      items.push({ title, link, pubDate, image: img });
    }
  }
  return items;
}

async function fromGoogleNews_() {
  const xml = await fetchText_(
    "https://news.google.com/rss/search?q=site:nascar.com&hl=en-US&gl=US&ceid=US:en"
  );
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;

  while ((m = itemRe.exec(xml)) && items.length < 12) {
    const block = m[1];
    const title = decode_(pick_(block, "title"))
      .replace(/\s+-\s+NASCAR(\.com)?\s*$/i, "");
    const link = decode_(pick_(block, "link"));
    const pubDate = pick_(block, "pubDate");
    if (title && link) {
      items.push({ title, link, pubDate, image: "" });
    }
  }
  return items;
}

async function fetchText_(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  return res.text();
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
