export async function onRequest(context) {
  const { env, request } = context;

  const url = new URL(request.url);
  const tournamentId = url.searchParams.get("tournamentId");

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tournament_players?tournament_id=eq.${tournamentId}`,
    {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ seed: null })
    }
  );

  return new Response(JSON.stringify({ message: "Seeds cleared." }), {
    headers: { "Content-Type": "application/json" }
  });
}