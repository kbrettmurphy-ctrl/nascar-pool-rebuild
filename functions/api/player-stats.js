export async function onRequestGet(context) {
  try {
    const { env } = context;

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    };

    async function getJson(path) {
      const res = await fetch(`${env.SUPABASE_URL}${path}`, { headers });
      const text = await res.text();

      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!res.ok) {
        throw new Error(typeof data === "string" ? data : JSON.stringify(data));
      }

      return data;
    }

    const matchupRows = await getJson(
      `/rest/v1/swiss_matchup_results?select=tournament_id,round_number,player1_id,player1_name,player1_avg,player2_id,player2_name,player2_avg,winner_id&order=tournament_id.asc,round_number.asc`
    );

    const statsMap = new Map();

    function getPlayerRow(playerId, playerName) {
      const key = String(playerId);
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          player_id: Number(playerId),
          Name: String(playerName || "").trim(),
          W: 0,
          L: 0,
          avg_sum: 0,
          match_count: 0
        });
      }
      return statsMap.get(key);
    }

    for (const row of matchupRows || []) {
      const p1Id = Number(row.player1_id);
      const p2Id = Number(row.player2_id);

      const p1 = getPlayerRow(p1Id, row.player1_name);
      const p2 = getPlayerRow(p2Id, row.player2_name);

      const a1 = Number(row.player1_avg);
      const a2 = Number(row.player2_avg);
      const winnerId = Number(row.winner_id);

      p1.match_count += 1;
      p2.match_count += 1;

      if (Number.isFinite(a1)) p1.avg_sum += a1;
      if (Number.isFinite(a2)) p2.avg_sum += a2;

      if (winnerId && winnerId === p1Id) {
        p1.W += 1;
        p2.L += 1;
      } else if (winnerId && winnerId === p2Id) {
        p2.W += 1;
        p1.L += 1;
      }
    }

    const overall = Array.from(statsMap.values()).map(r => {
      const avg =
        r.match_count > 0 && Number.isFinite(r.avg_sum)
          ? Number((r.avg_sum / r.match_count).toFixed(2))
          : null;

      const winPct =
        r.match_count > 0
          ? Number(((r.W / r.match_count) * 100).toFixed(1))
          : 0;

      return {
        Rank: 0,
        Name: r.Name,
        W: r.W,
        L: r.L,
        "W%": winPct,
        Avg: avg
      };
    });

    overall.sort((a, b) => {
      if (b.W !== a.W) return b.W - a.W;

      const aAvg = Number.isFinite(a.Avg) ? a.Avg : 9999;
      const bAvg = Number.isFinite(b.Avg) ? b.Avg : 9999;
      if (aAvg !== bAvg) return aAvg - bAvg;

      return String(a.Name).localeCompare(String(b.Name));
    });

    overall.forEach((row, idx) => {
      row.Rank = idx + 1;
    });

    return json({
      ok: true,
      data: {
        overallHeaders: ["Rank", "Name", "W", "L", "W%", "Avg"],
        overall,
        tournamentHeaders: [],
        tournaments: {}
      }
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
