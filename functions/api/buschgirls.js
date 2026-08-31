import { memberAuthResponse, memberJson, requirePoolMember } from "./_member-auth.js";
import { serviceHeaders, signStoragePaths, UUID_RE } from "./_buschgirls-admin.js";

const BATCH_SIZE = 32;
const WARMUP_COUNT = 2;
const SIGNED_URL_SECONDS = 1800;

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function getActivePhotos(env) {
  const allRows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/buschgirls_photos?select=id,folder,filename,storage_path,uploaded_at&active=eq.true&order=id.asc`,
      { headers: serviceHeaders(env, { Range: `${from}-${from + pageSize - 1}` }) }
    );
    const text = await response.text();
    const rows = text ? JSON.parse(text) : [];
    if (!response.ok || !Array.isArray(rows)) throw new Error("Private photo list failed");
    allRows.push(...rows);
    if (rows.length < pageSize) break;
  }
  return allRows;
}

function chooseBatch(rows, member, excludedIds, includeWarmup) {
  const available = rows.filter(row => !excludedIds.has(String(row.id)));
  const soft = available.filter(row => row.folder === "soft");
  const isTyler = member.playerName.trim().toLowerCase() === "tyler";
  const warmup = includeWarmup ? shuffle(soft).slice(0, WARMUP_COUNT) : [];
  const warmupIds = new Set(warmup.map(row => String(row.id)));
  const main = isTyler
    ? available.filter(row => row.folder === "old")
    : available.filter(row => ["soft", "spicy", "spicier"].includes(row.folder) && !warmupIds.has(String(row.id)));
  return [...warmup, ...shuffle(main)].slice(0, BATCH_SIZE);
}

export async function onRequestGet({ request, env }) {
  try {
    const member = await requirePoolMember(request, env);
    const params = new URL(request.url).searchParams;
    const excludedIds = new Set(
      String(params.get("exclude") || "")
        .split(",")
        .map(id => id.trim())
        .filter(id => UUID_RE.test(id))
        .slice(0, 200)
    );
    const includeWarmup = params.get("warmup") === "1";
    const rows = await getActivePhotos(env);
    let selected = chooseBatch(rows, member, excludedIds, includeWarmup);
    if (!selected.length && excludedIds.size) selected = chooseBatch(rows, member, new Set(), includeWarmup);

    const paths = selected.map(row => row.storage_path || `${row.folder}/${row.filename}`);
    const signed = await signStoragePaths(env, "buschgirls", paths, SIGNED_URL_SECONDS);
    const photos = selected.flatMap(row => {
      const storagePath = row.storage_path || `${row.folder}/${row.filename}`;
      const url = signed.get(storagePath);
      return url ? [{
        id: row.id,
        url,
        folder: row.folder,
        filename: row.filename,
        uploaded_at: row.uploaded_at
      }] : [];
    });

    return memberJson({
      ok: true,
      photos,
      count: photos.length,
      expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString()
    });
  } catch (error) {
    if (error?.name === "MemberAuthError") return memberAuthResponse(error);
    return memberJson({ ok: false, error: error.message || "Private photos unavailable" }, 500);
  }
}
