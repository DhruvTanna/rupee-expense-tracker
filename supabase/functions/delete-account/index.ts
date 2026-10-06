const allowedOrigin = "https://dhruvtanna.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function secretKey(): string | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || Object.values(keys)[0] || null;
  } catch { return null; }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== allowedOrigin) return reply({ error: "Origin not allowed" }, 403);
  const authorization = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply({ error: "Sign in again to continue." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const adminKey = secretKey();
  if (!url || !adminKey) return reply({ error: "Account deletion is not configured yet." }, 503);
  try {
    // Validate the caller's access token with Supabase Auth, then delete only that caller.
    const userResponse = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: adminKey, Authorization: authorization },
    });
    if (!userResponse.ok) return reply({ error: "Your session expired. Sign in again and retry." }, 401);
    const user = await userResponse.json();
    if (!user?.id) return reply({ error: "Could not verify the signed-in account." }, 401);
    const deleteResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE",
      headers: { apikey: adminKey, Authorization: `Bearer ${adminKey}` },
    });
    if (!deleteResponse.ok) {
      const detail = await deleteResponse.text();
      console.error("Supabase account deletion failed", deleteResponse.status, detail);
      return reply({ error: "Supabase could not delete this account. Please try again later." }, 502);
    }
    return reply({ success: true });
  } catch (error) {
    console.error("Account deletion error", error);
    return reply({ error: "Could not reach Supabase. Please try again." }, 502);
  }
});

