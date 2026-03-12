export async function onRequest(context) {
  const { env, request } = context;

  const url = new URL(request.url);
  const raceId = url.searchParams.get("raceId");

  await fetch(
    `${env.SUPABASE_URL}/rest/v1/player_assignments?race_id=eq.${raceId}`,
    {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`
      }
    }
  );

  return new Response(JSON.stringify({ message: "Assignments cleared." }), {
    headers: { "Content-Type": "application/json" }
  });
}